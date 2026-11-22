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

test("feeds handle stale rejections, invalid UTF-8 isolation, stale manual jobs and directory validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "memoly-feeds-regressions-"));
  const vault = join(root, "vault");
  const state = join(root, "state");
  const primary = join(vault, "guide.md");
  const bad = join(vault, "bad.md");
  const manual = join(vault, "manual.md");
  const md = (approved, priv) => `# Guide\n\n## Approved\n${approved}\n\n## Private\n${priv}\n`;
  await mkdir(join(vault, "notes", "周会（整理）"), { recursive: true });
  await mkdir(join(vault, "notes", "_archive"), { recursive: true });
  await writeFile(primary, md("V1 approved line", "P1"));
  await writeFile(bad, md("Bad initial", "P"));
  await writeFile(manual, md("Manual initial", "P"));

  let store, feeds;
  try {
    await initStore(state, vault, "notes");
    store = await openStore(state);
    feeds = createFeeds(store);
    store.register("worker", ["maintenance"]);

    // P1-5: Chinese brackets in existing subdir allowed; _archive & missing dir rejected cleanly without leaking root path.
    await assert.rejects(feeds.add("worker", "guide.md", "Approved", "notes/_archive"));
    try {
      await feeds.add("worker", "guide.md", "Approved", "notes/missing");
      assert.fail("Expected missing output dir rejection");
    } catch (error) {
      assert.equal(error.message.includes(vault), false);
    }
    const { id: okFeedId } = await feeds.add("worker", "guide.md", "Approved", "notes/周会（整理）");

    // P0-1a: pending feed job superseded on unrelated edit; rejecting stale proposed job still allows re-queue.
    const firstList = await feeds.listForClient("worker");
    const firstId = firstList.jobs[0].task_id;
    await store.maintenance.submit("worker", { task_id: firstId, title: "Draft 1", content: "V1 draft" });
    await writeFile(primary, md("V1 approved line", "P2"));
    await store.api.rejectJob(firstId);
    const afterStaleReject = await feeds.scan(okFeedId);
    assert.equal(afterStaleReject.status, "queued");
    assert.notEqual(afterStaleReject.task_id, firstId);

    // Confirm older pending job gets marked superseded when another unrelated edit occurs before submit.
    await writeFile(primary, md("V1 approved line", "P3"));
    const thirdScan = await feeds.scan(okFeedId);
    assert.equal(thirdScan.status, "queued");
    assert.equal(store.api.jobs().find(j => j.id === afterStaleReject.task_id).status, "superseded");

    // P0-1b: rejecting a fresh (non-stale) proposed draft suppresses re-queueing same excerpt.
    await store.maintenance.submit("worker", { task_id: thirdScan.task_id, title: "Draft 3", content: "Reject me" });
    await store.api.rejectJob(thirdScan.task_id);
    assert.deepEqual(await feeds.scan(okFeedId), { status: "unchanged" });

    // P1-2: 10 stale manual pending jobs must not starve a healthy feed job.
    for (let i = 1; i <= 10; i++) {
      const mRev = (await store.api.note("manual.md")).revision;
      await store.api.createJob({ client_id: "worker", source: "manual.md", heading: "Approved", revision: mRev, target: `notes/m-${i}.md` });
    }
    await writeFile(manual, md("Manual mutated", "P"));
    await writeFile(primary, md("V2 approved line", "P3"));

    // P1-1: Invalid UTF-8 in another feed must not crash listForClient for healthy feeds.
    const { id: badFeedId } = await feeds.add("worker", "bad.md", "Approved", "notes");
    assert.ok(badFeedId);
    await writeFile(bad, Buffer.from([0xff, 0xfe, 0xfd]));

    const listed = await feeds.listForClient("worker");
    assert.equal(listed.status, "ok");
    assert.equal(listed.jobs.length, 1);
    const pkt = await store.maintenance.read("worker", listed.jobs[0].task_id);
    assert.match(pkt.excerpt, /V2 approved line/);

    // P2-2: Audit attribution uses connector ID and feed_queue_job tool name.
    assert.ok(store.api.audit().some(ev => ev.client === "worker" && ev.tool === "feed_queue_job"));
  } finally {
    feeds?.close();
    store?.close();
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
