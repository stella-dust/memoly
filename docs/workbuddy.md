# WorkBuddy 接入和定时整理

WorkBuddy 在本机启动 Memoly 的 stdio 连接器。日常问答和定时整理可以使用两个连接器身份。定时身份只领取分配给它的整理任务，所有者在 Memoly 核对证据后决定是否写回。

## 连接 WorkBuddy

先完成 [样例 Vault 初始化](../README.md#1-用合成-vault-启动工作台)。用与工作台一致的状态目录运行 `memoly connector config workbuddy`。如果尚未创建查询身份，先运行 [首次查询](../README.md#2-给-workbuddy-的第一条查询授权)里的三个命令。

打开 WorkBuddy「专家·技能·连接器 → 连接器 → 自定义连接器 → 添加 MCP」。将生成 JSON 中的 `mcpServers` 条目合并到现有配置。保存后回连接器列表启用并按宿主提示信任，在新会话中选择它。配置保存绝对路径。移动 Node、Memoly 或状态目录后，重新生成并更新对应条目。 [WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)

`knowledge` 允许调用查询工具。具体文档要另外授权到章节。`maintenance` 允许领任务、读取授权来源与提交草稿。`memory:submit` 允许送记忆候选，所有者可将生效版本授予有 `memory:read` 的其他客户端。

如需给 WorkBuddy 注入稳定的工具规范，可运行 `memoly skill path` 找到内置的 [memoly-agent](../skills/memoly-agent/SKILL.md) 与 [memoly-maintain](../skills/memoly-maintain/SKILL.md) 技能说明。

## 先完成一次真实 MCP 往返

给样例 Vault 新建一个维护专用身份，并将生成的配置安装到 WorkBuddy。由相同的状态目录执行。

```sh
memoly connector add workbuddy-maintenance --scopes maintenance
memoly connector config workbuddy-maintenance
memoly job add workbuddy-maintenance inbox/shift-handoff.md 'Lockout review' notes/handoff-review.md
memoly job list
```

选中维护连接器，把[维护 Prompt](../examples/workbuddy-maintenance.prompt.md)发到新会话。查看运行过程，核对 `list_maintenance_jobs` 列出任务、`read_maintenance_job` 返回引用、`submit_maintenance` 返回 `proposed`。打开 Memoly「资料整理」，核对原文、目标和拟写内容，再点击「批准并写入 Vault」。读回 `notes/handoff-review.md` 并核对原件。

## 配置增量来源与本机日程

`memoly feed` 适用于 `0.3.1` 候选。稳定版 `0.3.0` 的 WorkBuddy 日程仍可领取手工创建的任务。增量来源绑定维护身份、一篇 Markdown 的唯一章节和一个输出目录。该目录须已存在，且等于初始化时设定的 `--write-root` 或在其内部。

```sh
memoly feed add workbuddy-maintenance inbox/shift-handoff.md 'Lockout review' notes
memoly feed list
```

`feed list` 显示来源 ID。接入时可用 `memoly feed scan <id>` 主动扫描。`queued` 表示有任务待领取，`unchanged` 表示没有新增任务。之后由 WorkBuddy 每轮调用 `list_maintenance_jobs` 检查章节。重复扫描会复用同一原件版本的任务，已审批或有效退回的相同片段也不重新排队。如果在待审批期间原件变更导致旧卡失效，在工作台「退回任务」清理旧卡后，下一次扫描会自动为最新原件重新排队，不会漏掉变更章节。批准后写入授权目录内的新 Markdown（包含带中文名和既有子目录）。若已有主条目，由所有者按自己的 Vault 规则复核合并。先用上述样例验证，再配置真实来源。

1. 在 WorkBuddy 打开「定时任务」，手动新建**本地**任务，选独立工作空间与维护连接器。复制[维护 Prompt](../examples/workbuddy-maintenance.prompt.md)。工作空间可为独立空目录，实际来源由 Memoly 的任务绑定。
2. 选时间和频率。保存后先用任务卡「立即运行」核对工具调用，再观察下一次计划触发的实际记录。按需要选择 WorkBuddy 的任务权限，定时整理只需调用这三个维护工具。宿主要求交互确认时可在运行记录找到等待原因。
3. 每次运行后在工作台核对待审候选。关闭 Web 工作台不影响 stdio 连接器启动。计划执行需要运行设备可用，且 WorkBuddy 可以在本机执行。
4. 暂停日程可在 WorkBuddy 任务卡操作。`memoly feed disable <id>` 停止新增该来源的任务，已分配的任务仍可在工作台处理。需要收回整个身份时执行 `memoly connector revoke workbuddy-maintenance`。 [WorkBuddy 定时任务文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)

若版本的手动创建弹窗受阻，可从 WorkBuddy 的新会话请求创建任务，明确「本地」、绝对执行时间、频率和通知目的地。回到任务列表核对实际保存的配置和下一次执行时间。计划卡片、运行记录和 Memoly 回执分别验证。

## 排错

| 现象 | 检查 |
| --- | --- |
| 没有 Memoly 工具 | 核对连接器已启用、绝对路径有效，当前会话选中正确身份。 |
| `no_work` | 该身份没有当前可领任务。查 `memoly feed list` 和 `memoly job list`，确认来源章节存在，以及当前版本是否已处理。 |
| `not_found_or_unavailable` | 检查任务分配与当前版本。来源如已变化，按原件重新检查新候选。 |
| `proposed`，文件尚未写回 | 从「资料整理」打开候选，校对原文和目标路径并执行审批。 |
| WorkBuddy 显示完成，Memoly 没有回执 | 打开该次「运行记录」，见到 MCP 工具调用和返回，再检查是否用了同一状态目录。 |
| 任务到点未运行 | 查实际运行记录、设备在线状态与宿主确认。可用「立即运行」单独验证连接器。 |
