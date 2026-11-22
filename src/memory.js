import { randomUUID } from "node:crypto";
import { z } from "zod";
import { matchScore, searchable, searchQuery } from "./search.js";

export const memoryKey = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
export const memoryProposal = z.strictObject({
  key: memoryKey,
  statement: z.string().trim().min(1).max(4000),
  kind: z.enum(["preference", "event", "decision", "lesson", "fact_update", "feedback"]).optional(),
  context: z.string().trim().max(500).optional(),
  source: z.string().trim().max(500).optional(),
  expected_version: z.number().int().positive().max(2147483646).optional()
});

export const memorySearch = z.strictObject({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(12).optional()
});

const ownerApproval = z.strictObject({
  readers: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/)).max(32),
  expires_at: z.iso.datetime({ offset: true }).nullable().optional()
});

const candidateId = z.uuid();
const unavailable = () => ({ status: "not_found_or_unavailable" });

function problem(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function check(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw problem("请检查记忆字段与格式", "invalid_memory_input", 400);
  return parsed.data;
}

function now() { return new Date().toISOString(); }

function memoryView(row) {
  return {
    key: row.key,
    statement: row.statement,
    kind: row.kind,
    context: row.context,
    source: row.source,
    version: row.version,
    expires_at: row.expires_at
  };
}

export function createMemory(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_memory (
      candidate_id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      statement TEXT NOT NULL,
      kind TEXT NOT NULL,
      context TEXT NOT NULL,
      source TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      expected_version INTEGER,
      version INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending','active','superseded','revoked','rejected')),
      readers TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      approved_at TEXT,
      UNIQUE(key, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS personal_memory_one_active
      ON personal_memory(key) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS personal_memory_pending
      ON personal_memory(key, submitted_by) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS personal_memory_events (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      version INTEGER
    );
  `);

  const all = db.prepare("SELECT * FROM personal_memory ORDER BY submitted_at DESC, rowid DESC");
  const candidate = db.prepare("SELECT * FROM personal_memory WHERE candidate_id = ? AND status = 'pending'");
  const current = db.prepare("SELECT * FROM personal_memory WHERE key = ? AND version IS NOT NULL ORDER BY version DESC LIMIT 1");
  const samePending = db.prepare(`
    SELECT candidate_id FROM personal_memory
    WHERE status = 'pending' AND key = ? AND statement = ? AND kind = ? AND context = ? AND source = ?
      AND submitted_by = ? AND expected_version IS ?
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO personal_memory(candidate_id,key,statement,kind,context,source,submitted_by,submitted_at,expected_version,status)
    VALUES(?,?,?,?,?,?,?,?,?,'pending')
  `);
  const retire = db.prepare("UPDATE personal_memory SET status = ? WHERE candidate_id = ?");
  const activate = db.prepare(`
    UPDATE personal_memory SET status = 'active', version = ?, readers = ?, expires_at = ?, approved_at = ?
    WHERE candidate_id = ?
  `);
  const pendingForKey = db.prepare("SELECT candidate_id FROM personal_memory WHERE key = ? AND status = 'pending'");
  const eventWrite = db.prepare(`
    INSERT INTO personal_memory_events(at,action,actor,candidate_id,version) VALUES(?,?,?,?,?)
  `);
  const visibility = `m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?)
    AND EXISTS(SELECT 1 FROM json_each(m.readers) AS audience WHERE audience.value = ?)`;
  const getVisible = db.prepare(`SELECT m.* FROM personal_memory m WHERE ${visibility} AND m.key = ?`);
  const listVisible = db.prepare(`SELECT m.* FROM personal_memory m WHERE ${visibility} ORDER BY m.approved_at DESC`);

  const transact = work => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    list() {
      const at = now();
      return all.all().map(row => ({
        ...row,
        readers: JSON.parse(row.readers),
        status: row.status === "active" && row.expires_at && row.expires_at <= at ? "expired" : row.status
      }));
    },

    submit(clientId, input) {
      const { key, statement, kind = "preference", context = "", source = "", expected_version = null } = check(memoryProposal, input);
      return transact(() => {
        // Do not inspect the active version for an Agent with candidate-only access.
        // The owner sees and resolves any mismatch while approving the candidate.
        const existing = samePending.get(key, statement, kind, context, source, clientId, expected_version);
        if (existing) return { status: "pending", candidate_id: existing.candidate_id };
        const id = randomUUID();
        const at = now();
        insert.run(id, key, statement, kind, context, source, clientId, at, expected_version);
        eventWrite.run(at, "submit", clientId, id, null);
        return { status: "pending", candidate_id: id };
      });
    },

    approve(id, options) {
      check(candidateId, id);
      const { readers, expires_at } = check(ownerApproval, options);
      const expiryDate = expires_at ? new Date(expires_at) : null;
      if (expiryDate && !Number.isFinite(expiryDate.valueOf())) {
        throw problem("记忆有效期无效", "invalid_memory_expiry", 400);
      }
      const expiry = expiryDate?.toISOString() ?? null;
      return transact(() => {
        const pending = candidate.get(id);
        if (!pending) throw problem("候选已处理或不存在", "memory_candidate_unavailable", 404);
        const at = now();
        if (expiry && expiry <= at) throw problem("记忆有效期须晚于当前时间", "invalid_memory_expiry", 400);
        const previous = current.get(pending.key);
        if (previous?.status === "revoked" || (previous?.version ?? null) !== pending.expected_version) {
          throw problem("记忆基准已变化，请按当前状态重新提交候选", "memory_version_conflict", 409);
        }
        const version = (previous?.version ?? 0) + 1;
        if (previous) retire.run("superseded", previous.candidate_id);
        activate.run(version, JSON.stringify([...new Set(readers)]), expiry, at, id);
        eventWrite.run(at, "approve", "owner", id, version);
        return { status: "active", candidate_id: id, key: pending.key, version };
      });
    },

    revoke(key) {
      const validKey = check(memoryKey, key);
      return transact(() => {
        const row = current.get(validKey);
        if (!row || row.status !== "active") return unavailable();
        const at = now();
        retire.run("revoked", row.candidate_id);
        eventWrite.run(at, "revoke", "owner", row.candidate_id, row.version);
        for (const pending of pendingForKey.all(validKey)) {
          retire.run("rejected", pending.candidate_id);
          eventWrite.run(at, "reject_after_revoke", "owner", pending.candidate_id, null);
        }
        return { status: "revoked", key: validKey, version: row.version };
      });
    },

    reject(id) {
      check(candidateId, id);
      return transact(() => {
        if (!candidate.get(id)) return unavailable();
        retire.run("rejected", id);
        eventWrite.run(now(), "reject", "owner", id, null);
        return { status: "rejected", candidate_id: id };
      });
    },

    read(clientId, key) {
      const validKey = check(memoryKey, key);
      const row = getVisible.get(now(), clientId, validKey);
      return row ? { status: "ok", memory: memoryView(row) } : unavailable();
    },

    search(clientId, input) {
      const { query, limit = 6 } = check(memorySearch, input);
      const parsed = searchQuery(query);
      if (!parsed.terms.length && !parsed.bigrams.length) {
        return { status: "no_evidence", results: [] };
      }
      const scored = [];
      for (const row of listVisible.all(now(), clientId)) {
        const index = searchable([row.key, row.statement, row.context].filter(Boolean).join("\n"));
        const score = matchScore(index, parsed);
        if (score > 0) scored.push({ score, memory: memoryView(row) });
      }
      scored.sort((left, right) => right.score - left.score);
      const results = scored.slice(0, limit).map(item => item.memory);
      return { status: results.length ? "ok" : "no_evidence", results };
    }
  };
}
