import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".base", ".canvas", ".csv"]);
const PRIVATE_ROOTS = new Set(["_archive", "_meta", "memory", "outputs", "personal-ip"]);
const PRIVATE_FILES = new Set(["memory.md", "inbox.md", "handoff.md", "log.md"]);
const MAX_NOTE_BYTES = 384 * 1024;
export const MAX_SHARED_SECTIONS = 512;
const MAX_CACHE_BYTES = 12 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const READ_BATCH_SIZE = 16;
const vaultCaches = new WeakMap();
const isHidden = name => name.startsWith(".") || name.toLowerCase() === "node_modules";
const unavailable = () => Object.assign(new Error("内容不可用"), { code: "unavailable" });

function pathParts(path, allowRoot) {
  if (path === "" && allowRoot) return [];
  if (typeof path !== "string" || path.length > 1024 || path.includes("\\") || path.includes("\0")) throw unavailable();
  const parts = path.split("/");
  if (parts.some(part => !part || part === ".." || isHidden(part))) throw unavailable();
  return parts;
}

async function resolveLocal(root, path, allowRoot = false) {
  const parts = pathParts(path, allowRoot);
  if (parts.some(part => part.toLowerCase() === "_archive")) throw unavailable();
  if (!(await lstat(root)).isDirectory()) throw unavailable();
  let full = root;
  for (const part of parts) {
    full = join(full, part);
    const item = await lstat(full);
    if (item.isSymbolicLink()) throw unavailable();
  }
  return full;
}

export async function makeVault(where) {
  const root = await realpath(where);
  if (!(await lstat(root)).isDirectory()) throw unavailable();
  return { root, name: basename(root) };
}

export async function listFolder(vault, path) {
  const full = await resolveLocal(vault.root, path, true);
  const items = await readdir(full, { withFileTypes: true });
  return items.filter(item => !isHidden(item.name) && (item.isDirectory() || item.isFile())).map(item => {
    const folder = item.isDirectory();
    const relative = posix.join(path, item.name);
    return {
      name: item.name, path: relative, folder,
      available: folder ? item.name.toLowerCase() !== "_archive" : TEXT_EXTENSIONS.has(extname(item.name).toLowerCase())
    };
  }).sort((left, right) => Number(right.folder) - Number(left.folder) ||
    left.name.localeCompare(right.name, "zh-Hans", { numeric: true }));
}

function fileVersion(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function noteCache(vault) {
  if (!vaultCaches.has(vault)) vaultCaches.set(vault, { bytes: 0, entries: new Map() });
  return vaultCaches.get(vault);
}

function cacheNote(cache, path, entry) {
  cache.bytes -= cache.entries.get(path)?.bytes || 0;
  cache.entries.delete(path);
  cache.entries.set(path, entry);
  cache.bytes += entry.bytes;
  while (cache.bytes > MAX_CACHE_BYTES || cache.entries.size > MAX_CACHE_ENTRIES) {
    const key = cache.entries.keys().next().value;
    cache.bytes -= cache.entries.get(key).bytes;
    cache.entries.delete(key);
  }
}

async function readVaultNote(vault, path, expectedRevisions) {
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) throw unavailable();
  const full = await resolveLocal(vault.root, path);
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) throw unavailable();
    const version = fileVersion(stat);
    const cache = noteCache(vault);
    const entry = cache.entries.get(path);
    if (entry?.version === version) {
      // Verify the opened file still belongs to this path before reusing its contents.
      if (fileVersion(await lstat(full, { bigint: true })) !== version) throw unavailable();
      cacheNote(cache, path, entry);
      return entry.note;
    }
    const bytes = Buffer.alloc(Number(stat.size));
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await file.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await lstat(full, { bigint: true });
    if (read !== bytes.length || fileVersion(after) !== version) throw unavailable();
    const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    if (expectedRevisions && !expectedRevisions.has(revision)) throw unavailable();
    const note = parseNote(path, {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      revision,
      updatedAt: new Date(Number(stat.mtimeMs)).toISOString()
    });
    const estimatedBytes = bytes.length * 4 + note.body.length * 72;
    cacheNote(cache, path, { version, bytes: estimatedBytes, note });
    return note;
  } finally {
    await file.close();
  }
}

function parseNote(path, data) {
  const lines = data.text.split(/\r?\n/);
  const meta = {};
  let bodyStart = 0;
  let validProperties = true;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      bodyStart = end + 1;
      try {
        const yaml = parseDocument(lines.slice(1, end).join("\n"));
        if (yaml.errors.length) throw unavailable();
        const props = yaml.toJS({ maxAliasCount: 0 });
        if (!props || typeof props !== "object" || Array.isArray(props)) throw unavailable();
        for (const key of ["title", "type", "status", "tier", "updated"]) {
          if (typeof props[key] === "string") meta[key] = props[key];
        }
        if (Array.isArray(props.tags)) meta.tags = props.tags.filter(tag => typeof tag === "string").slice(0, 8);
        if (Array.isArray(props.sources)) meta.sourceCount = props.sources.filter(Boolean).length;
      } catch {
        validProperties = false;
      }
    } else validProperties = false;
  }
  const body = lines.slice(bodyStart);
  const headings = [];
  const linkPositions = [];
  let fence;
  let paragraphStart = -1;
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && fenceMarker && (fenceMarker[1][0] === "~" || !fenceMarker[2].includes("`"))) {
      fence = fenceMarker[1];
      paragraphStart = -1;
      continue;
    }
    if (fence) {
      if (fenceMarker?.[1][0] === fence[0] && fenceMarker[1].length >= fence.length && !fenceMarker[2].trim()) {
        fence = undefined;
      }
      continue;
    }
    const sourceLine = index + bodyStart + 1;
    const heading = /^ {0,3}(#{1,6})[\t ]+(.+)$/.exec(line);
    const setext = /^ {0,3}(=+|-+)[\t ]*$/.exec(line);
    if (heading) {
      headings.push({ name: heading[2], depth: heading[1].length, line: sourceLine });
      paragraphStart = -1;
    } else if (setext && paragraphStart >= 0) {
      headings.push({ name: body.slice(paragraphStart, index).map(text => text.trim()).join(" "),
        depth: setext[1][0] === "=" ? 1 : 2, line: paragraphStart + bodyStart + 1 });
      paragraphStart = -1;
    } else if (!line.trim() || /^(?: {4}|\t| {0,3}(?:>|[-*+]\s|\d+[.)]\s))/.test(line) || setext) {
      paragraphStart = -1;
    } else if (paragraphStart < 0) {
      paragraphStart = index;
    }
    for (const link of line.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      linkPositions.push({ target: link[1].trim().replace(/\\$/, ""), line: sourceLine });
    }
  }
  return {
    path, title: meta.title || headings.find(heading => heading.depth === 1)?.name || basename(path, extname(path)),
    ...data, meta, validProperties, headings, links: [...new Set(linkPositions.map(link => link.target))].slice(0, 60),
    body, bodyStart, linkPositions, searchBody: body.map(searchable)
  };
}

export async function inspectNote(vault, path) {
  const { body, bodyStart, searchBody, linkPositions, ...note } = await readVaultNote(vault, path);
  return note;
}

function mayShare(path, maintenance) {
  const parts = pathParts(path, false);
  return extname(path).toLowerCase() === ".md" &&
    (!PRIVATE_ROOTS.has(parts[0].toLowerCase()) || (maintenance && parts[0].toLowerCase() === "_meta")) &&
    !parts.some(part => part.toLowerCase() === "_archive") && !PRIVATE_FILES.has(parts.at(-1).toLowerCase());
}
const inactive = new Set(["inbox", "archived", "superseded", "draft"]);
const normalize = text => text.normalize("NFKC").toLowerCase();
const citation = (note, start, end, heading) => ({
  document_id: note.path, title: note.title, revision: note.revision, heading, start_line: start, end_line: end
});

const unavailableResult = () => ({ status: "not_found_or_unavailable" });
const grantKey = ({ path, heading, revision }) => JSON.stringify([path, heading, revision]);
const Han = /\p{Script=Han}/u;
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopWords = new Set(["如何", "哪些", "什么", "是否", "一下", "请问", "what", "which", "how", "does", "is", "the", "a", "of"]);
const foldHan = text => text.replace(/(?<=\p{Script=Han})[\p{P}\s]+(?=\p{Script=Han})/gu, "");

function searchable(text) {
  const literal = normalize(text);
  return { literal, folded: Han.test(literal) ? foldHan(literal) : literal };
}

function searchQuery(value) {
  const { literal, folded } = searchable(value.trim());
  const spans = folded.match(/\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+(?:[-_.](?:(?!\p{Script=Han})[\p{L}\p{N}])+)*/gu) || [];
  const terms = new Set();
  const bigrams = new Set();
  for (const span of spans) {
    if (!Han.test(span)) {
      if (!stopWords.has(span)) terms.add(span);
      continue;
    }
    for (const { segment, isWordLike } of segmenter.segment(span)) {
      if (isWordLike && !stopWords.has(segment) && (segment.length > 1 || spans.length === 1 && segment === folded)) {
        terms.add(segment);
      }
    }
    const chars = Array.from(span);
    for (let i = 1; i < chars.length; i++) {
      const pair = chars[i - 1] + chars[i];
      if (!/[的了么吗呢着]/u.test(pair) && !stopWords.has(pair)) bigrams.add(pair);
    }
  }
  return { literal, folded, terms: [...terms].slice(0, 16), bigrams: [...bigrams].slice(0, 32) };
}

function matchScore(row, query) {
  if (row.literal.includes(query.literal)) return 12;
  if (query.folded !== query.literal && row.folded.includes(query.folded)) return 12;
  if (row.folded !== row.literal && row.folded.includes(query.folded)) return 12;
  const words = query.terms.filter(term => row.folded.includes(term)).length;
  if (words) return 2 + words * 2;
  return query.bigrams.filter(term => row.folded.includes(term)).length >= 2 ? 1 : 0;
}

function excerptFor(line, query) {
  const normalized = normalize(line);
  const matches = [query.literal, ...query.terms, ...query.bigrams].map(term => normalized.indexOf(term)).filter(at => at >= 0);
  const offset = matches.length ? Math.max(0, Math.min(...matches) - 55) : 0;
  return line.slice(offset, offset + 420);
}

function sectionEnd(note, heading) {
  const next = note.headings.find(item => item.line > heading.line && item.depth <= heading.depth);
  return next ? next.line - note.bodyStart - 1 : note.body.length;
}

function projectedSection(note, grant) {
  if (grant.revision !== note.revision) return null;
  const anchors = note.headings.filter(item => item.name === grant.heading);
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  const start = anchor.line - note.bodyStart - 1;
  let end = sectionEnd(note, anchor);
  while (end > start + 1 && !note.body[end - 1].trim()) end--;
  const body = note.body.slice(start, end);
  return {
    path: note.path,
    revision: note.revision,
    title: anchor.name,
    body,
    index: note.searchBody.slice(start, end),
    bodyStart: anchor.line - 1,
    headings: note.headings.filter(item => item.line >= anchor.line && item.line <= note.bodyStart + end),
    links: [...new Set(note.linkPositions.filter(link => link.line >= anchor.line && link.line <= note.bodyStart + end)
      .map(link => link.target))].slice(0, 60)
  };
}

function protectedExcerpt(note, start, end, heading) {
  const lines = [];
  let size = 0;
  let truncated = false;
  for (const line of note.body.slice(start, end)) {
    const left = 3500 - size - (lines.length ? 1 : 0);
    if (left <= 0) {
      truncated = true;
      break;
    }
    if (line.length > left) {
      lines.push(line.slice(0, left));
      truncated = true;
      break;
    }
    lines.push(line);
    size += line.length + (lines.length > 1 ? 1 : 0);
  }
  const line = start + note.bodyStart + 1;
  return {
    status: "ok",
    excerpt: lines.join("\n"),
    truncated,
    citation: citation(note, line, line + Math.max(0, lines.length - 1), heading)
  };
}

export function createProjection(vault, loadScope, { maintenance = false } = {}) {
  async function grants() {
    const rows = await loadScope();
    if (!Array.isArray(rows) || rows.length > MAX_SHARED_SECTIONS ||
        rows.some(row => typeof row?.path !== "string" || typeof row.heading !== "string" ||
          !row.heading.trim() || typeof row.revision !== "string" || !/^[a-f0-9]{16}$/.test(row.revision))) {
      throw new Error("共享章节必须指定文档、标题及已核验的版本");
    }
    return rows.filter(row => {
      try { return mayShare(row.path, maintenance); } catch { return false; }
    });
  }

  async function visitNotes(documentId, visit) {
    const byPath = new Map();
    for (const grant of await grants()) {
      if (documentId !== undefined && grant.path !== documentId) continue;
      if (!byPath.has(grant.path)) byPath.set(grant.path, []);
      byPath.get(grant.path).push(grant);
    }

    const entries = [...byPath];
    for (let i = 0; i < entries.length; i += READ_BATCH_SIZE) {
      const batch = entries.slice(i, i + READ_BATCH_SIZE);
      const notes = await Promise.all(batch.map(async ([path, items]) => {
        try {
          const note = await readVaultNote(vault, path, new Set(items.map(item => item.revision)));
          if (note.validProperties && (maintenance || !inactive.has(note.meta.status?.toLowerCase()))) return note;
        } catch {
          // Missing, replaced and unsupported files have the same disclosure policy.
        }
        return null;
      }));
      for (const [j, note] of notes.entries()) {
        if (!note) continue;
        for (const item of batch[j][1]) {
          const section = projectedSection(note, item);
          if (section) visit(section, grantKey(item));
        }
      }
    }

    // A grant may disappear while the file reads are in flight.
    return new Set((await grants()).map(grantKey));
  }

  return {
    async status() {
      const found = [];
      const live = await visitNotes(undefined, (note, grant) => found.push({ path: note.path, grant }));
      const paths = found.filter(note => live.has(note.grant)).map(note => note.path);
      return { publishedDocuments: new Set(paths).size };
    },

    async search({ query, limit = 6 }) {
      const parsed = searchQuery(query);
      if (!parsed.terms.length && !parsed.bigrams.length) return { status: "no_evidence", results: [] };
      const candidates = [];
      const live = await visitNotes(undefined, (note, grant) => {
        const headingScore = matchScore(note.index[0], parsed);
        let bestRow = 0;
        let bestScore = 0;
        for (const [idx, row] of note.index.entries()) {
          if (!idx || !row.literal.trim()) continue;
          const score = matchScore(row, parsed);
          if (score > bestScore) {
            bestScore = score;
            bestRow = idx;
          }
        }
        if (!bestScore && headingScore && note.body.length > 1) {
          const firstContent = note.body.findIndex((line, idx) => idx && line.trim() && !line.startsWith("#"));
          if (firstContent >= 0) bestRow = firstContent;
        }
        const score = headingScore * 2 + bestScore;
        if (!score) return;
        const line = note.bodyStart + bestRow + 1;
        candidates.push({ grant, hit: { score, excerpt: excerptFor(note.body[bestRow], parsed), citation: citation(note, line, line, note.title) } });
      });
      const hits = new Map();
      for (const { grant, hit } of candidates) {
        if (!live.has(grant)) continue;
        const key = JSON.stringify([hit.citation.document_id, hit.citation.start_line]);
        const { score } = hit;
        if (score > (hits.get(key)?.score || 0)) hits.set(key, hit);
      }
      const results = [...hits.values()].sort((a, b) => b.score - a.score).slice(0, limit);
      return { status: results.length ? "ok" : "no_evidence", results };
    },

    async read({ document_id, heading, revision }) {
      const found = [];
      const live = await visitNotes(document_id, (note, grant) => found.push({ note, grant }));
      const notes = found.filter(({ note, grant }) => live.has(grant) && (!revision || revision === note.revision)).map(item => item.note);
      if (!heading) {
        if (notes.length !== 1) return unavailableResult();
        const [note] = notes;
        return protectedExcerpt(note, 0, note.body.length, note.title);
      }

      const matches = new Map();
      for (const note of notes) {
        for (const anchor of note.headings.filter(item => item.name === heading)) {
          const start = anchor.line - note.bodyStart - 1;
          // If two enclosing grants include the same anchor, prefer the explicitly requested grant.
          if (!matches.has(anchor.line) || note.title === heading) {
            matches.set(anchor.line, { note, start, end: sectionEnd(note, anchor) });
          }
        }
      }
      if (matches.size !== 1) return unavailableResult();
      const [{ note, start, end }] = matches.values();
      return protectedExcerpt(note, start, end, heading);
    },

    async explore({ document_id }) {
      if (!(await grants()).some(item => item.path === document_id)) return unavailableResult();
      const found = [];
      const live = await visitNotes(undefined, ({ path, title, revision, links }, grant) => found.push({ path, title, revision, links, grant }));
      const notes = found.filter(note => live.has(note.grant));
      const origin = notes.filter(note => note.path === document_id);
      if (!origin.length) return unavailableResult();
      const byPath = new Map(notes.map(note => [note.path, note]));
      const relations = new Map();
      for (const link of new Set(origin.flatMap(note => note.links))) {
        const key = normalize(link.replace(/\.md$/i, ""));
        const matches = [...byPath.values()].filter(note => {
          const path = note.path.slice(0, -3);
          return normalize(key.includes("/") ? path : basename(path)) === key;
        });
        if (matches.length === 1 && matches[0].path !== document_id) {
          const note = matches[0];
          relations.set(note.path, { document_id: note.path, title: note.title, heading: note.title, revision: note.revision, relation: "wikilink" });
        }
      }
      return { status: "ok", document_id, relations: [...relations.values()].slice(0, 12) };
    }
  };
}
