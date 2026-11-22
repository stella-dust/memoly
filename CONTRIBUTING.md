# 贡献 Memoly Local

Memoly Local 的开发主线是本机 Vault、stdio MCP、可复核的维护任务、个人记忆和小团队自管用法。优先解决会影响安装、真实资料取证和长时间维护的问题。

## 提 issue

说明 Node 与操作系统版本、Memoly 版本、Agent 宿主、使用的命令、预期和实际结果。附一份尽量小的合成 Markdown 和可重复步骤。文件结构、工具参数和错误文本有助于定位。报告潜在漏洞请使用 [安全报告方式](SECURITY.md)。

## 在本机开发

```sh
npm ci --ignore-scripts
npm test
node bin/memoly.js doctor
```

用 `examples/vault` 的独立副本做资料及维护测试，给测试单独设置 `MEMOLY_STATE`。常见的入口位于 `bin/memoly.js`、`src/mcp.js` 与 `src/web.js`。安装或升级改动应另跑 `npm pack --dry-run`，检查包中包含运行所需文件。

PR 说明用户可观察到的变化和已执行的检查。权限、发布或存储迁移的改动应给出对应回归用例，例如旧数据迁移、已有目标冲突、来源变更或撤权后重新查询。界面改动请给出关键状态耗时与桌面、窄屏验证情况。

使用此项目的 [Apache-2.0 许可证](LICENSE)贡献代码。
