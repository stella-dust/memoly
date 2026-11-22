# WorkBuddy 接入和定时整理

在本机 WorkBuddy 中使用 Memoly 的 stdio 连接器。用一个身份完成样例时，可授予查询、维护和候选提交。长期运行时可另设只带 `maintenance` 能力的定时整理身份，定时任务只看到分配给它的任务。

## 接入本机服务

先完成 [README 的安装与 Vault 初始化](../README.md#先用一份合成-vault)。在使用该 Vault 状态目录的终端，创建连接器并生成配置。

```sh
memoly connector add workbuddy --scopes knowledge,memory:submit,maintenance
memoly connector config workbuddy
```

如果 README 步骤已经创建 `workbuddy`，直接使用 `config`。打开 WorkBuddy 的「专家·技能·连接器 → 连接器 → 自定义连接器 → 添加 MCP」。将 `mcpServers` 下名为 `memoly-workbuddy` 的条目合并到现有配置，保留其他连接器。保存后回列表启用并按宿主提示信任这个连接器。新会话选择该连接器并确认能看到预期工具。配置包含绝对路径，移动 Memoly、Node 或状态目录后重新生成。 [WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)

`memoly connector add` 只分配能力。查询特定原件前还需要通过工作台或 `memoly share` 授权当前章节。维护通过单独任务授权。`memory:submit` 只能送候选；要复用可信记忆，需由所有者批准并选定有 `memory:read` 的客户端。

## 用合成 Vault 立即运行一次

在 Memoly Web UI「资料整理」创建任务，或执行以下命令。

```sh
memoly job add workbuddy inbox/shift-handoff.md 'Lockout review' notes/handoff-review.md
memoly job list
```

选择 Memoly 连接器，把[维护 Prompt](../examples/workbuddy-maintenance.prompt.md)粘贴到新的 WorkBuddy 会话。核对 MCP 调用依次列出任务、读取指定证据、返回 `proposed`。回到 Web UI 核对来源、目标相对路径和拟写文本，再点击「批准并写入 Vault」。确认 `notes/handoff-review.md` 已创建，原件没有变化。再次执行会处理下一份待办，队列为空时返回 `no_work`。

## 配置周期性整理

1. 建议为周期性任务新建独立连接器 `memoly connector add workbuddy-maintenance --scopes maintenance`。用 `memoly connector config workbuddy-maintenance` 获取配置并安装。只向该身份分配想定期处理的任务。
2. 在 WorkBuddy 左侧打开「定时任务」，手动新建**本地**任务。选一个单独的空工作空间和默认权限，添加上一步的 Memoly 连接器。使用[维护 Prompt](../examples/workbuddy-maintenance.prompt.md)。任务经 MCP 读取获准片段，工作空间无需指向 Vault；资料读取和候选提交由 Memoly 限定。保留结果在本机。
3. 选择合适执行时间和频率。保存后，先通过任务卡「立即运行」用合成资料走查，再查看「运行记录」。看到 `proposed` 后到 Memoly 审核。看到 `no_work` 时可结束本轮。定时任务只负责提交候选，最终写入由 Vault 所有者在本机工作台进行。
4. 真正设置固定频率后，用下一次运行记录核对计划触发。任务执行依赖本机在线和 WorkBuddy 正在运行；需宿主确认时会停在等待状态。可以暂停日程，或在 Memoly 撤销该连接器。 [WorkBuddy 定时任务文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)

## 常见结果

| 现象 | 如何检查 |
| --- | --- |
| 没有 Memoly 工具 | 确认 WorkBuddy 导入的是对应身份，连接器已启用。核对 Node、入口脚本和状态目录绝对路径，打开新会话。 |
| `no_work` | 当前身份没有待整理任务。用 `memoly job list` 检查任务就绪以及是否分配给该身份。 |
| `not_found_or_unavailable` | 检查任务或共享章节是否被撤回、原件是否已变更、身份是否对应该状态目录。约束变化后重新审核已获准的任务。 |
| `proposed`，文件未新增 | 进「资料整理」复核提案。原件当前版本与目标仍有效时，经本人批准写回。 |
| WorkBuddy 报成功，Memoly 没有回执 | 用「运行记录」核对真实 MCP 调用和工具返回。Agent 对话文本本身不证明工具调用或本机写入。 |
