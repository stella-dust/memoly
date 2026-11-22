#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { initStore, openStore } from "../src/store.js";

const help = `Memoly Local 0.3.0
  memoly init --vault <目录> [--write-root <Vault 内已存在的输出目录>]
  memoly serve [--port 8766]
  memoly status
  memoly connector add <id> --scopes knowledge,memory:read,memory:submit,maintenance
  memoly connector config <id>
  memoly connector revoke <id>
  memoly share <id> <相对 Markdown 路径> <章节标题>
  memoly unshare <id> <相对 Markdown 路径>
  memoly job add <id> <原件相对路径> <章节标题> <新建 Markdown 的相对路径>
  memoly job list
  memoly doctor

所有命令可加 --state <私有数据目录>。默认 ~/.memoly，须位于 Vault 外。
资料批准、记忆确认与撤回在本机工作台完成。
`;

const output = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
const entryPoint = fileURLToPath(import.meta.url);

function requireArgs(command, args, count) {
  if (args.length !== count || args.some(arg => !arg)) throw new Error(command + " 的参数数量有误。运行 memoly help 查看用法。");
}

async function run() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      state: { type: "string" }, vault: { type: "string" }, "write-root": { type: "string" },
      port: { type: "string", default: "8766" }, scopes: { type: "string" },
      "credential-file": { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" }
    }
  });
  const [command = "help", ...args] = positionals;
  const state = resolve(values.state || process.env.MEMOLY_STATE || join(homedir(), ".memoly"));

  if (values.version) return process.stdout.write("0.3.0\n");
  if (command === "help" || values.help) return process.stdout.write(help);
  if (command === "doctor") return output({
    node: process.version, state, web: "127.0.0.1", transport: "stdio",
    readable: [".md", ".txt", ".csv", ".canvas", ".base"], maintenance: [".md"]
  });
  if (command === "init") {
    requireArgs(command, args, 0);
    if (!values.vault) throw new Error("init 需要 --vault <目录>");
    return output(await initStore(state, values.vault, values["write-root"]));
  }

  const store = await openStore(state);
  let running = false;
  try {
    if (command === "serve") {
      requireArgs(command, args, 0);
      if (!/^\d+$/.test(values.port) || +values.port < 1024 || +values.port > 65535) throw new Error("端口应在 1024 到 65535 之间");
      const { serveWeb } = await import("../src/web.js");
      const { server, url } = await serveWeb({ port: +values.port, token: randomBytes(32).toString("hex"), api: store.api });
      running = true;
      server.once("close", store.close);
      const stop = () => server.close();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      process.stdout.write("Memoly 本机工作台（授权链接仅供本人）\n" + url + "\n");
      return;
    }

    if (command === "mcp") {
      requireArgs(command, args, 1);
      const [clientId] = args;
      const getClient = store.bindClient(clientId, values["credential-file"]);
      const { serveMcp } = await import("../src/mcp.js");
      await serveMcp({
        clientId, getClient, projection: store.projection(clientId),
        memory: store.memory, maintenance: store.maintenance, audit: store.audit
      });
      running = true;
      process.stdin.once("end", store.close);
      return;
    }

    if (command === "status") {
      requireArgs(command, args, 0);
      return output({ ...store.api.status(), clients: store.api.clients(), jobs: store.api.jobs().length });
    }

    if (command === "connector") {
      requireArgs(command, args, 2);
      const [verb, id] = args;
      if (verb === "add") return output(store.register(id, values.scopes?.split(",").map(scope => scope.trim())));
      if (verb === "revoke") return output(store.revokeClient(id));
      if (verb === "config") {
        const credential = store.getCredentialFile(id);
        return output({ mcpServers: { ["memoly-" + id]: {
          type: "stdio", command: process.execPath, args: [entryPoint, "mcp", id, "--state", store.state, "--credential-file", credential]
        } } });
      }
    }

    if (command === "share") {
      requireArgs(command, args, 3);
      const [id, path, heading] = args;
      const { revision } = await store.api.note(path);
      return output(await store.api.share({ client_id: id, path, heading, revision }));
    }
    if (command === "unshare") {
      requireArgs(command, args, 2);
      return output(store.api.unshare({ client_id: args[0], path: args[1] }));
    }

    if (command === "job" && args[0] === "list") {
      requireArgs(command, args, 1);
      return output(store.api.jobs().map(({ id, client_id, source, target, status, output_revision }) => ({ id, client_id, source, target, status, output_revision })));
    }
    if (command === "job" && args[0] === "add") {
      requireArgs(command, args, 5);
      const [, id, source, heading, target] = args;
      const { revision } = await store.api.note(source);
      return output(await store.api.createJob({ client_id: id, source, heading, revision, target }));
    }
    throw new Error("未知命令，运行 memoly help 查看用法");
  } finally {
    if (!running) store.close();
  }
}

run().catch(error => {
  process.stderr.write("Memoly · " + (error.code === "EADDRINUSE" ? "所选端口已被占用" : error.message) + "\n");
  process.exitCode = 1;
});
