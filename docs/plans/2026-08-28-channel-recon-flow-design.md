# Channel recon flow

**Date:** 2026-08-28  
**Owner:** Bookkeeper  
**Status:** locked (user confirmed table + decisions)

## What it is

A **channel recon session**: walk every custody sleeve, load the statement, compare to the books, then journal **only** the lines the user took.

`channel` = broker/custody tag on cash / lots / FDs (`ibkr`, `jude_futu`, unassigned). Not Telegram/Slack/Web.

## Locked decisions

| Decision | Choice |
|---|---|
| Snapshot | Cash by `(channel, currency)` + lots + FDs |
| Writes | Per-line `keep` / `take` / `skip` |
| Driver | Bookkeeper recon-session tools (completeness = session state) |
| Sleeves | Every channel on cash/lots/FDs **plus** enabled catalog connectors |
| Cash writes | `post_opening_balance` / `post_adjustment` only — never `set_cash` |
| Connector already-have | Fetch statement into the session **this turn**; do **not** `applyBrokerStatement` (that would wipe the compare) |

## Flow

| Step | Why | After | Skip vs already-have |
|---|---|---|---|
| 1. `start_recon` | Need `as_of` + sleeve list | First pending sleeve. Zero sleeves → pass `channel` or enable a connector | Not skippable |
| 2. Source | Need the statement | Connector enabled → fetch now. Else paste. Then compare | Already-have Flex: fetch, do not re-ask. Skip = postpone sleeve |
| 3. Compare | Show disagreements | Matching lines auto-`keep`. Mismatches need decide | Cannot skip compare |
| 4. Apply | Write taken lines only | Cash = signed journal. Lots/FDs = chosen lines, `adjust_cash=false`. Next sleeve | Not skippable after a `take` |
| 5. Next | Walk until every sleeve is applied or skipped | | Postpone is skip of that sleeve |
| 6. Done | Wrap-up only here | | |

## Session (user YAML `recon`)

```yaml
recon:
  as_of: "2026-08-28"
  status: in_progress   # in_progress | done
  current_channel: ibkr # "" = unassigned
  sleeves:
    - channel: ibkr
      status: pending   # pending | sourced | compared | applied | skipped
      source: connector # connector | paste
      statement: { cash: [], lots: [], deposits: [] }
      lines: []
```

Unknown recon fields fail on read. Missing `recon` = no session.

## Tools (Bookkeeper only)

| Tool | Does |
|---|---|
| `start_recon` | Open session (`restart` required if one is in progress) |
| `get_recon` | Current sleeve, next action, open lines |
| `source_recon_channel` | Connector fetch **or** pasted statement; then compare |
| `decide_recon_line` | `keep` / `take` / `skip` on one mismatch |
| `apply_recon_channel` | Persist taken lines; advance |
| `skip_recon_channel` | Postpone this sleeve |

No keyword router. Completeness is `recon.status === done` (every sleeve applied or skipped), never an assistant sentence.

## Hard rules

- No invented numbers; missing statement field ≠ 0.
- No silent FX.
- Exact numeric equality (no epsilon).
- Matching lines auto-`keep`; all-match sleeve auto-applies.
- Cash `take` requires books DB.
- Do not remount collect after a successful source this session.
