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

## Fetch, persistence and concurrency audit

History fetch failures are isolated before parsing as well as during merge.
The following paths retain their independently fetched current snapshot and
mark history deferred: Webull pagination, Tiger history and parent lookup,
MooMoo and Futubull Cloud fill/order history, IBKR yearly backfills, and the
OpenD Python bridge. OpenD emits its validated core before entering historical
queries; even a history timeout or later SDK exception can recover that core.
Partial Webull pages remain archived as evidence but are never parsed as a
complete history interval. A deferred history fetch or attachment-archive
failure does not advance the saved history checkpoint. The queued request
retains its original Full/incremental mode.

Live syncs reject malformed or unavailable current positions or cash before changing either
holdings or books. A failed Tiger position sleeve is recorded as unavailable,
rather than silently becoming evidence of zero holdings. Primary endpoint
failures therefore preserve the previous complete snapshot and remain retryable;
optional historical failures allow a complete supported current snapshot to save.
Documented nonblocking omissions retain their existing notices: IBKR negative
cash is outside the current books model, and MooMoo fund aggregates are retained
as account totals rather than fabricated itemized fund holdings. These do not
trigger endless retries or change the supported accounting representation.

The account API, scheduler and legacy connector/tool routes share these rules.
Known optimistic revision conflicts reload current state and reapply the same
retained response, at most three attempts, without repeating broker requests or
including unrelated concurrent edits in a stale write. An old failed attempt
cannot overwrite a more recent successful status. Successful persistence clears
its retry intent before notification generation.

A per-account kernel `flock` excludes overlapping app, Drive and operator
processes. Closing the process pipe releases the lock automatically, including
a crash. Runtime requires `flock` from util-linux (present on the production
Ubuntu host). A Full request arriving during another sync remains queued after
the older attempt completes. Other accounts can continue independently.

Regression checks cover injected 504s across HTTP brokers, primary failures,
partial pages, OpenD history failures/timeouts, unchanged checkpoints, concurrent
profile edits, stale failure statuses, cross-process exclusion and queued Full
requests. Snapshot timestamps describe when the current broker data was read,
rather than when a potentially long history backfill finished. Network, disk or
SQL outages can still delay completion; queued work is not reported as completed.

For rsync deployments, set the committed staging root to mode 0755 before
invoking canonical fast-deploy. Rsync copies that root mode to the installation,
which must remain traversable by the `velovest` service account.
