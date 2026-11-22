# Changelog

## 0.4.0 · 2026-11-22

- **Safe Stale Feed Lifecycle**: Dismissing a `proposed` maintenance card whose source file changed elsewhere no longer suppresses future feed runs (`stale_on_reject`), and newer feed revisions supersede obsolete `pending` feed tasks.
- **Fault-Tolerant & Starvation-Free Maintenance Queue**: Isolate per-feed read errors (invalid UTF-8, symlinks, missing files), filter stale manual `pending` tasks out of the 10-item `list_maintenance_jobs` batch, and attribute automated feed jobs cleanly to the worker connector in audit logs.
- **Stricter Grants, Output Validation & Multi-Chapter `explore_knowledge`**: `unshare` fails with 404 when no grant matches; `feed add` and `job add` share unified output-directory validation without leaking host paths; `explore_knowledge` retains all granted chapters of multi-chapter linked notes and preserves document titles in citations.
- **Chinese Search Parity**: Fix space-separated Chinese keyword segmentation across both Vault search (`search.js`) and `search_memory`, plus accurate folded-offset excerpts on long lines and trailing-whitespace heading trimming.
- **Owner Workbench Visibility**: Surface active recurring `feeds`, stale-pending source warnings, feed badges, multi-status (`draft`/`archived`/`superseded`) share guards, and full `client_name` + `revision` details in recent audit entries.
- **Skills, Methodology & Bilingual Docs**: Ship bundled `memoly-operator` skill alongside upgraded `memoly-agent` and `memoly-maintain` skills (`memoly skill list|path`), English + Chinese READMEs with architecture SVGs, dedicated multi-agent setup & methodology guides, and a redesigned bilingual landing page (`site/index.html`).

## 0.3.0 · 2026-11-22

- First installable Apache-2.0 release with a loopback workbench, CLI, and stdio MCP.
- Vault chapter sharing with file, line, and revision citations.
- Owner-reviewed maintenance proposals and personal memory shared across separate Agent identities.
