import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, closeSync, fstatSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProjection, inspectNote, listFolder, makeVault } from "./vault.js";
import { createMemory } from "./memory.js";

export const scopes = ["knowledge", "memory:read", "memory:submit", "maintenance"];
export const fail = (message, status = 400, code = "invalid_input") => Object.assign(new Error(message), { status, code });
const absent = () => fail("内容或授权不可用", 404, "not_found_or_unavailable");
const conflict = (message) => fail(message, 409, "conflict");
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
const cleanId = (id) => typeof id === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(id) && id !== "owner";

function relativeParts(value) {
  if (typeof value !== "string" || value.length > 640 || /[\\\u0000-\u001f\u007f]/u.test(value)) throw fail("请输入 Vault 内相对路径");
  const parts = value.split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part.toLowerCase() === "_archive" || part.includes(":"))) {
    throw fail("路径超出允许目录");
  }
  return parts;
}

function directory(root, relative) {
  let path = root;
  for (const part of relativeParts(relative)) {
    path = join(path, part);
    if (!lstatSync(path).isDirectory()) throw fail("输出目录必须已存在且不经过符号链接");
  }
  return path;
}

function requirePrivate(path, asDirectory) {
  const stat = lstatSync(path);
  if ((asDirectory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o077)) {
    throw fail("Memoly 状态需要私有目录与文件权限");
  }
}

function stateDirectory(path, create) {
  const full = resolve(path);
  if (create) mkdirSync(full, { recursive: true, mode: 0o700 });
  requirePrivate(full, true);
  return realpathSync(full);
}

function tokenFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size !== 65) throw absent();
    const text = readFileSync(fd, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(text)) throw absent();
    return text;
  } finally {
    closeSync(fd);
  }
}

function dbAt(state, create) {
  const path = join(state, "memoly.sqlite");
  if (create) {
    try { writeFileSync(path, "", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  requirePrivate(path, false);
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY, scopes TEXT NOT NULL, token_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS shared_sections (
      client_id TEXT NOT NULL REFERENCES connectors(id), path TEXT NOT NULL, heading TEXT NOT NULL, revision TEXT NOT NULL,
      PRIMARY KEY (client_id, path)
    );
    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES connectors(id),
      source TEXT NOT NULL, heading TEXT NOT NULL, revision TEXT NOT NULL, target TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, title TEXT, content TEXT,
      output_revision TEXT, published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS activity (
      sequence INTEGER PRIMARY KEY, at TEXT NOT NULL, client TEXT NOT NULL, client_name TEXT,
      tool TEXT NOT NULL, status TEXT NOT NULL, target_id TEXT, revision TEXT
    );
  `);
  return db;
}

function transaction(db, apply) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = apply();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function scopedProjection(vault, entries, options) {
  return createProjection(vault, async () => {
    const rows = entries();
    return {
      documents: rows.map(({ path }) => path),
      sections: Object.fromEntries(rows.map(({ path, heading, revision }) => [path, { heading, revision }]))
    };
  }, options);
}

function formatOutput(row, publishedAt) {
  const date = publishedAt.slice(0, 10);
  const source = row.source + "#L" + row.start_line + "-L" + row.end_line;
  return [
    "---", "title: " + JSON.stringify(row.title), "created: " + date, "updated: " + date,
    "type: knowledge", "status: inbox", "tags: [memoly]", "sources: [" + JSON.stringify(source) + "]",
    "---", "", "# " + row.title, "", row.content, "",
    "来源版本 `" + row.revision + "` · L" + row.start_line + "–L" + row.end_line, ""
  ].join("\n");
}

export async function initStore(path, vaultPath, writeRoot) {
  const vault = await makeVault(resolve(vaultPath));
  if (writeRoot) directory(vault.root, writeRoot);
  const state = stateDirectory(path, true);
  if (state === vault.root || state.startsWith(vault.root + "/")) throw fail("状态目录必须位于 Vault 外");
  const db = dbAt(state, true);
  try {
    transaction(db, () => {
      if (db.prepare("SELECT 1 FROM settings WHERE name = 'vault'").get()) throw conflict("该状态目录已经初始化");
      const add = db.prepare("INSERT INTO settings(name,value) VALUES (?,?)");
      add.run("vault", vault.root);
      if (writeRoot) add.run("write_root", writeRoot);
    });
    return { vault, writeRoot: writeRoot || null, state };
  } finally {
    db.close();
  }
}

export async function openStore(path, { requireVault = true } = {}) {
  const state = stateDirectory(path, false);
  const db = dbAt(state, false);
  const config = Object.fromEntries(db.prepare("SELECT name,value FROM settings").all().map(({ name, value }) => [name, value]));
  const vault = requireVault ? await makeVault(config.vault) : { root: config.vault, name: basename(config.vault) };
  const writeRoot = config.write_root || null;
  const memory = createMemory(db);
  const getClient = (id) => {
    const row = db.prepare("SELECT id, scopes, active FROM connectors WHERE id = ?").get(id);
    return row ? { id: row.id, scopes: JSON.parse(row.scopes), active: Boolean(row.active) } : null;
  };
  const expectClient = (id, scope) => {
    const client = getClient(id);
    if (!client?.active || !client.scopes.includes(scope)) throw absent();
    return client;
  };
  const authenticate = (id, credential) => {
    const row = db.prepare("SELECT token_hash,active FROM connectors WHERE id = ?").get(id);
    if (!row?.active || !/^[a-f0-9]{64}$/.test(credential)) return null;
    return timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(fingerprint(credential))) ? getClient(id) : null;
  };
  const shares = () => db.prepare("SELECT * FROM shared_sections ORDER BY client_id,path").all();
  const jobs = () => db.prepare("SELECT * FROM maintenance_jobs ORDER BY created_at DESC").all();
  const findJob = (id) => db.prepare("SELECT * FROM maintenance_jobs WHERE id = ?").get(id);
  const section = (source, heading, revision) => {
    const projection = scopedProjection(vault, () => [{ path: source, heading, revision }], { maintenance: true });
    return projection.read({ document_id: source, heading, revision });
  };
  const targetPath = (target) => {
    relativeParts(target);
    if (!writeRoot || dirname(target) !== writeRoot || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(basename(target))) {
      throw fail("只可在配置的输出目录内新建小写英文 Markdown");
    }
    return join(directory(vault.root, writeRoot), basename(target));
  };

  function audit({ client = "owner", clientName = null, tool, status, id = null, revision = null }) {
    db.prepare("INSERT INTO activity(at,client,client_name,tool,status,target_id,revision) VALUES (?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), client, typeof clientName === "string" ? clientName.slice(0, 80) : null,
        tool, status, typeof id === "string" ? id.slice(0, 640) : null,
        ["string", "number"].includes(typeof revision) ? String(revision).slice(0, 64) : null);
  }
  const maintenance = {
    list(id) {
      expectClient(id, "maintenance");
      const pending = db.prepare("SELECT id AS task_id FROM maintenance_jobs WHERE client_id = ? AND status = 'pending' ORDER BY created_at LIMIT 10").all(id);
      return { status: pending.length ? "ok" : "no_work", jobs: pending };
    },
    async read(id, taskId) {
      expectClient(id, "maintenance");
      const row = findJob(taskId);
      if (row?.client_id !== id || row.status !== "pending") return { status: "not_found_or_unavailable" };
      const evidence = await section(row.source, row.heading, row.revision);
      if (evidence.status !== "ok" || evidence.truncated) return { status: "not_found_or_unavailable" };
      if (findJob(taskId)?.status !== "pending") return { status: "not_found_or_unavailable" };
      expectClient(id, "maintenance");
      return { ...evidence, task_id: row.id, instruction: "依据这一节提出整理后的 Markdown 草稿，保留条件和未知。内容供本人复核。" };
    },
    async submit(id, { task_id: taskId, title, content }) {
      expectClient(id, "maintenance");
      const row = findJob(taskId);
      if (row?.client_id !== id) return { status: "not_found_or_unavailable" };
      const normalizedTitle = title?.trim();
      const normalizedContent = content?.trim();
      if (typeof normalizedTitle !== "string" || normalizedTitle.length < 2 || normalizedTitle.length > 120 ||
          /[\r\n\u0000]/.test(normalizedTitle) || typeof normalizedContent !== "string" || normalizedContent.length < 2 ||
          normalizedContent.length > 8000 || normalizedContent.includes("\u0000")) throw fail("整理提案超出输入范围");
      if (row.status === "proposed" && row.title === normalizedTitle && row.content === normalizedContent) {
        return { status: "proposed", task_id: taskId };
      }
      if (row.status !== "pending") return { status: "not_found_or_unavailable" };
      if ((await section(row.source, row.heading, row.revision)).status !== "ok") return { status: "not_found_or_unavailable" };
      expectClient(id, "maintenance");
      const update = db.prepare("UPDATE maintenance_jobs SET title=?,content=?,status='proposed' WHERE id=? AND status='pending'")
        .run(normalizedTitle, normalizedContent, taskId);
      return Number(update.changes) ? { status: "proposed", task_id: taskId } : { status: "conflict" };
    }
  };

  const api = {
    status: () => ({ vault, writeRoot, shares: shares().length }),
    tree: (path) => listFolder(vault, path),
    note: (path) => inspectNote(vault, path),
    clients: () => db.prepare("SELECT id,scopes,active FROM connectors ORDER BY id").all().map(row => ({
      ...row, active: Boolean(row.active), scopes: JSON.parse(row.scopes)
    })),
    shares,
    async share({ client_id: id, path, heading, revision }) {
      expectClient(id, "knowledge");
      const projection = scopedProjection(vault, () => [{ path, heading, revision }]);
      if ((await projection.read({ document_id: path, heading, revision })).status !== "ok") throw absent();
      return transaction(db, () => {
        expectClient(id, "knowledge");
        const count = db.prepare("SELECT count(*) AS count FROM shared_sections WHERE client_id=? AND path<>?").get(id, path).count;
        if (count >= 80) throw fail("每个连接器最多共享 80 个文档");
        db.prepare("INSERT INTO shared_sections VALUES (?,?,?,?) ON CONFLICT(client_id,path) DO UPDATE SET heading=excluded.heading,revision=excluded.revision")
          .run(id, path, heading, revision);
        audit({ tool: "share_knowledge", status: "ok", id: path, revision });
        return { status: "ok" };
      });
    },
    unshare({ client_id: id, path }) {
      db.prepare("DELETE FROM shared_sections WHERE client_id=? AND path=?").run(id, path);
      audit({ tool: "unshare_knowledge", status: "ok", id: path });
      return { status: "ok" };
    },
    jobs,
    async createJob({ source, heading, revision, target, client_id: id }) {
      expectClient(id, "maintenance");
      if (source === target) throw fail("原件和输出文件必须分开");
      const targetFile = targetPath(target);
      try { lstatSync(targetFile); throw conflict("输出文件已经存在"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const evidence = await section(source, heading, revision);
      if (evidence.status !== "ok" || evidence.truncated) throw fail("证据不可用或太长，请选择不超过 3500 字符的一节");
      const existing = db.prepare("SELECT id,status,client_id,source,heading,revision FROM maintenance_jobs WHERE target=?").get(target);
      if (existing) {
        if (existing.status === "pending" && existing.client_id === id && existing.source === source &&
            existing.heading === heading && existing.revision === revision) return { id: existing.id, status: "pending" };
        throw conflict("输出已存在任务，请指定新文件名");
      }
      expectClient(id, "maintenance");
      const taskId = randomUUID();
      try {
        db.prepare("INSERT INTO maintenance_jobs(id,client_id,source,heading,revision,target,created_at,start_line,end_line) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(taskId, id, source, heading, revision, target, new Date().toISOString(), evidence.citation.start_line, evidence.citation.end_line);
      } catch (error) {
        if (error.errcode === 2067) throw conflict("输出已被另一个任务占用");
        throw error;
      }
      audit({ tool: "approve_job_input", status: "pending", id: taskId, revision });
      return { id: taskId, status: "pending" };
    },
    async publishJob(id) {
      const row = findJob(id);
      if (row?.status === "published") return { status: "published", output_revision: row.output_revision };
      if (row?.status !== "proposed") throw absent();
      const evidence = await section(row.source, row.heading, row.revision);
      if (evidence.status !== "ok") throw conflict("原件版本已经变化，请在新任务中复核");
      return transaction(db, () => {
        const current = findJob(id);
        if (current.status === "published") return { status: "published", output_revision: current.output_revision };
        if (current.status !== "proposed") throw absent();
        const target = targetPath(current.target);
        const publishedAt = current.created_at;
        const text = formatOutput(current, publishedAt);
        const temporary = join(dirname(target), ".memoly-" + randomUUID() + ".tmp");
        writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
        try {
          linkSync(temporary, target);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          const stat = lstatSync(target);
          if (!stat.isFile() || stat.size !== Buffer.byteLength(text) || readFileSync(target, "utf8") !== text) {
            throw conflict("输出已存在，Memoly 保留现有文件");
          }
        } finally {
          unlinkSync(temporary);
        }
        const revision = fingerprint(text).slice(0, 16);
        db.prepare("UPDATE maintenance_jobs SET status='published',output_revision=?,published_at=? WHERE id=?")
          .run(revision, new Date().toISOString(), id);
        audit({ tool: "publish_job", status: "published", id, revision });
        return { status: "published", output_revision: revision };
      });
    },
    rejectJob(id) {
      const result = db.prepare("UPDATE maintenance_jobs SET status='rejected' WHERE id=? AND status IN ('pending','proposed')").run(id);
      if (!Number(result.changes)) throw absent();
      audit({ tool: "reject_job", status: "rejected", id });
      return { status: "rejected" };
    },
    memories: () => memory.list(),
    correctMemory: (input) => memory.submit("owner", input),
    approveMemory(id, { readers, expires_at }) {
      if (!Array.isArray(readers)) throw fail("请选择记忆接收方");
      for (const reader of readers) expectClient(reader, "memory:read");
      const result = memory.approve(id, { readers, expires_at });
      audit({ tool: "approve_memory", status: result.status, id, revision: result.version });
      return result;
    },
    rejectMemory(id) {
      const result = memory.reject(id);
      audit({ tool: "reject_memory", status: result.status, id });
      return result;
    },
    revokeMemory(key) {
      const result = memory.revoke(key);
      audit({ tool: "revoke_memory", status: result.status });
      return result;
    },
    audit: () => db.prepare("SELECT * FROM activity ORDER BY sequence DESC LIMIT 100").all()
  };

  return {
    state, api, memory, maintenance, audit, getClient,
    projection(id) {
      return scopedProjection(vault, () => db.prepare("SELECT path,heading,revision FROM shared_sections WHERE client_id=? ORDER BY path").all(id));
    },
    register(id, requestedScopes) {
      if (!cleanId(id) || !Array.isArray(requestedScopes) || !requestedScopes.length ||
          requestedScopes.some(scope => !scopes.includes(scope))) throw fail("连接器 ID 或权限无效");
      const credential = randomBytes(32).toString("hex");
      const keys = join(state, "connectors");
      mkdirSync(keys, { mode: 0o700, recursive: true });
      requirePrivate(keys, true);
      return transaction(db, () => {
        if (getClient(id)) throw conflict("连接器 ID 已使用，撤销后也不会复用");
        db.prepare("INSERT INTO connectors(id,scopes,token_hash) VALUES (?,?,?)").run(id, JSON.stringify([...new Set(requestedScopes)]), fingerprint(credential));
        writeFileSync(join(keys, id + ".key"), credential + "\n", { flag: "wx", mode: 0o600 });
        return getClient(id);
      });
    },
    getCredentialFile(id) {
      if (!cleanId(id) || !getClient(id)?.active) throw absent();
      const path = join(state, "connectors", id + ".key");
      if (!authenticate(id, tokenFile(path))) throw absent();
      return path;
    },
    bindClient(id, credentialFile) {
      if (!cleanId(id) || !credentialFile) throw absent();
      const credential = tokenFile(credentialFile);
      if (!authenticate(id, credential)) throw absent();
      return () => authenticate(id, credential);
    },
    revokeClient(id) {
      const result = db.prepare("UPDATE connectors SET active=0 WHERE id=? AND active=1").run(id);
      if (!Number(result.changes)) throw absent();
      audit({ tool: "revoke_connector", status: "revoked", id });
      return { status: "revoked" };
    },
    close: () => db.close()
  };
}
