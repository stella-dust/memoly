# Multi-Agent Integration Guide (面向不同类型 Agent 的接入指南)

Memoly Local assigns a dedicated **connector identity** and **0600 credential file** to each desktop host, coding CLI, or IDE. Never reuse one agent's configuration for another—keeping identities separate lets you inspect the Web UI audit trail and revoke a single agent cleanly at any time.

---

## Capability Scopes at a Glance

| Connector Archetype | Recommended `--scopes` | Exposed MCP Tools | Typical Agents |
| --- | --- | --- | --- |
| **Q&A + Memory Proposer** | `knowledge,memory:submit` | `search_knowledge`, `read_knowledge`, `explore_knowledge`, `submit_memory` | WorkBuddy (interactive chat) |
| **Scheduled Maintenance Worker** | `maintenance` | `list_maintenance_jobs`, `read_maintenance_job`, `submit_maintenance` | WorkBuddy (local recurring automation) |
| **Coding / Read-Only Recall** | `knowledge,memory:read` | `search_knowledge`, `read_knowledge`, `explore_knowledge`, `read_memory`, `search_memory` | Codex CLI, Claude Code, Cursor |
| **Bidirectional Reviewer** | `knowledge,memory:read,memory:submit` | Read/search + `submit_memory` (owner still approves every memory version) | Primary coding or research assistant |

Use `memoly skill list` and `memoly skill path` to find the bundled `memoly-agent`, `memoly-maintain`, and `memoly-operator` skills packaged with the CLI.

---

## 1. Desktop GUI & Scheduled Automation Agents (e.g. WorkBuddy)

Best for daily Q&A against Obsidian notes and automated weekly or daily vault triage.

- **Pattern**: Create **two separate identities** (`workbuddy` for Q&A, `workbuddy-maintenance` strictly for scheduled maintenance) so an autonomous schedule never reads memory or unrelated chapters.
- **Commands**:
  ```sh
  memoly connector add workbuddy --scopes knowledge,memory:submit
  memoly connector config workbuddy

  memoly connector add workbuddy-maintenance --scopes maintenance
  memoly connector config workbuddy-maintenance
  ```
- **Setup**: Paste the generated `mcpServers` block into WorkBuddy → Custom MCP Connectors, authorize specific sections (`memoly share workbuddy ...`) or recurring feeds (`memoly feed add workbuddy-maintenance ...`), and optionally install the `memoly-maintain` skill from `$(memoly skill path)`.
- See the dedicated step-by-step manual: [WorkBuddy Integration & Scheduled Maintenance](workbuddy.md).

---

## 2. Terminal Coding Agents (Codex CLI · Claude Code)

Best when terminal coding agents need project decisions, coding standards, or cross-agent user preferences verified from your Vault and confirmed memory.

### Codex CLI
```sh
memoly connector add codex --scopes knowledge,memory:read
memoly connector config codex
```
Take the printed absolute `command` and `args` from `memoly connector config codex` and register with `codex mcp add`:
```sh
codex mcp add memoly-codex -- '/ABS/PATH/TO/node' '/ABS/PATH/TO/bin/memoly.js' mcp codex \
  --state '/ABS/PATH/TO/state' --credential-file '/ABS/PATH/TO/state/connectors/codex.key'
codex mcp list
```
Reference: [Codex MCP CLI](https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs).

### Claude Code
```sh
memoly connector add claude --scopes knowledge,memory:read,memory:submit
memoly connector config claude
```
Register via standard stdio MCP configuration (either project `.mcp.json` or user MCP settings using the exact JSON produced by `memoly connector config claude`), keeping the `--credential-file` path private on local disk (`0600`). Do **not** commit `.mcp.json` if it references your local state paths, or add machine-specific configs locally.

### Recommended Verification Prompt (Codex / Claude Code)
> Use only the Memoly MCP connector. First check active memory with `search_memory` or `read_memory` (for key `demo-handoff-preference`). Next query granted docs with `search_knowledge` followed by `read_knowledge`. Report exact file paths, headings, line numbers, revisions, and active memory versions. If unavailable, report honestly without guessing.

---

## 3. IDE & Generic Stdio MCP Hosts (Cursor · Windsurf · Custom Agents)

Any IDE or agent runtime supporting standard MCP `stdio` transport works out of the box:

```sh
memoly connector add ide-agent --scopes knowledge,memory:read
memoly connector config ide-agent
```

1. Copy the generated `mcpServers` JSON directly into your IDE MCP settings (`stdio` type).
2. Grant only the project documentation chapters relevant to that workspace via `memoly share ide-agent <relative-path> "<Exact Heading>"` or the Web UI (`知识 Vault → 向 Agent 授权章节`).
3. To share bundled agent instructions, inspect `memoly skill list` and copy `skills/memoly-agent/SKILL.md` into your IDE rules/skills directory.

---

## 4. Rotating or Revoking Any Agent Identity

- **Pause / Permanently Revoke One Host**:
  ```sh
  memoly connector revoke codex
  ```
  Revocation takes effect immediately inside the database; connector IDs cannot be reused later (register a new identity like `codex-v2` if re-onboarding).
- **Revoke a Single Section Grant**:
  ```sh
  memoly unshare workbuddy "inbox/shift-handoff.md" "Lockout review"
  ```
  Note: As of `0.4.0`, mistyping the filename or heading returns an explicit error instead of silently succeeding.
