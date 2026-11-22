# Memoly Local

让桌面 Agent 读到你指定的 Vault 资料，出处精确到文件、行号和版本。Memoly 也能把 WorkBuddy 的整理结果留在本机工作台等你复核，以及让获准的 Agent 复用你已经确认的记忆。

[本机版介绍页](site/index.html) · [下载与校验摘要](https://github.com/stella-dust/memoly/releases) · [WorkBuddy 使用手册](docs/workbuddy.md) · [参与贡献](CONTRIBUTING.md) · [Apache-2.0](LICENSE)

适合个人知识库，也适合由一位管理员操作共享 Vault 的小团队。本机工作台有一个所有者，连接器按用途分配能力。团队协作使用已有的文件同步和文件权限。只同步 Vault 文件，将连接器凭据和 SQLite 留在各自设备的私有状态目录。Memoly 目前没有成员账号、目录级角色或多租户隔离。

如需看介绍页，在下载或克隆仓库后用浏览器打开 `site/index.html`。

## 安装

需要 **Node.js 22.13+** 和 npm。命令使用 macOS/Linux shell。稳定版为 `v0.3.0`，在 [GitHub Releases](https://github.com/stella-dust/memoly/releases) 下载 `memoly-local-0.3.0.tgz` 与 `memoly-local-0.3.0.tgz.sha256`，放在同一目录。使用后续发布版本时，修改示例文件名以匹配下载版本。

```sh
MEMOLY_ARCHIVE="$PWD/memoly-local-0.3.0.tgz"
shasum -a 256 -c "${MEMOLY_ARCHIVE##*/}.sha256" &&
  npm install --global --prefix "$HOME/.local/memoly" --ignore-scripts "$MEMOLY_ARCHIVE"
export PATH="$HOME/.local/memoly/bin:$PATH"
memoly --version
```

重新打开终端后，把 `$HOME/.local/memoly/bin` 加回 `PATH`，或直接运行 `"$HOME/.local/memoly/bin/memoly"`。校验失败时先重新下载同一 Release 的两项文件。首次安装 npm 依赖需要网络。

## 五分钟试用

### 1. 用合成 Vault 启动工作台

沿用安装时的绝对路径变量 `MEMOLY_ARCHIVE`。这几步会把安装包附带的样例解到独立目录。

```sh
MEMOLY_DEMO="$(mktemp -d "${TMPDIR:-/tmp}/memoly-demo.XXXXXX")"
tar -xzf "$MEMOLY_ARCHIVE" -C "$MEMOLY_DEMO" package/examples/vault
export MEMOLY_STATE="$MEMOLY_DEMO/state"
memoly init --vault "$MEMOLY_DEMO/package/examples/vault" --write-root notes
memoly serve
```

打开终端显示的工作台地址。默认使用 `127.0.0.1:8766`，完整地址包含本次启动的所有者凭据，请仅在本机使用。打开「知识 Vault」，点选 `inbox/shift-handoff.md`，核对 `Lockout review` 章节及原文行号。终端保持运行。如需另开终端运行后面的命令，复制本终端的 `MEMOLY_STATE` 设置。

### 2. 给 WorkBuddy 的第一条查询授权

```sh
memoly connector add workbuddy --scopes knowledge
memoly share workbuddy inbox/shift-handoff.md 'Lockout review'
memoly connector config workbuddy
```

按 [WorkBuddy 使用手册](docs/workbuddy.md#连接-workbuddy)合并最后一条命令生成的配置。开启一个新的本机会话，选择该连接器，然后问

> 只使用 Memoly 连接器。先用 `search_knowledge` 查询 `MEMOLY-DEMO-314`，再按返回的 `document_id`、章节和 `revision` 调用 `read_knowledge`。给出合成演练的序列号、文件和行号。

预期得到 `MEMOLY-DEMO-314`，并能在 `inbox/shift-handoff.md` 的第 7 行核对。任选一个样例里没有的编号重试，预期返回 `no_evidence`。工作台的「Agent 接入」提供工具调用记录。

### 3. 换成自己的 Vault

先停止演示 Web 服务，再为自己的 Vault 初始化一个独立的状态目录。

```sh
unset MEMOLY_STATE
memoly init --vault "/path/to/my-vault" --state "$HOME/.memoly/my-vault"
memoly serve --state "$HOME/.memoly/my-vault"
```

Vault 可以是 Obsidian 库或普通目录。需要整理写回时，先在 Vault 内建好一个输出目录，例如 `drafts`，再在首次初始化时加上 `--write-root drafts`。所有共享和维护从逐个章节配置开始。首次试用真实资料时，可以先用一份已知内容验证权限和引用。

## 日常工作流

| 目的 | 使用方式 |
| --- | --- |
| 证据问答 | 用 `memoly share <连接器> <Markdown 相对路径> <章节标题>` 授权当前版本。Agent 调用 `search_knowledge` 和 `read_knowledge`，返回原文坐标。原件变更后需复核并重新授权。 |
| 整理一件资料 | 在「资料整理」创建一次性任务，或用 `memoly job add` 指定来源章节与目标。用 [维护 Prompt](examples/workbuddy-maintenance.prompt.md)调用 MCP 提交候选，在本机工作台复核后写回。 |
| 定时整理 | 稳定版可定时领取手工创建的任务。`0.3.1` 候选在此基础上支持增量来源，章节内容变化后生成任务。新草稿由所有者在工作台批准。 [配置步骤](docs/workbuddy.md#配置增量来源与本机日程) |
| 跨 Agent 记忆 | 提交者用 `submit_memory` 送候选，所有者批准后指定能读取的 Agent。用新会话实际验证发布、更正和撤回。 [合成验收示例](examples/cross-agent-memory.prompt.md) |

### 接入 Codex

为 Codex 单独创建身份。按需分配 `knowledge`、`memory:read` 等能力，再输出配置。

```sh
memoly connector add codex --scopes knowledge,memory:read
memoly connector config codex
```

将生成的绝对 `command` 和所有 `args` 按原顺序作为独立参数传给 `codex mcp add`。下例中的四处绝对路径需要替换。

```sh
codex mcp add memoly-codex -- '/ABS/PATH/TO/node' '/ABS/PATH/TO/bin/memoly.js' mcp codex \
  --state '/ABS/PATH/TO/state' --credential-file '/ABS/PATH/TO/client-credential'
codex mcp list
```

在新的 Codex 会话中验证。若需让 Codex 查询资料，还要给 `codex` 身份授权相应章节。 [Codex MCP CLI](https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs)

## 数据与运行边界

- Memoly 读取本机 Vault，用 SQLite 保存连接器、整理待审与记忆状态。Web 绑定回环地址，Agent 通过 stdio 接入。WorkBuddy、Codex 等宿主及其模型供应商可能处理经工具返回的正文，分享前核对所选宿主的数据处理方式。
- 工作台预览 UTF-8 Markdown、TXT、CSV、`.base` 和 `.canvas` 文本。检索和整理围绕 Markdown 章节。整理批准后创建新草稿，已有文件的合并、冲突和内容判断由所有者处理。
- 权限以连接器分配为准。撤销授权影响后续读取，宿主已经收到的副本由宿主管理。敏感问题通过[安全报告方式](SECURITY.md)处理。

## 排错和升级

| 现象 | 处理 |
| --- | --- |
| 启动失败 | 运行 `memoly doctor` 和 `memoly status` 核对 Node、Vault 和状态路径。端口占用可用 `memoly serve --port 8767`。 |
| MCP 工具未出现 | 比对配置里的 Node、入口脚本、状态和凭据路径，确认客户端已启用连接器，再开新会话。 |
| 查不到已知原文 | 核对正在使用的连接器、已授权章节以及原件版本。多章节授权时，用检索回执明确指定要读的标题。 |
| 定时任务未执行 | 查看 WorkBuddy 的实际运行记录。检查电脑是否在线、客户端是否已启动以及任务是否等待宿主确认。 [定时整理排错](docs/workbuddy.md#排错) |

备份时，先停止 WorkBuddy 定时任务、MCP 会话和 Web 服务，再复制 Vault 和完整状态目录。升级替换安装包后，重开宿主会话，通过 `memoly status` 确认原状态。停用一个连接器可运行 `memoly connector revoke <id>`。卸载 CLI 用 `npm uninstall --global --prefix "$HOME/.local/memoly" memoly-local`。Vault 和状态目录保留。

## 从源码开发

```sh
git clone https://github.com/stella-dust/memoly.git
cd memoly
npm ci --ignore-scripts
npm test
node bin/memoly.js --help
```

在 `0.3.1` 候选 checkout 中可用 `node bin/memoly.js feed --help` 查看增量来源命令。若需要安装该 checkout，用 `npm pack --ignore-scripts` 打包，然后运行 `npm install --global --prefix "$HOME/.local/memoly" --ignore-scripts ./memoly-local-0.3.1.tgz`。公开问题和 PR 请使用合成数据。 [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [许可证](LICENSE)
