# 跨 Agent 记忆验收提示词

使用两条独立的本机连接器。下面的陈述是独立的合成测试样例。

**提交端**

> Use the Memoly submit_memory tool with key `demo-handoff-preference`, kind `preference` and statement `In the synthetic handoff, list milestones before action items.` Report the tool status and candidate ID. Leave owner approval to the local web UI.

**读取端**

> Use only the Memoly read_memory tool to read key `demo-handoff-preference`. Return the tool status, active version and exact returned statement if available. If unavailable, report that and stop.

在本机 Web UI 确认候选前，用读取端试查一次。确认并选定读取端后试查 v1。再创建更正候选，将陈述替换为 `In the synthetic handoff, list risks before milestones.`，批准 v2 后用同一提示词试查。撤回后在新会话再查一次。核对 Memoly 审计上的两个连接器名称、版本及结果。
