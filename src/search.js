export const normalize = text => text.normalize("NFKC").toLowerCase();

const Han = /\p{Script=Han}/u;
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopWords = new Set(["如何", "哪些", "什么", "是否", "一下", "请问", "what", "which", "how", "does", "is", "the", "a", "of"]);
const foldHan = text => text.replace(/(?<=\p{Script=Han})[\p{P}\s]+(?=\p{Script=Han})/gu, "");
const foldHanPunct = text => text.replace(/(?<=\p{Script=Han})\p{P}+(?=\p{Script=Han})/gu, "");

export function searchable(text) {
  const literal = normalize(text);
  return { literal, folded: Han.test(literal) ? foldHan(literal) : literal };
}

export function searchQuery(value) {
  const trimmed = value.trim();
  const literal = normalize(trimmed);
  const rawChunks = trimmed.split(/\s+/).filter(Boolean);
  const chunks = [];
  const terms = new Set();
  const bigrams = new Set();

  for (const raw of rawChunks) {
    const normChunk = normalize(raw);
    const foldedChunk = Han.test(normChunk) ? foldHanPunct(normChunk) : normChunk;
    if (foldedChunk) chunks.push(foldedChunk);

    const spans = foldedChunk.match(/\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+(?:[-_.](?:(?!\p{Script=Han})[\p{L}\p{N}])+)*/gu) || [];
    for (const span of spans) {
      if (!Han.test(span)) {
        if (!stopWords.has(span)) terms.add(span);
        continue;
      }
      for (const { segment, isWordLike } of segmenter.segment(span)) {
        if (isWordLike && !stopWords.has(segment) && (segment.length > 1 || (chunks.length === 1 && spans.length === 1 && segment === foldedChunk))) {
          terms.add(segment);
        }
      }
      const chars = Array.from(span);
      for (let i = 1; i < chars.length; i++) {
        const pair = chars[i - 1] + chars[i];
        if (!/[的了么吗呢着]/u.test(pair) && !stopWords.has(pair)) bigrams.add(pair);
      }
    }
  }

  return {
    literal,
    folded: chunks.length === 1 ? chunks[0] : literal,
    chunks: chunks.slice(0, 8),
    terms: [...terms].slice(0, 16),
    bigrams: [...bigrams].slice(0, 32)
  };
}

export function matchScore(row, query) {
  if (!query.literal) return 0;
  if (row.literal.includes(query.literal)) return 12;
  if (query.chunks.length <= 1) {
    if (query.folded !== query.literal && row.folded.includes(query.folded)) return 12;
    if (row.folded !== row.literal && row.folded.includes(query.folded)) return 12;
  } else if (query.chunks.every(chunk => row.folded.includes(chunk))) {
    return 10;
  }
  const words = query.terms.filter(term => row.folded.includes(term)).length;
  if (words) return 2 + words * 2;
  const pairHits = query.bigrams.filter(term => row.folded.includes(term)).length;
  return pairHits >= 2 ? 1 : 0;
}

function foldedOffsetInLine(line, candidates) {
  let acc = "";
  const offsets = [];
  for (let i = 0; i < line.length;) {
    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const norm = normalize(ch);
    for (let j = 0; j < norm.length; j++) offsets.push(i);
    acc += norm;
    i += ch.length;
  }
  const skipped = new Set();
  for (const m of acc.matchAll(/(?<=\p{Script=Han})[\p{P}\s]+(?=\p{Script=Han})/gu)) {
    for (let k = m.index; k < m.index + m[0].length; k++) skipped.add(k);
  }
  let folded = "";
  const foldedMap = [];
  for (let k = 0; k < acc.length; k++) {
    if (skipped.has(k)) continue;
    folded += acc[k];
    foldedMap.push(offsets[k] ?? k);
  }
  const hits = candidates.map(t => folded.indexOf(t)).filter(at => at >= 0);
  return hits.length ? (foldedMap[Math.min(...hits)] ?? 0) : -1;
}

export function excerptFor(line, query) {
  const normalized = normalize(line);
  const candidates = [query.literal, ...query.chunks, ...query.terms, ...query.bigrams].filter(Boolean);
  const direct = candidates.map(term => normalized.indexOf(term)).filter(at => at >= 0);
  let offset;
  if (direct.length) {
    offset = Math.max(0, Math.min(...direct) - 55);
  } else {
    const mapped = foldedOffsetInLine(line, candidates);
    offset = mapped >= 0 ? Math.max(0, mapped - 55) : 0;
  }
  return line.slice(offset, offset + 420);
}
