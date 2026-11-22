# Memoly Methodology & Operating Rhythm (方法论与日常运作规范)

Installing MCP connects an assistant to tools—**methodology determines whether your Vault stays clean, trustworthy, and effortless to operate over months**.

---

## Pillar 1 · Vault Structure & Privacy Gate

You do not need to rewrite your Vault from scratch. Follow three simple conventions:

1. **Designate one AI output subdirectory (`--write-root`, e.g. `notes/`)**:
   - Approved maintenance proposals only ever create **new Markdown files** inside this directory (including UTF-8 nested subdirectories such as `notes/weekly-summaries/`).
   - Source files elsewhere in the Vault are never modified directly by AI agents.
2. **Use frontmatter `status` to separate raw notes from shareable knowledge**:
   - Notes with `status` set to `inbox`, `draft`, `archived`, or `superseded` are **automatically blocked** from external `knowledge` reads, while still readable inside the local owner Web UI and usable as sources for controlled `maintenance` drafting.
   - Promote a note's `status` (e.g. remove `inbox` or set `reviewed` / `active`) once you want Agents to cite it.
3. **Never touch reserved private names for shared knowledge**:
   - Directories starting with `.`, `_archive/`, `_meta/`, `memory/`, `outputs/`, `personal-ip/`, and filenames `MEMORY.md`, `INBOX.md`, `HANDOFF.md`, `LOG.md` are blocked from `knowledge` sharing (while `_meta/` may optionally feed maintenance jobs).

---

## Pillar 2 · Chapter & Revision Pinning (Why Whole-Vault Access Fails)

- **Grant by exact heading**: Instead of exposing an entire 500-line note, grant only `## Decision` or `## Lockout review`. Sibling sections in the same file remain completely invisible (`not_found_or_unavailable`). Starting in `0.4.0`, multiple headings in the same file can be granted and revoked independently.
- **Automatic hash invalidation**: Every share and maintenance task pins the file's SHA-256 `revision`. If you edit a shared note, stale external grants and pending maintenance jobs immediately stop serving old text until you inspect and re-approve.

---

## Pillar 3 · Controlled Proposal vs Canonical Merge

Memoly separates **AI synthesis** from **canonical knowledge curation**:

1. **Recurring maintenance (`memoly feed`)** watches specific Markdown headings (such as weekly project inbox logs). When that section's content digest changes, WorkBuddy drafts a timestamped summary for review.
2. **Side-by-side verification**: In the Web UI (`资料整理`), Memoly places the exact source lines (`Lstart–Lend`) next to the drafted proposal.
3. **Create draft → Manual merge**:
   - Clicking **批准并写入 Vault** writes an immutable draft into `notes/` with `created`, `updated`, `status: inbox`, `tags: [memoly]`, and `sources: ["path#Lx-Ly"]`.
   - When consolidating into a permanent MOC or handbook, **you manually merge** verified takeaways from `notes/` into your canonical note—keeping full human authorship over long-term Vault structure.

---

## Pillar 4 · Cross-Agent Confirmed Memory & Small-Team Sync

### Portable Memory Discipline
- Keep memory entries **atomic and durable** (preferences, decision heuristics, post-mortem lessons) keyed by a stable identifier (`delivery-preference`, `repo-testing-rule`).
- Always verify newly submitted candidates in `个人记忆`, assign exact `readers` (`[codex]`, `[claude]`), and add expiry dates when temporary.
- Updating an active memory creates a pending correction (`expected_version`) without disturbing active reads until approved. Revoking an obsolete key cuts off all agents immediately.

### Small-Team Single-Operator Rhythm
1. **Vault Sync**: Share only the Vault folder across the team (via Git repo, Syncthing, iCloud, or shared drive).
2. **Single Operator**: One designated operator keeps `memoly serve` and `~/.memoly` (`sqlite` + `.key` files) locally on their workstation, acting as gatekeeper for chapter shares, maintenance approvals, and memory releases.
3. **Recommended Cadence**:
   - *Daily*: Use WorkBuddy / Codex for citation-grounded Q&A (`memoly-agent` skill).
   - *Weekly*: Let WorkBuddy's cron run `memoly-maintain`; spend 5 minutes in `127.0.0.1:8766` reviewing side-by-side proposals and pending memories.
   - *Monthly*: Prune expired memories (`个人记忆`) and revoke unused connectors or stale grants (`Agent 接入`).
