---
name: memoly-operator
description: 'Operate and maintain a Memoly Local Vault as a solo owner or single small-team administrator: structure folders, grant chapter access, configure recurring WorkBuddy feeds, review side-by-side proposals, merge drafts, and curate confirmed memories.'
---

# Memoly Local Operator Playbook (Personal & Single-Operator Small Team)

Use this methodology when setting up, administering, or upgrading a Vault backed by `memoly-local`:

## 1. Vault Boundary Hygiene
- Keep raw captures in `inbox/` or project folders; reserve an explicit subdirectory (e.g. `notes/` passed to `--write-root notes`) strictly for reviewed AI maintenance outputs.
- Notes with frontmatter `status` in `inbox`, `draft`, `archived`, or `superseded` are share-blocked for external `knowledge` reads until promoted—making them safe staging notes before publication, while `maintenance` feeds can still draft summaries from `inbox` or `_meta/`.
- Never place credentials or SQLite state inside the Vault. Always keep `--state` (default `~/.memoly`) outside `--vault` with `0700` permissions.
- Reserved private roots (`_archive/`, `memory/`, `outputs/`, `personal-ip/`) and reserved private filenames (`MEMORY.md`, `INBOX.md`, `HANDOFF.md`, `LOG.md`) are never shareable via `knowledge`.

## 2. Granular Connector & Chapter Governance
1. **Least-privilege connectors**: Create separate identities per host and job—never share credentials across clients:
   - `workbuddy`: `--scopes knowledge,memory:submit` (interactive Q&A + proposing preferences)
   - `workbuddy-maintenance`: `--scopes maintenance` (dedicated scheduled maintenance worker)
   - `codex` / `claude`: `--scopes knowledge,memory:read` (coding / research recall)
2. **Exact-heading, revision-pinned grants**: Every Markdown share binds `(client_id, path, heading, revision)`. Multiple sections of the same file can be granted independently. Editing a file immediately invalidates prior grants until the owner re-reviews and re-grants in the Web UI or CLI (`memoly share`).
3. **Instant revocation**: Fix typos cleanly (`unshare` errors `404` if nothing matched) or revoke an entire identity with `memoly connector revoke <id>`.

## 3. Maintenance Feeds & Controlled Output -> Manual Canonical Merge
- Configure recurring feeds with `memoly feed add <connector> <source.md> "<Exact Unique Heading>" <output_dir_inside_write_root>`.
- In the owner Web UI (`资料整理`), inspect **Original Excerpt vs Proposed Markdown** side by side:
  - Approved proposals create **new** immutable-input drafts inside `--write-root` (never overwriting canonical notes).
  - If the source section changed before approval, reject the stale card and let the next `feed` pass queue the updated revision.
  - **Canonical merge discipline**: After approving a draft in `notes/`, manually review and merge durable takeaways into your project/MOC notes in Obsidian or your editor, promoting note status when ready to share.

## 4. Confirmed Memory Lifecycle & Small-Team Single-Operator Sync
- Review pending memory candidates in `个人记忆`, explicitly selecting allowed `readers` and optional expiry date.
- When editing an active memory, supply `expected_version`; pending corrections never leak into external `read_memory` calls until approved.
- **Small teams (1 operator + shared folder)**: Sync **only** the Vault directory (via Git, Syncthing, or shared drive). Never sync `~/.memoly` SQLite or `.key` files—each operator owns local connector credentials and approval decisions.
