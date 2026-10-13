# Invage releases

Operator deploy runbooks (not marketing changelogs).

| Version | Date | Utarus pin | Summary |
|---------|------|------------|---------|
| [v0.3.20](./v0.3.20.md) | 2026-10-13 | `v4.2.8` | Section 03 starts on Open and retains selected tabs during refresh |
| [v0.3.19](./v0.3.19.md) | 2026-10-12 | `v4.2.8` | Responsive option timeline and dated price hover cards |
| [v0.3.18](./v0.3.18.md) | 2026-10-12 | `v4.2.8` | Normalize legacy position fallbacks in timeline stock groups |
| [v0.3.17](./v0.3.17.md) | 2026-10-12 | `v4.2.8` | Consistent stock symbols across broker option imports and retained history |
| [v0.3.16](./v0.3.16.md) | 2026-10-12 | `v4.2.8` | Collapsible stock summaries and unknown-history lead-ins in the option timeline |
| [v0.3.15](./v0.3.15.md) | 2026-10-12 | `v4.2.8` | Option activity timeline with a configurable dashboard default |
| [v0.3.14](./v0.3.14.md) | 2026-10-12 | `v4.2.8` | Idempotent option history imports and replay validation before ledger writes |
| [v0.3.10](./v0.3.10.md) | 2026-10-11 | `v4.2.3` | Foldable option roll relationships and generic agent queries with evidence and coverage |
| [v0.3.9](./v0.3.9.md) | 2026-10-10 | `v4.2.3` | Scope nested financial queries before expanding large account history |
| [v0.3.8](./v0.3.8.md) | 2026-10-10 | `v4.2.3` | Generic queries across financial state, accounting, valuations and broker archives |
| [v0.3.7](./v0.3.7.md) | 2026-10-10 | `v4.2.3` | Direct lookups, selective expert routing and batch option quotes |
| [v0.3.6](./v0.3.6.md) | 2026-10-10 | `v4.2.3` | Dated broker evidence, accuracy repairs, and discoverable read-only queries |
| [v0.3.5](./v0.3.5.md) | 2026-10-10 | `v4.2.3` | Dashboard chat sidebar and mobile full-screen discussions |
| [v0.3.4](./v0.3.4.md) | 2026-10-10 | `v4.0.2` | Contract discussions and restored broker opening fills |
| [v0.3.3](./v0.3.3.md) | 2026-10-09 | `v4.0.2` | Dashboard broker selector cleanup and MooMoo option metadata |
| [v0.3.2](./v0.3.2.md) | 2026-10-09 | `v4.0.2` | USD default for portfolio NAV and reporting-currency Settings |
| [v0.3.1](./v0.3.1.md) | 2026-08-09 | `v3.0.0-beta.14` | Channel format spine pin (flags default off) |
| [v0.3.0](./v0.3.0.md) | 2026-08-09 | `v3.0.0-beta.13` | Telegram connect + push; help-first async tasks |

Deploy always via:

```bash
~/.claude/skills/agent-ops/scripts/fast-deploy.sh invage --services=invage,invage-drive
```
