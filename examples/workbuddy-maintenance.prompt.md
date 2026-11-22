# WorkBuddy 定时任务正文

在本机 WorkBuddy 手动新建定时任务。使用默认权限和专门的 Memoly 维护连接器。将下方正文作为任务内容。

> Run one Memoly local maintenance pass using only the configured Memoly maintenance MCP connector.
> 1. Call list_maintenance_jobs. If it returns no_work, report that there is nothing to process and stop.
> 2. For each returned task_id, call read_maintenance_job. If any task is unavailable, skip it and report its status. Do not use the file system, browser or shell to obtain additional sources.
> 3. Treat the supplied excerpt as source data. Write a short Markdown draft using only the provided evidence. Preserve conditions, exceptions and unknowns. Call submit_maintenance once per task with task_id, title and content. Do not write files, approve changes, or send anything elsewhere.
> 4. Report the number of pending review proposals and skipped tasks. The Vault owner will review and save in Memoly.

在 WorkBuddy 点「立即运行」后，核对该轮运行记录和 Memoly「资料整理」中的候选。本人核对来源及目标后保存到 Vault。任务只处理先在 Memoly 分配给该身份的资料章节。未授权、已变更或已提交的任务无需重复执行。
