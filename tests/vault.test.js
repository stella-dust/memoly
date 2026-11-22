import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initStore, openStore } from "../src/store.js";
import { createProjection, makeVault } from "../src/vault.js";

async function testVault(t) {
  const base = await mkdtemp(join(tmpdir(), "memoly-vault-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const vault = join(base, "vault");
  const state = join(base, "state");
  await mkdir(join(vault, "notes"), { recursive: true });
  await initStore(state, vault, "notes");
  return { base, vault, state, dbPath: join(state, "memoly.sqlite") };
}

const source = [
  "# 值班指南", "",
  "## 交接规则", "现场交接清单需记录异常、复核结果。", "",
  "### 子步骤", "先核对班次。", "",
  "  ## 排故方案", "备用线路只供批准的工单使用。", "",
  "内部备注", "--------", "ScopeBoundaryMarker"
].join("\n") + "\n";

test("legacy chapter grants migrate without loss and the same note can share multiple exact sections", async t => {
  const { vault, state, dbPath } = await testVault(t);
  const path = "值班指南.md";
  await writeFile(join(vault, path), source);

  const original = await openStore(state);
  original.register("reader", ["knowledge"]);
  const { revision } = await original.api.note(path);
  await original.api.share({ client_id: "reader", path, heading: "交接规则", revision });
  original.close();

  // Recreate the 0.3.0 schema without changing the registered reader or stored data.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    ALTER TABLE shared_sections RENAME TO shared_sections_current;
    CREATE TABLE shared_sections (
      client_id TEXT NOT NULL REFERENCES connectors(id), path TEXT NOT NULL, heading TEXT NOT NULL,
      revision TEXT NOT NULL, PRIMARY KEY (client_id, path)
    );
    INSERT INTO shared_sections SELECT * FROM shared_sections_current;
    DROP TABLE shared_sections_current;
    ALTER TABLE maintenance_jobs DROP COLUMN publish_planned_at;
  `);
  legacy.close();

  const store = await openStore(state);
  try {
    const read = store.projection("reader");
    const single = await read.read({ document_id: path });
    assert.equal(single.citation.start_line, 3);
    assert.equal(single.citation.end_line, 7);
    assert.match(single.excerpt, /子步骤/u);
    assert.doesNotMatch(single.excerpt, /排故方案|ScopeBoundaryMarker/u);
    assert.equal((await read.read({ document_id: path, heading: "内部备注" })).status, "not_found_or_unavailable");

    await store.api.share({ client_id: "reader", path, heading: "排故方案", revision });
    assert.equal(store.api.shares().length, 2);
    assert.deepEqual(await read.status(), { publishedDocuments: 1 });
    assert.equal((await read.read({ document_id: path })).status, "not_found_or_unavailable");
    const second = await read.read({ document_id: path, heading: "排故方案", revision });
    assert.equal(second.citation.start_line, 9);
    assert.equal(second.citation.end_line, 10);
    assert.doesNotMatch(second.excerpt, /内部备注|ScopeBoundaryMarker/u);

    const match = (await read.search({ query: "异常复核" })).results[0];
    assert.equal(match.citation.start_line, 4);
    assert.equal(match.citation.heading, "交接规则");
    assert.match(match.excerpt, /异常、复核/u);
    assert.match((await read.search({ query: "如何查看现场交接清单？" })).results[0].excerpt, /交接清单/u);
    assert.deepEqual(await read.search({ query: "ScopeBoundaryMarker" }), { status: "no_evidence", results: [] });

    store.api.unshare({ client_id: "reader", path, heading: "交接规则" });
    assert.equal((await read.read({ document_id: path, heading: "交接规则" })).status, "not_found_or_unavailable");
    assert.equal((await read.read({ document_id: path })).citation.heading, "排故方案");

    const oldStat = await stat(join(vault, path));
    await writeFile(join(vault, path), source.replace("备用线路", "新版线路"));
    await utimes(join(vault, path), oldStat.atime, oldStat.mtime);
    assert.equal((await read.read({ document_id: path, heading: "排故方案" })).status, "not_found_or_unavailable");
    assert.equal((await read.search({ query: "新版线路" })).status, "no_evidence");

    const current = await store.api.note(path);
    await store.api.share({ client_id: "reader", path, heading: "排故方案", revision: current.revision });
    assert.equal((await read.read({ document_id: path })).citation.revision, current.revision);
    store.api.unshare({ client_id: "reader", path });
    assert.equal((await read.read({ document_id: path })).status, "not_found_or_unavailable");
  } finally {
    store.close();
  }
});

test("projection suppresses the result when the grant is removed during a file read", async t => {
  const { vault, state } = await testVault(t);
  const path = "source.md";
  await writeFile(join(vault, path), source);
  const folder = await makeVault(vault);
  const store = await openStore(state);
  try {
    const { revision } = await store.api.note(path);
    let calls = 0;
    const projection = createProjection(folder, () => ++calls === 1 ? [{ path, heading: "交接规则", revision }] : []);
    assert.equal((await projection.read({ document_id: path, heading: "交接规则" })).status, "not_found_or_unavailable");
    assert.equal(calls, 2);
  } finally {
    store.close();
  }
});

test("approved Unicode nested Markdown writes stay in scope and replay an interrupted publication", async t => {
  const { base, vault, state, dbPath } = await testVault(t);
  const path = "source.md";
  const output = "notes/周会资料/交接整理.md";
  await writeFile(join(vault, path), source);
  await mkdir(join(vault, "notes/周会资料"));
  await mkdir(join(vault, "notes-outside"));
  await symlink(base, join(vault, "notes", "shortcut"), "dir");

  const store = await openStore(state);
  const controls = new DatabaseSync(dbPath);
  try {
    store.register("worker", ["maintenance"]);
    const { revision } = await store.api.note(path);
    const make = target => store.api.createJob({ client_id: "worker", source: path, heading: "交接规则", revision, target });
    for (const denied of [
      "notes-outside/draft.md", "notes/../escape.md", "notes/shortcut/draft.md",
      "notes/缺失目录/draft.md", "notes/非法|名.md", "notes/CON.md", "notes/交接整理.txt"
    ]) {
      await assert.rejects(make(denied));
    }

    const job = await make(output);
    const { status, excerpt } = await store.api.maintenanceEvidence(path, "交接规则", revision);
    assert.equal(status, "ok");
    assert.doesNotMatch(excerpt, /排故方案/u);
    await store.maintenance.submit("worker", { task_id: job.id, title: "交接整理", content: "先核对班次并复核。" });
    controls.prepare("UPDATE maintenance_jobs SET created_at=? WHERE id=?").run("2020-01-02T04:05:06.000Z", job.id);
    controls.exec(`CREATE TRIGGER interrupt_publication BEFORE UPDATE OF status ON maintenance_jobs
      WHEN NEW.status='published' BEGIN SELECT RAISE(ABORT, 'test publication interruption'); END;`);

    await assert.rejects(store.api.publishJob(job.id), /test publication interruption/u);
    const pending = controls.prepare("SELECT status,publish_planned_at FROM maintenance_jobs WHERE id=?").get(job.id);
    assert.equal(pending.status, "proposed");
    assert.match(pending.publish_planned_at, /^\d{4}-\d{2}-\d{2}T/u);

    const bytes = await readFile(join(vault, output), "utf8");
    assert.match(bytes, /^created: 2020-01-02$/mu);
    assert.ok(bytes.includes(`updated: ${pending.publish_planned_at.slice(0, 10)}\n`));
    assert.match(bytes, /source\.md#L3-L7/u);

    controls.exec("DROP TRIGGER interrupt_publication");
    const published = await store.api.publishJob(job.id);
    assert.equal(published.status, "published");
    assert.deepEqual(await store.api.publishJob(job.id), published);
    assert.equal(await readFile(join(vault, output), "utf8"), bytes);
    assert.equal(controls.prepare("SELECT published_at FROM maintenance_jobs WHERE id=?").get(job.id).published_at, pending.publish_planned_at);
    assert.equal(await readFile(join(vault, path), "utf8"), source);
  } finally {
    controls.close();
    store.close();
  }
});
