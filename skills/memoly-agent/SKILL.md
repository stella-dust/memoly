---
name: memoly-agent
description: 'Retrieve explicitly shared Memoly Vault evidence and active personal memory, or propose a memory the owner has asked to retain. Use for citation-grounded Memoly queries and cross-agent recall.'
---

# Query evidence and propose memory

- For Vault questions, use `search_knowledge` and then `read_knowledge` with the returned document ID, heading, and revision. Cite the relative file, heading, line range and revision. If the response has no evidence, say which question remains unresolved.
- For a known memory key, call `read_memory` in the current turn. Apply the returned record only within its stated context. Track the returned version and report unavailable if the current call returns no record.
- When the user asks to retain a preference or decision, call `submit_memory` with a stable key, a concise statement and enough context to review it. Keep account information and unrelated conversation out. A candidate is pending until the owner approves in Memoly. For correction use the active record’s `version` as `expected_version` and let the owner approve the replacement.
