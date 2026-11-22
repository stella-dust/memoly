import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFeeds } from "../src/feeds.js";
import { initStore, openStore } from "../src/store.js";

test("a feed queues only its own current section and ignores reviewed content after unrelated edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "memoly-feeds-"));
  const vault = join(root, "vault");
  const state = join(root, "state");
  const note = join(vault, "fixture-guide.md");
  const markdown = (allowed, excluded) => `# Guide\n\n## Approved\n${allowed}\n\n## Private\n${excluded}\n`;
  await mkdir(join(vault, "notes", "weekly"), { recursive: true });
  await writeFile(note, markdown("Review the fixture.", "Unshared"));
  let store, feeds, concurrent;
  try {
    await initStore(state, vault, "notes");
    store = await openStore(state);
    feeds = createFeeds(store);
    concurrent = createFeeds(store);
    store.register("maintenance-agent", ["maintenance"]);
    store.register("another-agent", ["maintenance"]);
    await assert.rejects(feeds.add("maintenance-agent", "fixture-guide.md", "Approved", "elsewhere"));
    const { id } = await feeds.add("maintenance-agent", "fixture-guide.md", "Approved", "notes/weekly");
    const competing = await Promise.all([feeds.scan(id), concurrent.scan(id)]);
    assert.ok(competing.some(result => result.status === "queued"));
    assert.equal(store.api.jobs().length, 1);
    assert.deepEqual(await feeds.listForClient("another-agent"), { status: "no_work", jobs: [] });
    const first = (await feeds.listForClient("maintenance-agent")).jobs[0].task_id;
    assert.equal((await store.maintenance.read("maintenance-agent", first)).excerpt.includes("Unshared"), false);

    await writeFile(note, markdown("Review the fixture.", "Unshared now revised"));
    const renewed = (await feeds.listForClient("maintenance-agent")).jobs;
    assert.equal(renewed.length, 1);
    const second = renewed[0].task_id;
    assert.notEqual(second, first);
    assert.equal((await store.maintenance.read("maintenance-agent", first)).status, "not_found_or_unavailable");
    assert.equal((await store.maintenance.submit("maintenance-agent", {
      task_id: second, title: "Reviewed proposal", content: "Review the fixture."
    })).status, "proposed");
    assert.equal((await store.api.publishJob(second)).status, "published");
    await writeFile(note, markdown("Review the fixture.", "Other non-shared information"));
    assert.deepEqual(await feeds.scan(id), { status: "unchanged" });
    assert.deepEqual(await feeds.listForClient("maintenance-agent"), { status: "no_work", jobs: [] });

    await writeFile(note, markdown("Review the fixture after 9:00.", "Nothing to disclose"));
    const { status, jobs } = await feeds.listForClient("maintenance-agent");
    assert.equal(status, "ok");
    assert.equal(jobs.length, 1);
    assert.match((await store.maintenance.read("maintenance-agent", jobs[0].task_id)).excerpt, /after 9:00/);
    assert.equal(feeds.disable(id).status, "disabled");
    await writeFile(note, markdown("The new latest source.", "Unshared"));
    assert.deepEqual(await feeds.listForClient("maintenance-agent"), { status: "no_work", jobs: [] });
    assert.equal((await feeds.scan(id)).status, "unavailable");
  } finally {
    concurrent?.close();
    feeds?.close();
    store?.close();
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
