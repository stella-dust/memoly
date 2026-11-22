import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail } from "./store.js";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const validSegment = /^[\p{L}\p{N}_][\p{L}\p{N}_. -]*$/u;
const isRelativeDirectory = (path) => typeof path === "string" && path.length <= 540 &&
  path.split("/").every(part => validSegment.test(part) && !/[. ]$/.test(part) && part.length <= 100);

export function createFeeds(store) {
  const db = new DatabaseSync(join(store.state, "memoly.sqlite"));
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS maintenance_feeds (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES connectors(id),
      source TEXT NOT NULL,
      heading TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(client_id,source,heading,output_dir)
    );
    CREATE TABLE IF NOT EXISTS maintenance_feed_jobs (
      job_id TEXT PRIMARY KEY REFERENCES maintenance_jobs(id),
      feed_id TEXT NOT NULL REFERENCES maintenance_feeds(id),
      fingerprint TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feed_job_lookup ON maintenance_feed_jobs(feed_id,fingerprint);
  `);
  const findFeed = db.prepare("SELECT * FROM maintenance_feeds WHERE id=?");
  const knownByContent = db.prepare(`
    SELECT j.* FROM maintenance_feed_jobs f JOIN maintenance_jobs j ON j.id=f.job_id
    WHERE f.feed_id=? AND f.fingerprint=? ORDER BY j.created_at DESC
  `);
  const jobAt = db.prepare("SELECT * FROM maintenance_jobs WHERE target=?");
  const linkJob = db.prepare("INSERT OR IGNORE INTO maintenance_feed_jobs VALUES (?,?,?)");

  function eligible(id) {
    const client = store.getClient(id);
    return client?.active && client.scopes.includes("maintenance");
  }

  async function sourceSection(source, heading) {
    const note = await store.api.note(source);
    return store.api.maintenanceEvidence(source, heading, note.revision);
  }

  async function scan(id) {
    const feed = findFeed.get(id);
    if (!feed?.enabled || !eligible(feed.client_id)) return { status: "unavailable" };
    let evidence;
    try {
      evidence = await sourceSection(feed.source, feed.heading);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "unavailable"].includes(error.code)) return { status: "source_unavailable" };
      throw error;
    }
    if (evidence.status !== "ok" || evidence.truncated) return { status: "source_unavailable" };
    const revision = evidence.citation.revision;
    const digest = hash(evidence.excerpt);
    const previous = knownByContent.all(id, digest);
    if (previous.some(job => job.status === "published" || job.status === "rejected" || job.revision === revision)) {
      return { status: "unchanged" };
    }

    // The same excerpt revision always reserves the same output, even across interrupted or concurrent scans.
    const target = posix.join(feed.output_dir, `review-${id}-${digest.slice(0, 12)}-${revision}.md`);
    if (!findFeed.get(id)?.enabled || !eligible(feed.client_id)) return { status: "unavailable" };
    let existing = jobAt.get(target);
    if (!existing) {
      try {
        await store.api.createJob({ client_id: feed.client_id, source: feed.source, heading: feed.heading, revision, target });
      } catch (error) {
        existing = jobAt.get(target);
        if (!existing) {
          if (error.status === 409) return { status: "target_conflict" };
          if (error.status === 400 || error.status === 404 || error.code === "ENOENT") return { status: "source_or_target_unavailable" };
          throw error;
        }
      }
      existing ||= jobAt.get(target);
    }
    if (!existing || existing.source !== feed.source || existing.heading !== feed.heading ||
        existing.client_id !== feed.client_id || existing.revision !== revision) return { status: "target_conflict" };
    linkJob.run(existing.id, id, digest);
    return existing.status === "pending" ? { status: "queued", task_id: existing.id } : { status: "unchanged" };
  }

  return {
    close: () => db.close(),
    list: () => db.prepare("SELECT * FROM maintenance_feeds ORDER BY client_id,source,heading").all(),
    async add(client, source, heading, output) {
      if (!eligible(client)) throw fail("连接器缺少维护授权", 404);
      const { writeRoot, vault } = store.api.status();
      if (!writeRoot || !isRelativeDirectory(output) || !(output === writeRoot || output.startsWith(writeRoot + "/"))) {
        throw fail("输出目录必须位于已选写入目录之内");
      }
      let path = vault.root;
      for (const part of output.split("/")) {
        path = join(path, part);
        if (!(await lstat(path)).isDirectory()) throw fail("输出目录必须已存在且不包含符号链接");
      }
      const evidence = await sourceSection(source, heading);
      if (evidence.status !== "ok" || evidence.truncated) throw fail("请选用可读取且长度适合的唯一 Markdown 章节");
      const id = hash(JSON.stringify([client,source,heading,output])).slice(0,12);
      db.prepare(`
        INSERT INTO maintenance_feeds VALUES (?,?,?,?,?,1)
        ON CONFLICT(client_id,source,heading,output_dir) DO UPDATE SET enabled=1
      `).run(id, client, source, heading, output);
      store.audit({ tool: "enable_maintenance_feed", status: "ok", id });
      return { id, status: "enabled" };
    },
    disable(id) {
      const result = db.prepare("UPDATE maintenance_feeds SET enabled=0 WHERE id=? AND enabled=1").run(id);
      if (!Number(result.changes)) throw fail("维护订阅不可用", 404);
      store.audit({ tool: "disable_maintenance_feed", status: "disabled", id });
      return { id, status: "disabled" };
    },
    scan,
    async listForClient(client) {
      if (!eligible(client)) return { status: "not_found_or_unavailable" };
      // Bound the batch and return only task IDs. Evidence leaves the process exclusively through the read tool.
      const registered = db.prepare("SELECT id FROM maintenance_feeds WHERE client_id=? AND enabled=1 ORDER BY id").all(client);
      for (const { id } of registered) await scan(id);
      if (!eligible(client)) return { status: "not_found_or_unavailable" };
      const pending = db.prepare(`
        SELECT id AS task_id, source, heading, revision, f.job_id AS feed_job
        FROM maintenance_jobs j LEFT JOIN maintenance_feed_jobs f ON f.job_id=j.id
        WHERE j.client_id=? AND j.status='pending' ORDER BY j.created_at
      `).all(client);
      const jobs = [];
      const revisionByPath = new Map();
      for (const row of pending) {
        if (row.feed_job) {
          if (!revisionByPath.has(row.source)) {
            let revision = null;
            try { revision = (await store.api.note(row.source)).revision; }
            catch (error) {
              if (!["ENOENT", "ENOTDIR", "unavailable"].includes(error.code)) throw error;
            }
            revisionByPath.set(row.source, revision);
          }
          if (revisionByPath.get(row.source) !== row.revision) continue;
        }
        jobs.push({ task_id: row.task_id });
        if (jobs.length === 10) break;
      }
      return { status: jobs.length ? "ok" : "no_work", jobs };
    }
  };
}
