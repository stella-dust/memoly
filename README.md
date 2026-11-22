# Memoly Local

Memoly Local 把 Markdown Vault 接到 WorkBuddy、Codex 等桌面 Agent。Agent 能查询指定章节，也能提交资料整理或个人记忆候选。Vault 所有者在本机工作台核对证据、授权和当前版本，再决定发布、更正或撤回。

- **Vault** 支持现有 Obsidian 库或普通目录。工作台浏览文件树和行号，用当前文件版本授权单个 Markdown 章节。
- **整理** 将一段授权资料交给 Agent 拟稿。支持手动运行或通过 [WorkBuddy 本地定时任务](docs/workbuddy.md)获取候选。批准后在指定目录创建新 Markdown。
- **记忆** 一个 Agent 提交，所有者确认，另一个 Agent 读取。每条记录可限定读者和有效期，支持版本更正及撤回。

## 安装

需要 Node.js 22.13 或更新版本及 npm。以下命令适用于 macOS 的 shell。使用用户目录安装无需管理员权限。

```sh
git clone https://github.com/stella-dust/memoly.git
cd memoly
npm ci
npm pack

export MEMOLY_PREFIX="$HOME/.local/memoly"
npm install --global --prefix "$MEMOLY_PREFIX" ./memoly-local-0.3.0.tgz
export PATH="$MEMOLY_PREFIX/bin:$PATH"
memoly --version
memoly doctor
```

重新打开终端时，把相同的 `bin` 路径加入 `PATH`。从源码运行可用 `node bin/memoly.js help`。`npm test` 运行仓库内的本地测试。

## 先用一份合成 Vault

```sh
export MEMOLY_DEMO="$(mktemp -d "${TMPDIR:-/tmp}/memoly-demo.XXXXXX")"
export MEMOLY_STATE="$MEMOLY_DEMO/state"
cp -R examples/vault "$MEMOLY_DEMO/vault"
memoly init --vault "$MEMOLY_DEMO/vault" --write-root notes
memoly status
memoly serve
```

在浏览器打开终端打印的完整本机工作台地址。默认监听 `127.0.0.1:8766`。这个链接带本次运行的所有者凭据，自己保管。刷新后如需重新进入，使用终端中原先的地址；重启服务后用新地址。打开「Vault」并在 `inbox` 中点选 `shift-handoff.md` 查看行号和版本。用另一个终端配置连接时，使用相同的 `MEMOLY_STATE`，或为每条命令加 `--state <目录>`。

使用自己的 Vault 时，为它选择独立的 Vault 外状态目录，运行 `memoly init --vault <目录>`。需要允许写入草稿时加 `--write-root <Vault 内已存在的相对目录>`，例如 `drafts`。读原件、发布记忆和分享章节均不要求配置写入目录。

## 给 WorkBuddy 和 Codex 分配身份

用上述样例初始化后的同一状态执行以下命令。

```sh
memoly connector add workbuddy --scopes knowledge,memory:submit,maintenance
memoly connector add codex --scopes knowledge,memory:read
memoly connector config workbuddy
memoly connector config codex
memoly share workbuddy inbox/shift-handoff.md 'Lockout review'
```

**WorkBuddy。** 按[接入指引](docs/workbuddy.md)在客户端合并 `memoly-workbuddy` 连接器并启用。`knowledge` 能力允许查询，`memoly share` 进一步限定实际可读的文件和章节。问 WorkBuddy「只通过 Memoly 查询合成交接演练的序列号，给出出处和行号」。预期获得合成内容 `MEMOLY-DEMO-314`，以及路径、行号、版本。

**Codex。** 运行 `memoly connector config codex`，复制其中的绝对 `command` 与各个 `args`。按原顺序作为独立参数传给 `codex mcp add`。例如下面的命令中，依次替换 Node、入口脚本、状态目录和凭据文件这四处路径。不要从 WorkBuddy 配置复制第二个客户端的凭据。

```sh
codex mcp add memoly-codex -- '/ABS/PATH/TO/node' '/ABS/PATH/TO/bin/memoly.js' mcp codex \
  --state '/ABS/PATH/TO/state' --credential-file '/ABS/PATH/TO/client-credential'
codex mcp list
```

重新打开 Codex 会话后可以调用新配置。配置 JSON 包含本机凭据文件路径，保持私有。CLI 和 MCP 用同一个状态目录，Web 工作台可按需要启动或停止。WorkBuddy 或 Codex 收到已授权的正文后，其模型和服务按各自的数据规则处理。

## 整理资料

1. 在「资料整理」创建任务，选择 WorkBuddy、`inbox/shift-handoff.md` 的 `Lockout review` 和目标 `notes/handoff-review.md`。也可运行 `memoly job add workbuddy inbox/shift-handoff.md 'Lockout review' notes/handoff-review.md`。任务与来源当前版本绑定。
2. 使用 [WorkBuddy 维护 Prompt](examples/workbuddy-maintenance.prompt.md)运行一次。Agent 用 `list_maintenance_jobs` 找任务，`read_maintenance_job` 取证，`submit_maintenance` 提交拟稿。回执应为 `proposed`，此时 Vault 未写入。
3. 回到工作台刷新，核对拟写内容、来源和目标后点击「批准并写入 Vault」。打开 `notes/handoff-review.md` 检查生成内容。任务工具只向 Agent 提供被分配的授权片段。写回要求原件版本没有变化，目标在获准写入目录，且目标文件仍不存在。

## 让两个 Agent 验证同一条记忆

1. 把[合成验收提示词](examples/cross-agent-memory.prompt.md)的「提交端」发给 WorkBuddy。`submit_memory` 预期返回 `pending` 和候选 ID。用新 key 可重复演练。
2. 在**新的** Codex 会话中使用「读取端」提示词，要求只调用 `read_memory` 查询 `demo-handoff-preference`，并回报当前工具结果。确认发布前应为 `not_found_or_unavailable`。
3. 在「个人记忆」→「待确认」打开候选，选中读者 `codex`，核对文本和范围后点击「本人确认并发布」。在新的 Codex 会话重复查询，工具应给出正文与 `version: 1`。
4. 本机工作台在当前记忆下选「提交更正」，把文本改为 `In the synthetic handoff, list risks before milestones.`，保存更正候选。再选中 `codex` 复核并发布。新会话重查应只得到 `version: 2` 和更新后的正文。「历史」保留被替代的 v1。
5. 在 v2 下打开「撤回共享」并确认。再次用新 Codex 会话查同一个 key，工具应为 `not_found_or_unavailable`。「Agent 接入」可查看调用的本机回执。此流程使用合成偏好；测试时采用新查询结果作为判据。

## 命令和产物

| 入口 | 用法 |
| --- | --- |
| 安装与状态 | `memoly doctor`、`memoly init --vault <目录> [--write-root <相对目录>]`、`memoly status`、`memoly serve [--port <端口>]` |
| 连接权限 | `memoly connector add <id> --scopes <逗号分隔能力>`、`memoly connector config <id>`、`memoly connector revoke <id>` |
| 知识分享 | `memoly share <id> <相对路径> <唯一章节标题>`、`memoly unshare <id> <相对路径>` |
| 整理与记忆 | `memoly job add <id> <原件相对路径> <唯一章节标题> <目标相对路径>`、`memoly job list`。任务复核和记忆版本在本机工作台操作。 |
| MCP | `knowledge` 提供 `search_knowledge`、`read_knowledge`、`explore_knowledge`；`maintenance` 提供 `list_maintenance_jobs`、`read_maintenance_job`、`submit_maintenance`；`memory:submit` 提供 `submit_memory`；`memory:read` 提供 `read_memory`、`search_memory`。 |
| 技能与提示词 | `skills/` 为可复制到宿主的 Agent Skill，`examples/` 中的 Prompt 可直接使用。Skills 和 Prompt 介绍使用方法，访问范围由 Memoly 状态和连接器凭据约束。 |

默认状态目录为 `~/.memoly`，状态使用本机 SQLite。建议为 Vault 单独保存状态目录及备份，维护任务、记忆和连接器通过此目录在不同进程间共享。工作台可预览小型 UTF-8 Markdown、TXT、CSV 及 Obsidian 的 `.base`、`.canvas` 文本。知识共享和整理任务只支持 Markdown 章节。模型/OCR 服务、云端 SaaS 和企业私有管理属于后续设计。

**排错。** 首次启动失败先运行 `memoly doctor`、`memoly status`，核对 Node 版本、状态目录和 Vault 是否仍在。端口占用时用 `memoly serve --port 8767`。Agent 无证据时核对客户端权限和当前章节授权。文件更新会使旧版授权失效，核对后再授权新版本。停止 Web 用 `Ctrl+C`，停用具体助手用 `memoly connector revoke <id>`。可用 `npm uninstall --global --prefix "$MEMOLY_PREFIX" memoly-local` 卸载 CLI。原始 Vault 和状态目录继续保留以备迁移或人工清理。

## 许可证

[Apache License 2.0](LICENSE)。
