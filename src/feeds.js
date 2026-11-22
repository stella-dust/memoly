import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const isReadError = (error) => [
  "ENOENT", "ENOTDIR", "ELOOP", "EISDIR", "EACCES", "EPERM", "unavailable", "ERR_ENCODING_INVALID_ENCODED_DATA"
].includes(error?.code);

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
  const supersedeFeedPending = db.prepare(`
    UPDATE maintenance_jobs SET status='superseded'
    WHERE status='pending' AND id IN (SELECT job_id FROM maintenance_feed_jobs WHERE feed_id=?) AND revision<>?
  `);

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
      if (isReadError(error)) return { status: "source_unavailable" };
      throw error;
    }
    if (evidence.status !== "ok" || evidence.truncated) return { status: "source_unavailable" };
    const revision = evidence.citation.revision;
    const digest = hash(evidence.excerpt);
    const previous = knownByContent.all(id, digest);
    if (previous.some(job =>
      job.status === "published" ||
      (job.status === "rejected" && !job.stale_on_reject) ||
      job.revision === revision
    )) {
      return { status: "unchanged" };
    }

    // The same excerpt revision always reserves the same output, even across interrupted or concurrent scans.
    const target = posix.join(feed.output_dir, `review-${id}-${digest.slice(0, 12)}-${revision}.md`);
    if (!findFeed.get(id)?.enabled || !eligible(feed.client_id)) return { status: "unavailable" };
    let existing = jobAt.get(target);
    if (!existing) {
      try {
        await store.api.createJob({
          client_id: feed.client_id, source: feed.source, heading: feed.heading, revision, target,
          auditClient: feed.client_id, auditTool: "feed_queue_job"
        });
      } catch (error) {
        existing = jobAt.get(target);
        if (!existing) {
          if (error.status === 409) return { status: "target_conflict" };
          if (error.status === 400 || error.status === 404 || isReadError(error)) return { status: "source_or_target_unavailable" };
          throw error;
        }
      }
      existing ||= jobAt.get(target);
    }
    if (!existing || existing.source !== feed.source || existing.heading !== feed.heading ||
        existing.client_id !== feed.client_id || existing.revision !== revision) return { status: "target_conflict" };
    linkJob.run(existing.id, id, digest);
    supersedeFeedPending.run(id, revision);
    return existing.status === "pending" ? { status: "queued", task_id: existing.id } : { status: "unchanged" };
  }

  return {
    close: () => db.close(),
    list: () => db.prepare("SELECT * FROM maintenance_feeds ORDER BY client_id,source,heading").all(),
    jobFeedMap: () => Object.fromEntries(db.prepare("SELECT job_id, feed_id FROM maintenance_feed_jobs").all().map(r => [r.job_id, r.feed_id])),
    async add(client, source, heading, output) {
      if (!eligible(client)) throw Object.assign(new Error("连接器缺少维护授权"), { status: 404, code: "not_found_or_unavailable" });
      store.api.validateOutputDirectory(output);
      const evidence = await sourceSection(source, heading);
      if (evidence.status !== "ok" || evidence.truncated) {
        throw Object.assign(new Error("请选用可读取且长度适合的唯一 Markdown 章节"), { status: 400, code: "invalid_input" });
      }
      const id = hash(JSON.stringify([client, source, heading, output])).slice(0, 12);
      db.prepare(`
        INSERT INTO maintenance_feeds VALUES (?,?,?,?,?,1)
        ON CONFLICT(client_id,source,heading,output_dir) DO UPDATE SET enabled=1
      `).run(id, client, source, heading, output);
      store.audit({ tool: "enable_maintenance_feed", status: "ok", id });
      return { id, status: "enabled" };
    },
    disable(id) {
      const result = db.prepare("UPDATE maintenance_feeds SET enabled=0 WHERE id=? AND enabled=1").run(id);
      if (!Number(result.changes)) throw Object.assign(new Error("维护订阅不可用"), { status: 404, code: "not_found_or_unavailable" });
      store.audit({ tool: "disable_maintenance_feed", status: "disabled", id });
      return { id, status: "disabled" };
    },
    scan,
    async listForClient(client) {
      if (!eligible(client)) return { status: "not_found_or_unavailable" };
      // Bound the batch and return only task IDs. Evidence leaves the process exclusively through the read tool.
      const registered = db.prepare("SELECT id FROM maintenance_feeds WHERE client_id=? AND enabled=1 ORDER BY id").all(client);
      for (const { id } of registered) {
        try { await scan(id); } catch (error) { if (!isReadError(error)) throw error; }
      }
      if (!eligible(client)) return { status: "not_found_or_unavailable" };
      const pending = db.prepare(`
        SELECT id AS task_id, source, heading, revision
        FROM maintenance_jobs
        WHERE client_id=? AND status='pending' ORDER BY created_at
      `).all(client);
      const jobs = [];
      const revisionByPath = new Map();
      for (const row of pending) {
        if (!revisionByPath.has(row.source)) {
          let revision = null;
          try { revision = (await store.api.note(row.source)).revision; }
          catch (error) {
            if (!isReadError(error)) throw error;
          }
          revisionByPath.set(row.source, revision);
        }
        if (revisionByPath.get(row.source) !== row.revision) continue;
        jobs.push({ task_id: row.task_id });
        if (jobs.length === 10) break;
      }
      return { status: jobs.length ? "ok" : "no_work", jobs };
    }
  };
}
