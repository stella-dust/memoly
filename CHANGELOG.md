# Changelog

## 0.3.1 · Review candidate

- Add local maintenance feeds. WorkBuddy can check named Markdown sections and submit a new draft when approved evidence changes. The owner still reviews the cited excerpt and decides whether to write to the Vault.
- Share multiple chapters independently with the same connector. Existing chapter grants migrate in place. Use returned headings and revisions for exact reads.
- Improve Chinese keyword retrieval and bound the parsed-note cache. Shared excerpts remain revision-checked before delivery.
- Show proposed Markdown beside its original lines. Surface stale memory versions before approval.
- Support new Markdown filenames in existing subdirectories of the configured write root, including CJK names. Persist the planned publish time so retries use consistent bytes. Creation and publication dates are recorded separately.
- Add the open-source landing page, release verification and contribution guides.

## 0.3.0 · 2026-11-22

- First installable Apache-2.0 release with a loopback workbench, CLI, and stdio MCP.
- Vault chapter sharing with file, line, and revision citations.
- Owner-reviewed maintenance proposals and personal memory shared across separate Agent identities.
