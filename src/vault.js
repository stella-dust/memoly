import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".base", ".canvas", ".csv"]);
const PRIVATE_ROOTS = new Set(["_archive", "_meta", "memory", "outputs", "personal-ip"]);
const PRIVATE_FILES = new Set(["memory.md", "inbox.md", "handoff.md", "log.md"]);
const MAX_NOTE_BYTES = 384 * 1024;
const MAX_SHARED_NOTES = 80;
const isHidden = name => name.startsWith(".") || name === "node_modules";
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
      available: folder ? item.name !== "_archive" : TEXT_EXTENSIONS.has(extname(item.name).toLowerCase())
    };
  }).sort((left, right) => Number(right.folder) - Number(left.folder) ||
    left.name.localeCompare(right.name, "zh-Hans", { numeric: true }));
}

async function readVaultText(vault, path) {
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) throw unavailable();
  const full = await resolveLocal(vault.root, path);
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) throw unavailable();
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await file.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await file.stat();
    if (read !== stat.size || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw unavailable();
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      revision: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      updatedAt: stat.mtime.toISOString()
    };
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
  const links = [];
  let fence = "";
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    const fenceMarker = /^\s*([~`]{3,})/.exec(line)?.[1];
    if (fenceMarker && (!fence || fenceMarker[0] === fence[0])) {
      fence = fence ? "" : fenceMarker;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) headings.push({ name: heading[2], depth: heading[1].length, line: index + bodyStart + 1 });
    for (const link of line.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      links.push(link[1].trim().replace(/\\$/, ""));
    }
  }
  return {
    path, title: meta.title || headings.find(heading => heading.depth === 1)?.name || basename(path, extname(path)),
    ...data, meta, validProperties, headings, links: [...new Set(links)].slice(0, 60), body, bodyStart
  };
}

export async function inspectNote(vault, path) {
  const { body, bodyStart, ...note } = parseNote(path, await readVaultText(vault, path));
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

export function createProjection(vault, loadScope, { maintenance = false } = {}) {
  async function scopedPaths() {
    const { documents, sections = {} } = await loadScope();
    if (!Array.isArray(documents) || documents.length > MAX_SHARED_NOTES ||
        documents.some(doc => typeof doc !== "string") || !sections ||
        typeof sections !== "object" || Array.isArray(sections)) throw new Error("共享清单格式不正确");
    const paths = [...new Set(documents)].filter(path => {
      try { return mayShare(path, maintenance); } catch { return false; }
    });
    for (const [path, section] of Object.entries(sections)) {
      if (!documents.includes(path) || typeof section?.heading !== "string" || !section.heading.trim() ||
          typeof section.revision !== "string" || !/^[a-f0-9]{16}$/.test(section.revision)) {
        throw new Error("共享章节必须指定文档、标题及已核验的版本");
      }
    }
    return new Map(paths.map(path => [path, Object.hasOwn(sections, path) ? sections[path] : null]));
  }

  async function sharedNote(path, scope) {
    try {
      const note = parseNote(path, await readVaultText(vault, path));
      if (!note.validProperties || (!maintenance && inactive.has(note.meta.status?.toLowerCase()))) return null;
      if (!scope) return note;
      if (scope.revision !== note.revision) return null;
      const matches = note.headings.filter(heading => heading.name === scope.heading);
      if (matches.length !== 1) return null;
      const section = matches[0];
      const next = note.headings.find(heading => heading.line > section.line && heading.depth <= section.depth);
      const start = section.line - note.bodyStart - 1;
      const end = next ? next.line - note.bodyStart - 1 : note.body.length;
      const body = note.body.slice(start, end);
      while (body.length && !body.at(-1).trim()) body.pop();
      const sectionLinks = parseNote(path, { text: body.join("\n") }).links;
      return {
        ...note, title: section.name, body, bodyStart: section.line - 1, links: sectionLinks, scopedHeading: section.name,
        headings: note.headings.filter(heading => heading.line >= section.line && heading.line < section.line + body.length)
      };
    } catch { return null; }
  }

  async function sharedNotes() {
    const paths = await scopedPaths();
    return (await Promise.all([...paths].map(([path, scope]) => sharedNote(path, scope)))).filter(Boolean);
  }

  return {
    async status() {
      const notes = await sharedNotes();
      return { publishedDocuments: notes.length };
    },
    async search({ query, limit = 6 }) {
      const words = [...new Set(normalize(query).trim().split(/\s+/).filter(Boolean))].slice(0, 8);
      if (!words.length) return { status: "no_evidence", results: [] };
      const hits = [];
      for (const note of await sharedNotes()) {
        const titleScore = words.filter(word => normalize(note.title).includes(word)).length * 2;
        let bestScore = 0;
        let row = -1;
        for (const [index, line] of note.body.entries()) {
          if (!line.trim() || line.trim().startsWith("#")) continue;
          const count = words.filter(word => normalize(line).includes(word)).length;
          if (count > bestScore || (row < 0 && titleScore && line.trim().charAt(0) !== "#")) {
            bestScore = count;
            row = index;
          }
        }
        if (row >= 0 && (titleScore || bestScore)) {
          const line = row + note.bodyStart + 1;
          const heading = note.headings.findLast(item => item.line <= line)?.name || note.title;
          const matchLine = note.body[row];
          const firstMatch = words.reduce((at, word) => {
            const index = normalize(matchLine).indexOf(word);
            return index >= 0 ? Math.min(at, index) : at;
          }, matchLine.length);
          const offset = bestScore ? Math.max(0, firstMatch - 55) : 0;
          const excerpt = matchLine.slice(offset, offset + 420);
          hits.push({ score: titleScore + bestScore, excerpt, citation: citation(note, line, line, heading) });
        }
      }
      const results = hits.sort((a, b) => b.score - a.score).slice(0, limit);
      return { status: results.length ? "ok" : "no_evidence", results };
    },
    async read({ document_id, heading, revision }) {
      const paths = await scopedPaths();
      if (!paths.has(document_id)) return { status: "not_found_or_unavailable" };
      const note = await sharedNote(document_id, paths.get(document_id));
      if (!note || (revision && revision !== note.revision)) return { status: "not_found_or_unavailable" };
      const section = heading && note.headings.find(item => item.name === heading);
      if (heading && !section) return { status: "not_found_or_unavailable" };
      const start = section ? section.line - note.bodyStart - 1 : 0;
      const next = section && note.headings.find(item => item.line > section.line && item.depth <= section.depth);
      const end = next ? next.line - note.bodyStart - 1 : note.body.length;
      const lines = [];
      let size = 0;
      let truncated = false;
      for (const line of note.body.slice(start, end)) {
        if (size + line.length + 1 > 3500) {
          lines.push(line.slice(0, Math.max(0, 3500 - size)));
          truncated = true;
          break;
        }
        lines.push(line);
        size += line.length + 1;
      }
      const sourceLine = start + note.bodyStart + 1;
      return { status: "ok", excerpt: lines.join("\n"), truncated,
        citation: citation(note, sourceLine, sourceLine + Math.max(0, lines.length - 1), heading || note.scopedHeading || note.title) };
    },
    async explore({ document_id }) {
      if (!(await scopedPaths()).has(document_id)) return { status: "not_found_or_unavailable" };
      const notes = await sharedNotes();
      const origin = notes.find(note => note.path === document_id);
      if (!origin) return { status: "not_found_or_unavailable" };
      const relations = [];
      for (const link of origin.links) {
        const key = normalize(link.replace(/\.md$/i, ""));
        const matches = notes.filter(note =>
          (key.includes("/") ? normalize(note.path.slice(0, -3)) : normalize(basename(note.path, ".md"))) === key);
        if (matches.length === 1 && matches[0] !== origin && !relations.some(item => item.document_id === matches[0].path)) {
          const note = matches[0];
          relations.push({ document_id: note.path, title: note.title, revision: note.revision, relation: "wikilink" });
        }
      }
      return { status: "ok", document_id, relations: relations.slice(0, 12) };
    }
  };
}
