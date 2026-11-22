"use strict";

(() => {
  const esc = s => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  let lang = "zh";
  let demoTab = "evidence";
  let citeProbe = "l7";
  let maintState = "scanned"; // scanned | stale | published
  let memState = "pending";   // pending | v1 | edit | v2 | revoked
  let usageMode = "personal"; // personal | team
  let agentTab = "workbuddy"; // workbuddy | terminal | ide
  let installTab = "release"; // release | source

  const I18N = {
    zh: {
      skip: "跳至主要内容",
      nav_demo: "交互演示",
      nav_modes: "适用模式",
      nav_arch: "运作原理",
      nav_agents: "Agent 接入",
      nav_install: "5 分钟上手",
      eyebrow: "Apache-2.0 开源软件 · 个人知识库 & 单操作者小团队",
      hero_title: "把本机知识库，<br>按<em>章节与版本</em>接给常用 Agent",
      hero_lead: "关联已有 Obsidian / Markdown 目录：查询回答必须回到文件、章节与精确行号；WorkBuddy 定时整理的草稿先经本机工作台并排复核再写回；确认过的记忆在获准助手间跨会话复用。",
      cta_release: "下载 v0.4.0 安装包 ↗",
      cta_start: "用合成 Vault 5 分钟跑通 ↓",
      cta_how: "看懂 MCP × CLI × Skills 原理",
      demo_title: "Memoly Local 交互工作台预览",
      tab_evidence: "① 原文取证",
      tab_maintain: "② 定时维护与并排复核",
      tab_memory: "③ 跨 Agent 记忆闭环",
      fixture_badge: "合成样例数据",
      modes_tag: "清晰聚焦的工作边界",
      modes_title: "同一套开源本机工具，服务个人与单操作者小团队",
      modes_desc: "不设云端账号、不绑团队收费席位。谁在本地操作工作台，谁就掌握凭据、审批与写回权。",
      mode_personal_btn: "个人知识库工作流",
      mode_team_btn: "小团队（单管理员）工作流",
      arch_tag: "五层配合 · 方法论驱动",
      arch_title: "除了 MCP，知识维护、输出、CLI 与 Skills 如何真正咬合",
      arch_desc: "MCP 只负责把受控工具交给助手；决定 Vault 长期不乱的，是回环审批台、CLI 订阅调度、内置 Skills 和人类最终合入纪律的组合。",
      agents_tag: "面向不同类型 Agent 的接入方法",
      agents_title: "按宿主职责拆开身份，而不是给所有人一把万能钥匙",
      agents_desc: "WorkBuddy、终端编程 CLI（Codex / Claude Code）与 IDE 各自走单独的 memoly connector 与 .key 凭证文件。",
      install_tag: "安全透明 · 5 分钟实跑",
      install_title: "在临时样例 Vault 里零风险试跑完整闭环",
      install_desc: "以下命令把自带样例 Vault 解压到系统临时目录，不触碰任何私人文件。验证完毕后再切换为你自己的 Vault 路径。",
      install_tab_rel: "Release 校验包 (v0.4.0)",
      install_tab_src: "源码运行 (git clone)",
      link_readme: "阅读中文 README ↗",
      link_method: "方法论手册 ↗",
      link_agents: "多 Agent 手册 ↗",
      copy_btn: "复制命令",
      faq_title: "常见疑问与安全边界"
    },
    en: {
      skip: "Skip to main content",
      nav_demo: "Interactive Demo",
      nav_modes: "Use Modes",
      nav_arch: "How It Works",
      nav_agents: "Agents",
      nav_install: "Quickstart",
      eyebrow: "Apache-2.0 Open Source · Personal Vaults & Single-Operator Small Teams",
      hero_title: "Connect Your Local Vault<br>by <em>Exact Section &amp; Revision</em>",
      hero_lead: "Attach an existing Obsidian or Markdown directory: answers cite files, headings, and line numbers; recurring WorkBuddy drafts wait for side-by-side owner review; confirmed memories stay portable across approved Agents.",
      cta_release: "Download v0.4.0 Release ↗",
      cta_start: "5-Min Fixture Quickstart ↓",
      cta_how: "How MCP × CLI × Skills Fit",
      demo_title: "Memoly Local Workbench Preview",
      tab_evidence: "1. Citation Evidence",
      tab_maintain: "2. Recurring Maintenance",
      tab_memory: "3. Cross-Agent Memory",
      fixture_badge: "Synthetic Fixture",
      modes_tag: "Clean Operating Boundaries",
      modes_title: "One Local Tooling Stack for Solo Owners & Small Teams",
      modes_desc: "No cloud accounts, no per-seat billing. The single local operator controls credentials, reviews, and writes.",
      mode_personal_btn: "Personal Vault Workflow",
      mode_team_btn: "Single-Operator Team",
      arch_tag: "Five Layers · Guided by Methodology",
      arch_title: "How MCP, CLI Feeds, Loopback Review & Skills Work Together",
      arch_desc: "MCP exposes narrow tools; long-term cleanliness comes from loopback approval, recurring CLI feeds, bundled skills, and manual canonical merge.",
      agents_tag: "Per-Host Identity Setup",
      agents_title: "Separate Credentials by Agent Role Instead of One Shared Token",
      agents_desc: "WorkBuddy, terminal CLIs (Codex / Claude Code), and IDEs each use an independent 0600 credential file.",
      install_tag: "Auditable · 5-Min Run",
      install_title: "Try the Full Loop in a Disposable Temp Vault",
      install_desc: "Unpacks the bundled synthetic fixture into a temp directory without touching personal notes.",
      install_tab_rel: "Release Tarball (v0.4.0)",
      install_tab_src: "From Source (git clone)",
      link_readme: "Read English README ↗",
      link_method: "Methodology Guide ↗",
      link_agents: "Multi-Agent Guide ↗",
      copy_btn: "Copy Commands",
      faq_title: "FAQ & Security Boundaries"
    }
  };

  const CITE_DATA = {
    l7: {
      line: "7",
      kind: "is-good",
      titleZh: "允许返回 · 核对第 7 行",
      titleEn: "Granted · Verified Line 7",
      msgZh: "当前演练编号为 <strong>MEMOLY-DEMO-314</strong>，来自授权章节。",
      msgEn: "Drill serial number is <strong>MEMOLY-DEMO-314</strong> from the granted section.",
      json: `{ "status": "ok", "citation": { "document_id": "inbox/shift-handoff.md", "heading": "Lockout review", "start_line": 7, "end_line": 7, "revision": "9f3c41e2a21b8810" } }`
    },
    l6: {
      line: "6",
      kind: "is-good",
      titleZh: "允许返回 · 核对第 6 行",
      titleEn: "Granted · Verified Line 6",
      msgZh: "例外处理规则：<strong>若复核人不在岗</strong>，则保留演练工单至下一班次。",
      msgEn: "Exception rule: <strong>hold the simulation ticket</strong> if the reviewer is unavailable.",
      json: `{ "status": "ok", "citation": { "document_id": "inbox/shift-handoff.md", "heading": "Lockout review", "start_line": 6, "end_line": 6, "revision": "9f3c41e2a21b8810" } }`
    },
    l11: {
      line: "11",
      kind: "is-denied",
      titleZh: "越权隔离 · 严格拒绝返回",
      titleEn: "Scope Enforced · Denied",
      msgZh: "同文件下 <strong>Private training note</strong> 未在当前章节授权列表中，绝不泄露原文或存在性。",
      msgEn: "Sibling heading <strong>Private training note</strong> is unshared; Memoly returns an opaque denial.",
      json: `{ "status": "not_found_or_unavailable" }`
    }
  };

  const MEMORY_DATA = {
    pending: {
      zh: ["候选状态：pending（WorkBuddy 提交）", "所有者确认前，Codex 查不到任何正文。"],
      en: ["Status: pending (submitted by WorkBuddy)", "Codex cannot read any body before owner approval."],
      cls: "is-denied",
      json: `{ "status": "not_found_or_unavailable" }`
    },
    v1: {
      zh: ["生效版本：v1 · 仅授权 reader = [codex]", "WorkBuddy 不在读者列表时同样不可读取。"],
      en: ["Active: v1 · Authorized reader = [codex]", "Unlisted agents continue receiving not_found_or_unavailable."],
      cls: "is-good",
      json: `{ "status": "ok", "memory": { "key": "demo-handoff-preference", "version": 1, "statement": "In the synthetic handoff, list milestones before action items." } }`
    },
    edit: {
      zh: ["更正待审：expected_version=1（Codex 仍稳读 v1）", "批准 v2 前，外部读取不受未确认修改污染。"],
      en: ["Correction pending: expected_version=1 (Codex still sees v1)", "Pending edits never pollute live reads before owner confirmation."],
      cls: "",
      json: `{ "status": "ok", "memory": { "key": "demo-handoff-preference", "version": 1, "statement": "In the synthetic handoff, list milestones before action items." } }`
    },
    v2: {
      zh: ["发布新版本：v2 · v1 自动进入历史留痕", "Codex 下一次调用即刻切换至最新确认表述（支持中文检索）。"],
      en: ["Published: v2 · v1 automatically marked superseded", "Codex picks up the revised confirmed rule on the next turn."],
      cls: "is-good",
      json: `{ "status": "ok", "memory": { "key": "demo-handoff-preference", "version": 2, "statement": "In the synthetic handoff, list risks before milestones." } }`
    },
    revoked: {
      zh: ["已撤回共享：revoked", "所有连接器下一次查询立即返回不可用。"],
      en: ["Revoked immediately by owner", "All connectors lose access on the next turn."],
      cls: "is-denied",
      json: `{ "status": "not_found_or_unavailable" }`
    }
  };

  function updateHeader() {
    const hdr = document.getElementById("site-header");
    if (hdr) hdr.dataset.scrolled = String(window.scrollY > 24);
  }
  window.addEventListener("scroll", updateHeader, { passive: true });
  window.addEventListener("pageshow", updateHeader);

  function renderEvidence() {
    const data = CITE_DATA[citeProbe];
    document.querySelectorAll("[data-cite-probe]").forEach(btn => {
      btn.setAttribute("aria-pressed", String(btn.dataset.citeProbe === citeProbe));
    });
    const lines = document.querySelectorAll("#evidence-mount .v4-line");
    lines.forEach(lineEl => {
      const num = lineEl.querySelector(".v4-line-num")?.textContent.trim();
      const active = (citeProbe === "l7" && num === "07") || (citeProbe === "l6" && num === "06") || (citeProbe === "l11" && num === "11");
      lineEl.querySelector("mark")?.setAttribute("data-active", String(active));
    });
    const box = document.getElementById("citation-receipt");
    if (!box) return;
    box.className = `receipt-box ${data.kind}`;
    box.innerHTML = `
      <strong>${esc(lang === "zh" ? data.titleZh : data.titleEn)}</strong>
      <div>${lang === "zh" ? data.msgZh : data.msgEn}</div>
      <pre>${esc(data.json)}</pre>
    `;
  }

  function renderMaintain() {
    const el = document.getElementById("panel-maintain");
    if (!el) return;
    const zh = lang === "zh";
    const isStale = maintState === "stale";
    const isPub = maintState === "published";
    el.innerHTML = `
      <div style="display:grid;gap:14px">
        <div class="chip-row" role="group" aria-label="Maintenance stage">
          <button type="button" class="chip-btn" data-maint-state="scanned" aria-pressed="${maintState === "scanned"}">${zh ? "① WorkBuddy 定时产出提案" : "1. WorkBuddy Proposed Draft"}</button>
          <button type="button" class="chip-btn" data-maint-state="stale" aria-pressed="${isStale}">${zh ? "② 模拟无关节改动导致版本失效" : "2. Stale Revision Blocked"}</button>
          <button type="button" class="chip-btn" data-maint-state="published" aria-pressed="${isPub}">${zh ? "③ 批准写入 notes/ 并人工合入" : "3. Approved -> notes/ & Merge"}</button>
        </div>
        <div class="diff-grid">
          <div class="diff-pane ${isStale ? "stale" : ""}">
            <strong>${zh ? "左侧：原件固定证据 (inbox/shift-handoff.md)" : "Source Evidence (Pinned Revision)"}</strong>
            <div style="font:12px var(--rb-mono);color:var(--rb-ink-3)">${isStale ? (zh ? "⚠ 当前磁盘哈希变化 · 批准写入已禁用；点「退回任务」清理后下轮自动重排，不丢更新" : "⚠ Source revision changed on disk · Approve disabled; rejecting clears card without suppressing next scan") : "L3–L7 · sha256:9f3c41e2 · OK"}</div>
            <pre>## Lockout review
The training bench owner validates the work order before handoff.
If the reviewer is unavailable, hold the simulation ticket until the next shift.
The serial number for this synthetic drill is MEMOLY-DEMO-314.</pre>
          </div>
          <div class="diff-pane ${isPub ? "proposal" : ""}">
            <strong>${zh ? "右侧：WorkBuddy 拟写草案 → 目标 notes/weekly/handoff.md" : "Proposed Draft → notes/weekly/handoff.md"}</strong>
            <div style="font:12px var(--rb-mono);color:var(--rb-ink-3)">${isPub ? (zh ? "✓ 已原子写入 notes/ · 原件保持只读未改动" : "✓ Created atomically in notes/ · Source file untouched") : (zh ? "状态：proposed（等待所有者拍板）" : "Status: proposed (owner review pending)")}</div>
            <pre>---
title: "交接演练审核摘要"
created: 2026-11-22
updated: 2026-11-22
status: inbox
sources: ["inbox/shift-handoff.md#L3-L7"]
---
- 班次交接前由台架负责人核对工单。
- 例外：若复核人不在岗，保留演练工单等下一班次（序列号：MEMOLY-DEMO-314）。</pre>
          </div>
        </div>
        <div class="receipt-box ${isStale ? "is-denied" : "is-good"}">
          <strong>${isPub ? (zh ? "人工最后一步 · Canonical Merge 纪律" : "Human Canonical Merge Discipline") : isStale ? (zh ? "0.4.0 安全修复：退回失效卡不吞更新" : "0.4.0 Fix: Safe Stale Dismissal") : (zh ? "定时订阅仅对改变的章节建单" : "Feeds Queue Only Changed Excerpts")}</strong>
          <div>${isPub ? (zh ? "新建草案落盘后带 <code>sources</code> 行号溯源；个人或小团队管理员可在 Obsidian 中决定是否合入主项目卡。" : "Approved drafts live safely in <code>notes/</code>; humans manually consolidate takeaways into project MOCs.") : isStale ? (zh ? "仅变更了无关私有节导致任务哈希过时？在工作台点退回仅标记 <code>stale_on_reject=1</code>，下一周定时扫描仍会自动为新版本排队。" : "Edited an unrelated heading? Dismissing the stale card marks <code>stale_on_reject=1</code> so the next scheduled pass still queues the updated excerpt.") : (zh ? "通过 <code>memoly feed add</code> 绑定章节；每次 WorkBuddy 运行 `list_maintenance_jobs` 时按内容指纹去重。" : "Bound via <code>memoly feed add</code>; each scheduled pass scans excerpts and deduplicates by content digest.")}</div>
        </div>
      </div>
    `;
  }

  function renderMemory() {
    const el = document.getElementById("panel-memory");
    if (!el) return;
    const zh = lang === "zh";
    const cur = MEMORY_DATA[memState];
    const labels = zh
      ? [["pending", "1. 待确认 (Pending)"], ["v1", "2. 批准 v1"], ["edit", "3. 更正待审 (读 v1)"], ["v2", "4. 发布 v2"], ["revoked", "5. 撤回共享"]]
      : [["pending", "1. Pending"], ["v1", "2. Approve v1"], ["edit", "3. Edit Pending"], ["v2", "4. Publish v2"], ["revoked", "5. Revoked"]];
    el.innerHTML = `
      <div style="display:grid;gap:14px">
        <div class="chip-row" role="group" aria-label="Memory lifecycle stage">
          ${labels.map(([id, txt]) => `<button type="button" class="chip-btn" data-mem-state="${id}" aria-pressed="${memState === id}">${esc(txt)}</button>`).join("")}
        </div>
        <div class="receipt-box ${cur.cls}">
          <strong>${esc(cur[lang][0])}</strong>
          <div>${esc(cur[lang][1])}</div>
          <pre>${esc(cur.json)}</pre>
        </div>
      </div>
    `;
  }

  function renderMode() {
    document.querySelectorAll("[data-mode-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.modeTab === usageMode)));
    const el = document.getElementById("mode-mount");
    if (!el) return;
    const zh = lang === "zh";
    if (usageMode === "personal") {
      el.innerHTML = zh ? `
        <article class="rb-card tint">
          <h3>你的 Obsidian Vault 与个人边界</h3>
          <p>适合独自使用 Obsidian / 本地 Markdown 笔记，并在多个 AI 助手间切换的个人创作者与开发者。</p>
          <ul>
            <li><strong>零云端上传：</strong>全部检索（含中文空格切词）和状态库均在本地运行，不注册在线账号。</li>
            <li><strong>按目录设防：</strong><code>MEMORY.md</code>、<code>_archive/</code> 及 <code>status: inbox/draft</code> 笔记默认禁止外部共享。</li>
            <li><strong>写前先看 Diff：</strong>AI 整理草稿永远只新建于 <code>notes/</code>，绝不覆盖你辛苦维护的主卡片。</li>
          </ul>
        </article>
        <article class="rb-card">
          <h3>个人每周推荐节奏</h3>
          <ul>
            <li><strong>日常问答：</strong>WorkBuddy / Codex 使用 <code>memoly-agent</code> 技能查证，回答自带路径与行号。</li>
            <li><strong>周一自动整理：</strong>WorkBuddy 定时任务跑完 <code>feed</code>，生成本周周报与例外清单草案。</li>
            <li><strong>5 分钟复核：</strong>打开 <code>http://127.0.0.1:8766</code> 过一遍提案与待确认记忆，一键放行或撤回。</li>
          </ul>
        </article>
      ` : `
        <article class="rb-card tint">
          <h3>Your Private Obsidian Vault</h3>
          <p>Built for solo writers and developers running multiple local AI tools over one Markdown knowledge base.</p>
          <ul>
            <li><strong>100% Local State:</strong> SQLite WAL, CJK search, and 0600 keys stay on your disk outside the Vault.</li>
            <li><strong>Built-In Privacy Gates:</strong> Draft/inbox frontmatter statuses and reserved folders are never shared.</li>
            <li><strong>Immutable Input Guarantee:</strong> Maintenance drafts only write new Markdown inside <code>notes/</code>.</li>
          </ul>
        </article>
        <article class="rb-card">
          <h3>Calm Weekly Solo Cadence</h3>
          <ul>
            <li><strong>Daily Recall:</strong> Query granted notes with file, heading, line, and revision citations.</li>
            <li><strong>Weekly Maintenance:</strong> Let WorkBuddy triage changed sections into <code>notes/</code>.</li>
            <li><strong>5-Min Owner Review:</strong> Compare side-by-side in <code>127.0.0.1:8766</code>, publish drafts, curate memories.</li>
          </ul>
        </article>
      `;
    } else {
      el.innerHTML = zh ? `
        <article class="rb-card tint">
          <h3>单操作者小团队协作架构</h3>
          <p>适合 2–8 人研发/运营小团队，用 Git、Syncthing 或 iCloud 共享项目手册与复盘库，由 1 位管理员在本机统一运营 Memoly。</p>
          <ul>
            <li><strong>只同步 Vault 文件：</strong>团队成员在各自桌面写会议记录、项目交接单；只同步 Markdown 原件目录。</li>
            <li><strong>凭据与数据库留单机：</strong><code>~/.memoly</code> 状态库与各 Agent <code>.key</code> 文件留在管理员本地，严禁入库同步。</li>
            <li><strong>边界清晰：</strong>当前版本故意不含多成员账号体系、目录 RBAC 权限或远程 SaaS 控制台。</li>
          </ul>
        </article>
        <article class="rb-card">
          <h3>小团队推荐落地用法</h3>
          <ul>
            <li><strong>多章节分授：</strong>同一份交接规范可把「操作口径」授给问答助手，把「内部排故」仅留给管理员。</li>
            <li><strong>团队记忆广播：</strong>管理员审核确认某项发布 norm 后，同步勾选授权 Codex 与 WorkBuddy 只读复用。</li>
            <li><strong>即时撤销防泄：</strong>任意代理宿主不再使用时执行 <code>memoly connector revoke &lt;id&gt;</code>，即刻生效。</li>
          </ul>
        </article>
      ` : `
        <article class="rb-card tint">
          <h3>Single-Operator Small Team Topology</h3>
          <p>Ideal for 2–8 person engineering or ops teams syncing Markdown notes via Git, Syncthing, or shared drives with one designated operator.</p>
          <ul>
            <li><strong>Sync Vault Only:</strong> Team members collaborate on Markdown notes; only the content folder syncs.</li>
            <li><strong>Private Control Plane:</strong> <code>~/.memoly</code> SQLite and connector keys never enter Git or cloud sync.</li>
            <li><strong>Intentional Scope:</strong> No per-member logins, multi-tenant web auth, or SaaS billing overhead.</li>
          </ul>
        </article>
        <article class="rb-card">
          <h3>Recommended Team Habits</h3>
          <ul>
            <li><strong>Exact Chapter Shares:</strong> Share public runbook sections independently from internal post-mortem sections.</li>
            <li><strong>Curated Team Norms:</strong> Publish verified habits as active memories and revoke instantly when obsolete.</li>
            <li><strong>Central Weekly Triage:</strong> Operator reviews weekly WorkBuddy feed drafts and merges takeaways into team MOCs.</li>
          </ul>
        </article>
      `;
    }
  }

  function renderPillars() {
    const el = document.getElementById("pillars-mount");
    if (!el) return;
    const zh = lang === "zh";
    const cards = zh ? [
      ["MCP + CLI · 工具与调度", "MCP 提供 9 个受控只读/拟稿/记忆工具；CLI (<code>memoly feed / share / skill</code>) 负责建库、发钥匙与配置每周增量扫描。"],
      ["Web UI (127.0.0.1) · 人类闸口", "大模型永远进不了网页控制台。原件 vs 草案并排对比、版本失效拦截与记忆批准/撤回全由本人操作。"],
      ["Skills + 方法论 · 长期秩序", "内置 <code>memoly-agent</code>、<code>memoly-maintain</code> 与 <code>memoly-operator</code> 三个 Skill，固化查证规范与「建新稿→人工合入」闭环。"]
    ] : [
      ["MCP + CLI · Scoped Execution", "MCP exposes 9 strict tools; the <code>memoly</code> CLI manages feeds, chapter grants, 0600 keys, and bundled skills."],
      ["127.0.0.1 Web UI · Human Gate", "Agents never access the owner console. Side-by-side diff approvals and memory releases remain strictly human-triggered."],
      ["Skills + Methodology · Clean Vaults", "Three bundled skills (<code>memoly-agent</code>, <code>memoly-maintain</code>, <code>memoly-operator</code>) standardize safe retrieval and manual merges."]
    ];
    el.innerHTML = cards.map(([h, p]) => `<article class="rb-card"><h3>${esc(h)}</h3><p>${p}</p></article>`).join("");
  }

  function renderAgentGuide() {
    document.querySelectorAll("[data-agent-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.agentTab === agentTab)));
    const el = document.getElementById("agent-guide-mount");
    if (!el) return;
    const zh = lang === "zh";
    const guides = {
      workbuddy: {
        title: zh ? "桌面助手 + 定时调度（WorkBuddy 推荐双身份模式）" : "Desktop GUI + Cron (WorkBuddy Dual-Identity Setup)",
        scopes: "workbuddy (knowledge,memory:submit) + workbuddy-maintenance (maintenance)",
        desc: zh ? "日常对话与每周无人值守整理严格拆开：定时身份只能读取指定的单个维护章节并提交草稿，看不到任何私人记忆或其他文档。" : "Split interactive chat from scheduled triage so autonomous runs only read pinned maintenance chapters.",
        cmd: `memoly connector add workbuddy --scopes knowledge,memory:submit\nmemoly connector config workbuddy\n\nmemoly connector add workbuddy-maintenance --scopes maintenance\nmemoly connector config workbuddy-maintenance\nmemoly feed add workbuddy-maintenance inbox/shift-handoff.md 'Lockout review' notes`
      },
      terminal: {
        title: zh ? "终端编程助手（Codex CLI & Claude Code）" : "Terminal Coding Agents (Codex CLI & Claude Code)",
        scopes: "codex / claude (knowledge,memory:read)",
        desc: zh ? "写代码时直接调用已授权的设计决策与经确认的项目规范记忆，回答附带精确文件路径与版本号，不猜测未授权目录。" : "Recall grounded architectural decisions and confirmed personal conventions straight from your terminal.",
        cmd: `memoly connector add codex --scopes knowledge,memory:read\nmemoly connector config codex\n\ncodex mcp add memoly-codex -- '/ABS/PATH/TO/node' '/ABS/PATH/TO/bin/memoly.js' mcp codex \\\n  --state '/ABS/PATH/TO/state' --credential-file '/ABS/PATH/TO/state/connectors/codex.key'`
      },
      ide: {
        title: zh ? "IDE 与通用 Stdio MCP 宿主（Cursor / Windsurf 等）" : "IDEs & Generic Stdio MCP Hosts (Cursor / Windsurf)",
        scopes: "ide-agent (knowledge,memory:read)",
        desc: zh ? "任意支持 stdio MCP 协议的客户端均可直接复用 memoly connector config 生成的 JSON，并可随时搭配 memoly-agent Skill 使用。" : "Any stdio-compatible IDE drops in the exact JSON output from memoly connector config and bundled SKILL.md rules.",
        cmd: `memoly connector add ide-agent --scopes knowledge,memory:read\nmemoly connector config ide-agent\n\n# Find bundled skill files for your IDE rules directory:\nmemoly skill path\nmemoly skill list`
      }
    };
    const g = guides[agentTab];
    el.innerHTML = `
      <div class="grid-2">
        <article class="rb-card tint">
          <h3>${esc(g.title)}</h3>
          <div style="font:600 12.5px var(--rb-mono);color:var(--rb-indigo-deep)">${esc(g.scopes)}</div>
          <p>${esc(g.desc)}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
            <a class="rb-btn sm" href="../docs/agents.md">${zh ? "查看完整多 Agent 文档 ↗" : "Full Multi-Agent Docs ↗"}</a>
            <a class="rb-btn sm" href="../docs/workbuddy.md">${zh ? "WorkBuddy 定时手册 ↗" : "WorkBuddy Cron Guide ↗"}</a>
          </div>
        </article>
        <div class="terminal">
          <div class="terminal-bar">
            <span>CLI Setup</span>
            <button type="button" class="copy-btn" data-copy-text="${esc(g.cmd)}">${zh ? "复制配置命令" : "Copy"}</button>
          </div>
          <pre><code>${esc(g.cmd)}</code></pre>
          <p class="copy-status" role="status"></p>
        </div>
      </div>
    `;
  }

  function renderInstall() {
    document.querySelectorAll("[data-install-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.installTab === installTab)));
    const label = document.getElementById("terminal-label");
    const pre = document.querySelector("#install-code code");
    if (!label || !pre) return;
    if (installTab === "release") {
      label.textContent = "macOS / Linux · Release v0.4.0 + SHA-256";
      pre.textContent = `MEMOLY_ARCHIVE="$PWD/memoly-local-0.4.0.tgz"
shasum -a 256 -c "\${MEMOLY_ARCHIVE##*/}.sha256" &&
  npm install --global --prefix "$HOME/.local/memoly" --ignore-scripts "$MEMOLY_ARCHIVE"

MEMOLY_DEMO="$(mktemp -d)"
tar -xzf "$MEMOLY_ARCHIVE" -C "$MEMOLY_DEMO" package/examples/vault
"$HOME/.local/memoly/bin/memoly" init --vault "$MEMOLY_DEMO/package/examples/vault" --state "$MEMOLY_DEMO/state" --write-root notes
"$HOME/.local/memoly/bin/memoly" serve --state "$MEMOLY_DEMO/state"`;
    } else {
      label.textContent = "macOS / Linux · Git Source Checkout";
      pre.textContent = `git clone https://github.com/stella-dust/memoly.git
cd memoly
npm ci --ignore-scripts
npm test

MEMOLY_DEMO="$(mktemp -d)"
cp -R examples/vault "$MEMOLY_DEMO/vault"
node bin/memoly.js init --vault "$MEMOLY_DEMO/vault" --state "$MEMOLY_DEMO/state" --write-root notes
node bin/memoly.js serve --state "$MEMOLY_DEMO/state"`;
    }
  }

  function renderFaq() {
    const el = document.getElementById("faq-mount");
    if (!el) return;
    const zh = lang === "zh";
    const items = zh ? [
      ["为什么不直接把整个 Obsidian 文件夹挂载给 MCP？", "传统整库共享很难防住草稿、私密日记或无关章节被顺手读出，也无法保证引用行号对应当前文件版本。Memoly 强制按「文档 + 精确章节标题 + SHA-256 哈希」最小授权。"],
      ["我已经装了 MCP，日常维护、输出合并和 Skills 怎么协作？", "MCP 只暴露受限读写工具；WorkBuddy 定时用 memoly-maintain 扫描变更后把提案写进 SQLite，你打开本机回环工作台并排核对原件与提案，批准写入 notes/ 新文件，最后手动合入主笔记——AI 绝不直接覆盖原稿。"],
      ["多个人想共同维护一个团队知识库怎么用？", "让小团队只同步 Obsidian/Markdown 文件夹（Git、Syncthing 等），由 1 位管理员在自己电脑跑 memoly serve 和 ~/.memoly 状态库；多账号云端与企业私有化当前暂停，专注把单机内核做稳。"],
      ["如果我在批准前改了无关章节，定期维护会漏掉有效更新吗？", "v0.4.0 已专门修复此场景：你在工作台清理因原件版本变化而过时的待审卡片时，系统会记为版本过期清理（stale_on_reject），下一次周扫描仍会为最新版本重新排队，只有对有效内容本身的人工否决才会被去重保留。"]
    ] : [
      ["Why not expose the entire Obsidian directory to MCP directly?", "Giving an agent whole-folder access risks leaking drafts, MEMORY.md, or unrelated notes. Memoly pins each grant to (document, exact heading, SHA-256 revision)."],
      ["Do Agents ever modify my existing notes directly?", "No. Approved maintenance drafts only create new UTF-8 Markdown files under --write-root (like notes/), citing exact source lines so humans merge canonically."],
      ["Can a small team use Memoly Local?", "Yes—one designated operator runs Memoly locally while the team syncs only the Vault directory via Git or Syncthing. Credentials and SQLite stay private on the operator host."],
      ["What happens if an unrelated section changes while a review card is pending?", "Fixed in v0.4.0: dismissing a stale card marks stale_on_reject=1 so future scheduled feed scans still re-queue the revised section without swallowing updates."]
    ];
    el.innerHTML = items.map(([q, a]) => `
      <details class="faq-item">
        <summary>${esc(q)}</summary>
        <p>${esc(a)}</p>
      </details>
    `).join("");
  }

  function applyLang() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    const dict = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach(node => {
      const k = node.dataset.i18n;
      if (dict[k]) {
        if (k === "hero_title") node.innerHTML = dict[k];
        else node.textContent = dict[k];
      }
    });
    renderEvidence();
    renderMaintain();
    renderMemory();
    renderMode();
    renderPillars();
    renderAgentGuide();
    renderInstall();
    renderFaq();
  }

  async function copyText(text, statusNode) {
    try {
      await navigator.clipboard.writeText(text);
      if (statusNode) statusNode.textContent = lang === "zh" ? "已复制到剪贴板。" : "Copied to clipboard.";
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (statusNode) statusNode.textContent = lang === "zh" ? "已复制到剪贴板。" : "Copied to clipboard.";
    }
  }

  document.addEventListener("click", evt => {
    const langBtn = evt.target.closest("#lang-toggle");
    if (langBtn) { lang = lang === "zh" ? "en" : "zh"; applyLang(); return; }

    const demoBtn = evt.target.closest("[data-demo-tab]");
    if (demoBtn) {
      demoTab = demoBtn.dataset.demoTab;
      document.querySelectorAll("[data-demo-tab]").forEach(t => {
        const active = t.dataset.demoTab === demoTab;
        t.setAttribute("aria-selected", String(active));
        t.tabIndex = active ? 0 : -1;
        const p = document.getElementById(t.getAttribute("aria-controls"));
        if (p) p.hidden = !active;
      });
      return;
    }

    const citeBtn = evt.target.closest("[data-cite-probe]");
    if (citeBtn) { citeProbe = citeBtn.dataset.citeProbe; renderEvidence(); return; }

    const mBtn = evt.target.closest("[data-maint-state]");
    if (mBtn) { maintState = mBtn.dataset.maintState; renderMaintain(); return; }

    const memBtn = evt.target.closest("[data-mem-state]");
    if (memBtn) { memState = memBtn.dataset.memState; renderMemory(); return; }

    const modeBtn = evt.target.closest("[data-mode-tab]");
    if (modeBtn) { usageMode = modeBtn.dataset.modeTab; renderMode(); return; }

    const agBtn = evt.target.closest("[data-agent-tab]");
    if (agBtn) { agentTab = agBtn.dataset.agentTab; renderAgentGuide(); return; }

    const insBtn = evt.target.closest("[data-install-tab]");
    if (insBtn) { installTab = insBtn.dataset.installTab; renderInstall(); return; }

    const copyBtn = evt.target.closest("[data-copy-text]");
    if (copyBtn) {
      const box = copyBtn.closest(".terminal")?.querySelector(".copy-status");
      void copyText(copyBtn.dataset.copyText, box);
      return;
    }

    if (evt.target.closest("#copy-install-btn")) {
      const code = document.querySelector("#install-code code")?.textContent || "";
      void copyText(code, document.getElementById("copy-install-status"));
    }
  });

  // Keyboard navigation for hero tablist
  document.addEventListener("keydown", evt => {
    const tab = evt.target.closest("[data-demo-tab]");
    if (!tab) return;
    const tabs = [...document.querySelectorAll("[data-demo-tab]")];
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[evt.key];
    let target;
    if (dir) target = tabs[(tabs.indexOf(tab) + dir + tabs.length) % tabs.length];
    if (evt.key === "Home") target = tabs[0];
    if (evt.key === "End") target = tabs.at(-1);
    if (!target) return;
    evt.preventDefault();
    target.click();
    target.focus();
  });

  updateHeader();
  applyLang();
})();
