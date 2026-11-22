---
name: memoly-agent
description: 'Retrieve explicitly shared Memoly Vault evidence and active personal memory, or propose a memory candidate for owner confirmation. Use for citation-grounded Memoly Q&A and cross-agent recall across Codex, Claude Code, Cursor, and WorkBuddy.'
---

# Query Grounded Evidence & Manage Cross-Agent Memory

## 1. Evidence-First Knowledge Retrieval
1. Call `search_knowledge` with focused Chinese or English keywords. Use spaces between distinct Chinese concepts so Memoly scores each term separately.
2. When `search_knowledge` returns hits, call `read_knowledge` with the exact returned `document_id`, `heading`, and `revision` to inspect the full authorized section before answering.
3. Optional graph hop: call `explore_knowledge` with `document_id` to follow `[[WikiLinks]]` into other **currently granted** sections. Never assume unreturned notes or headings exist.
4. Always cite the exact `document_id` (relative path), `heading`, line range (`L<start>-L<end>`), and `revision` in your response.
5. If any tool returns `no_evidence` or `not_found_or_unavailable`, report that no verified evidence is available in the granted scope—never fabricate, extrapolate, or retry hidden paths (`MEMORY.md`, `_archive/`, unshared headings).

## 2. Cross-Agent Confirmed Memory
1. Call `read_memory` (exact `key`) or `search_memory` (topic keywords) in the **current turn** whenever user preferences, recurring conventions, or prior verified decisions apply. Apply a record strictly within its stated `context`.
2. Track the returned `version`. If `read_memory` returns `not_found_or_unavailable` or `search_memory` returns `no_evidence`, treat that memory as inactive/revoked and do not rely on earlier conversation state.
3. When the user explicitly asks to remember or correct a preference, decision, lesson, or feedback:
   - Use a stable lowercase `key` matching `^[a-z0-9][a-z0-9._-]{0,95}$`.
   - Keep `statement` self-contained, short, and free of secrets or transient chat chatter.
   - Populate `context` and `source`, and for edits set `expected_version` to the active record's current `version`.
   - Inform the user that the candidate is `pending` and only becomes readable after owner approval in the Memoly Web UI (`http://127.0.0.1:8766`).
