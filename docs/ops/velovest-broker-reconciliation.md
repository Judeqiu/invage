# Broker execution reconciliation and automatic recovery

Target: Velovest (`victorconsultant`), https://chat.velovest.lextok.com,
`lextokprod02:/opt/victorconsultant`, both agent and Drive units. Branch: `main`.
No framework or database schema upgrade is required.

The shared reconciler derives an option execution's opening/closing/mixed effect
from the account's broker position snapshots before and after the fills. It
uses exact decimal quantities and requires both endpoint balances to reconcile.
It excludes incomplete positions, missing transaction coverage, lifecycle
ambiguities, ambiguous timestamp ordering and daylight-saving changes. It never
assumes the historical starting position was zero. Explicit contradictory
effects and changed execution money remain conflicts. Unknown effects can be
enriched without downgrading a known effect; both history projections retain the
same validated effect.

Current positions and cash can save independently of historical enrichment.
An independently validated snapshot remains importable when optional history
cannot parse or reconcile. The original response stays archived, deferred
history is logged, and its checkpoint does not advance. Account identity and
current snapshot validation remain mandatory.

Each account sync records an fsynced intent in `data/broker-sync-retries` before
network or SQL work. No credentials are stored there. Failed work retries with
backoff from 30 seconds to 15 minutes on the minute scheduler, including when
PostgreSQL cannot load the account. An interrupted process's intent is recovered
after its PID disappears; a six-hour lease prevents immediate replay of long-running work. Full-history
requests survive retries. Pause, deletion or rebinding cancels obsolete work.
The API returns HTTP 202 for an accepted durable retry, and Settings displays
Retrying. Completion is reported only after data is saved. Each broker HTTP
request has a 45-second abort signal; paginated imports retain their normal
per-page pacing.

To reconcile retained evidence for any supported account, run with the complete
service environment:

```
node --import tsx scripts/reconcile-broker-effects.mjs <user> <connection>
node --import tsx scripts/reconcile-broker-effects.mjs <user> <connection> --apply
```

The default reports without writing. Apply captures the previous state and an
archive SHA-256 manifest in `data/ops/broker-reconciliation/<id>`, checks the
optimistic database revision, saves classifications and archived observations,
and leaves cash and holdings alone. It processes every contract rather than
special-casing a trade ID. Invalid/non-broker archives are reported separately.

The Victor evidence rehearsal establishes the October 6 NVDA roll's November
$235 buy as closing and January $245 sale as opening, plus four other fills.
Other historical classifications remain unresolved where the retained broker
evidence cannot substantiate them. Retrying preserves a request; it does not
create absent facts or guarantee completion during a permanent broker, disk or
database outage.
