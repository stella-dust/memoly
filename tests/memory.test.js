import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMemory } from "../src/memory.js";

test("a candidate carries no read authority; corrections detect stale bases and withdrawal is final", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const memory = createMemory(db);
    const key = "sample-weekly-outline";
    const first = memory.submit("writer", { key, statement: "Put decisions first." });
    assert.deepEqual(memory.submit("writer", { key, statement: "Put decisions first." }), first);
    assert.deepEqual(memory.read("reader", key), { status: "not_found_or_unavailable" });
    assert.equal(memory.approve(first.candidate_id, { readers: ["reader"] }).version, 1);
    assert.equal(memory.read("reader", key).memory.statement, "Put decisions first.");
    assert.equal(memory.read("other", key).status, "not_found_or_unavailable");
    const edit = memory.submit("owner", { key, statement: "Put decisions and risks first.", expected_version: 1 });
    const stale = memory.submit("owner", { key, statement: "Obsolete editor.", expected_version: 1 });
    assert.equal(memory.read("reader", key).memory.version, 1);
    assert.equal(memory.approve(edit.candidate_id, { readers: ["reader"] }).version, 2);
    assert.throws(() => memory.approve(stale.candidate_id, { readers: ["reader"] }), { code: "memory_version_conflict" });
    assert.equal(memory.search("reader", { query: "risks" }).results[0].version, 2);
    assert.equal(memory.revoke(key).status, "revoked");
    assert.equal(memory.read("reader", key).status, "not_found_or_unavailable");
    assert.equal(memory.search("reader", { query: "risks" }).status, "no_evidence");
    const attempt = memory.submit("writer", { key, statement: "Old transfer.", expected_version: 2 });
    assert.throws(() => memory.approve(attempt.candidate_id, { readers: ["reader"] }), { code: "memory_version_conflict" });
    assert.equal(memory.list().find(row => row.candidate_id === stale.candidate_id).status, "rejected");
  } finally {
    db.close();
  }
});

test("stdio peers use separate permissions against the same SQLite memory across calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memoly-memory-"));
  const db = new DatabaseSync(join(dir, "memoly.sqlite"));
  const owner = createMemory(db);
  const clientFile = join(dir, "clients.json");
  const clients = {
    writer: { id: "writer", scopes: ["memory:submit"] },
    reader: { id: "reader", scopes: ["memory:read"] }
  };
  const writer = new Client({ name: "WorkBuddy test", version: "1.0.0" });
  const reader = new Client({ name: "Codex test", version: "1.0.0" });
  const project = fileURLToPath(new URL("../", import.meta.url));
  const subprocess = `
    import { DatabaseSync } from "node:sqlite";
    import { readFileSync, appendFileSync } from "node:fs";
    import { join } from "node:path";
    import { createMemory } from "./src/memory.js";
    import { serveMcp } from "./src/mcp.js";
    const [dir, clientId] = process.argv.slice(1);
    const db = new DatabaseSync(join(dir, "memoly.sqlite"));
    const getClient = () => JSON.parse(readFileSync(join(dir, "clients.json")))[clientId];
    const audit = event => appendFileSync(join(dir, "audit.log"), JSON.stringify(event) + "\\n");
    await serveMcp({ clientId, getClient, memory: createMemory(db), audit });
  `;
  const transport = id => new StdioClientTransport({
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", "--input-type=module", "--eval", subprocess, dir, id],
    cwd: project,
    stderr: "pipe"
  });

  try {
    await writeFile(clientFile, JSON.stringify(clients));
    await writer.connect(transport("writer"));
    await reader.connect(transport("reader"));
    assert.deepEqual((await writer.listTools()).tools.map(tool => tool.name), ["submit_memory"]);
    assert.deepEqual((await reader.listTools()).tools.map(tool => tool.name), ["read_memory", "search_memory"]);
    const key = "cross-peer-sample";
    const sample = "A fictional sentence for SDK testing.";
    const submit = await writer.callTool({ name: "submit_memory", arguments: { key, statement: sample } });
    assert.equal(submit.structuredContent.status, "pending");
    const read = () => reader.callTool({ name: "read_memory", arguments: { key } });
    assert.equal((await read()).structuredContent.status, "not_found_or_unavailable");
    owner.approve(submit.structuredContent.candidate_id, { readers: ["reader"] });
    assert.equal((await read()).structuredContent.memory.statement, sample);
    const correction = owner.submit("owner", { key, statement: "Fictional revised text.", expected_version: 1 });
    owner.approve(correction.candidate_id, { readers: ["reader"] });
    assert.equal((await read()).structuredContent.memory.version, 2);
    await writeFile(clientFile, JSON.stringify({ writer: clients.writer }));
    assert.equal((await read()).structuredContent.status, "not_found_or_unavailable");
    const log = await readFile(join(dir, "audit.log"), "utf8");
    assert.ok(!log.includes(sample) && !log.includes(key));
    const events = log.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.status), ["pending", "not_found_or_unavailable", "ok", "ok", "not_found_or_unavailable"]);
    assert.equal(events.at(2).clientName, "Codex");
    assert.equal(events.at(3).revision, 2);
  } finally {
    await Promise.allSettled([writer.close(), reader.close()]);
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
