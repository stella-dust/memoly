import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openStore } from "../src/store.js";

const exec = promisify(execFile);
const cliFile = fileURLToPath(new URL("../bin/memoly.js", import.meta.url));

test("CLI-generated connectors isolate credentials, scope Vault evidence and publish only owner-approved drafts", { timeout: 15000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "memoly-cli-"));
  const vault = join(temp, "vault");
  const state = join(temp, "state");
  const cli = async (...args) => JSON.parse((await exec(process.execPath, [cliFile, ...args, "--state", state])).stdout);
  const clients = [];
  let store;

  async function connect(config, name) {
    const { command, args } = Object.values(config.mcpServers)[0];
    const client = new Client({ name, version: "1.0.0" });
    clients.push(client);
    await client.connect(new StdioClientTransport({ command, args, stderr: "pipe" }));
    return client;
  }

  const call = async (client, name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;

  try {
    await mkdir(join(vault, "notes"), { recursive: true });
    const source = join(vault, "guide.md");
    const original = "# Guide\n\n## Visible\nReturn fittings to tray B.\n\n## Other section\nScopeBoundaryMarker\n";
    await writeFile(source, original);
    await writeFile(join(vault, "MEMORY.md"), "# PrivateSample\nDo not serve this file.\n");
    await cli("init", "--vault", vault, "--write-root", "notes");
    await assert.rejects(cli("init", "--vault", vault));
    await cli("connector", "add", "writer", "--scopes", "maintenance,memory:submit");
    await cli("connector", "add", "reader", "--scopes", "knowledge,memory:read");
    const writerConfig = await cli("connector", "config", "writer");
    const readerConfig = await cli("connector", "config", "reader");
    const credential = writerConfig.mcpServers["memoly-writer"].args.at(-1);
    const credentialText = (await readFile(credential, "utf8")).trim();
    assert.match(credentialText, /^[\da-f]{64}$/);
    assert.ok(!JSON.stringify(writerConfig).includes(credentialText));
    if (process.platform !== "win32") {
      assert.equal((await stat(state)).mode & 0o777, 0o700);
      assert.equal((await stat(credential)).mode & 0o777, 0o600);
      await chmod(credential, 0o644);
      await assert.rejects(connect(writerConfig, "untrusted test"));
      await chmod(credential, 0o600);
    }

    const author = await connect(writerConfig, "WorkBuddy test");
    const reader = await connect(readerConfig, "Codex test");
    assert.ok(!(await author.listTools()).tools.some(tool => tool.name === "read_knowledge" || tool.name.includes("approve")));
    assert.ok(!(await reader.listTools()).tools.some(tool => tool.name === "submit_memory" || tool.name.includes("maintenance")));
    assert.equal((await call(reader, "search_knowledge", { query: "fittings" })).status, "no_evidence");
    await cli("share", "reader", "guide.md", "Visible");
    await assert.rejects(cli("share", "reader", "MEMORY.md", "PrivateSample"));
    const search = await call(reader, "search_knowledge", { query: "fittings" });
    assert.equal(search.results[0].citation.start_line, 4);
    assert.equal(search.results[0].citation.document_id, "guide.md");
    assert.equal((await call(reader, "search_knowledge", { query: "ScopeBoundaryMarker" })).status, "no_evidence");
    assert.equal((await call(reader, "read_knowledge", { document_id: "guide.md", heading: "Other section" })).status, "not_found_or_unavailable");

    await assert.rejects(cli("job", "add", "writer", "guide.md", "Visible", "guide.md"));
    await assert.rejects(cli("job", "add", "writer", "guide.md", "Visible", "outside.md"));
    const task = await cli("job", "add", "writer", "guide.md", "Visible", "notes/tray-guide.md");
    assert.deepEqual((await call(author, "list_maintenance_jobs")).jobs, [{ task_id: task.id }]);
    const packet = await call(author, "read_maintenance_job", { task_id: task.id });
    assert.ok(packet.excerpt.includes("tray B") && !packet.excerpt.includes("ScopeBoundaryMarker"));
    const proposal = { task_id: task.id, title: "Return to the tray", content: "Return fittings to **tray B**." };
    assert.equal((await call(author, "submit_maintenance", proposal)).status, "proposed");
    const target = join(vault, "notes", "tray-guide.md");
    await assert.rejects(stat(target), { code: "ENOENT" });
    store = await openStore(state);
    const publish = await store.api.publishJob(task.id);
    assert.equal(publish.status, "published");
    assert.deepEqual(await store.api.publishJob(task.id), publish);
    const rendered = await readFile(target, "utf8");
    assert.match(rendered, /status: inbox/);
    assert.match(rendered, /guide\.md#L3-L4/);
    assert.equal(await readFile(source, "utf8"), original);

    const staleTask = await cli("job", "add", "writer", "guide.md", "Visible", "notes/stale.md");
    await writeFile(source, original.replace("tray B", "tray C"));
    assert.equal((await call(author, "read_maintenance_job", { task_id: staleTask.id })).status, "not_found_or_unavailable");
    assert.equal((await call(author, "submit_maintenance", { ...proposal, task_id: staleTask.id })).status, "not_found_or_unavailable");
    assert.equal((await call(reader, "read_knowledge", { document_id: "guide.md" })).status, "not_found_or_unavailable");
    await cli("connector", "revoke", "reader");
    assert.equal((await call(reader, "search_knowledge", { query: "fittings" })).status, "not_found_or_unavailable");
    await assert.rejects(cli("connector", "add", "reader", "--scopes", "knowledge"));
    assert.ok(store.api.audit().some(event => event.tool === "submit_maintenance" && event.target_id === task.id && event.status === "proposed"));

    // Verify bundled skills command & loopback Web UI maintenance feeds + audit visibility
    const skillInfo = JSON.parse((await exec(process.execPath, [cliFile, "skill", "list"])).stdout);
    assert.deepEqual(skillInfo.skills.map(s => s.name), ["memoly-agent", "memoly-maintain", "memoly-operator"]);

    const { createFeeds } = await import("../src/feeds.js");
    const { serveWeb } = await import("../src/web.js");
    const feeds = createFeeds(store);
    const webToken = "0".repeat(64);
    const { server, origin } = await serveWeb({ port: 0, token: webToken, api: store.api, feeds });
    try {
      await feeds.add("writer", "guide.md", "Visible", "notes");
      const mRes = await fetch(`${origin}/api/state?tab=maintenance`, { headers: { Authorization: `Bearer ${webToken}` } });
      assert.equal(mRes.status, 200);
      const mData = await mRes.json();
      assert.equal(mData.feeds.length, 1);

      const aRes = await fetch(`${origin}/api/state?tab=agents`, { headers: { Authorization: `Bearer ${webToken}` } });
      const aData = await aRes.json();
      assert.ok(aData.audit.some(ev => ev.client_name === "WorkBuddy" && ev.revision));

      const badUnshare = await fetch(`${origin}/api/action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${webToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unshare", client_id: "reader", path: "guide.md", heading: "Typo" })
      });
      assert.equal(badUnshare.status, 404);
    } finally {
      server.close();
      feeds.close();
    }
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    store?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
