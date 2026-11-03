# Velovest weekly credits

Velovest's consultant product profile grants every non-admin account 1,000 AI
credits each calendar week. The window starts Monday at 00:00 Asia/Singapore
(Sunday 16:00 UTC). Unused credits do not carry over. Admin accounts are exempt.

Settings → Credits shows the signed-in account's used credits, remaining allowance
and next reset. `/usage` uses the same weekly total. Existing token and tool rates
remain in `src/credit-rates.ts`; Management's saved rates retain precedence.

The framework's existing pre-turn, tool and post-charge gates enforce the limit,
including Incognito chat and scheduled runs. Charges are recorded after a model
call or tool finishes, so an operation already underway can exceed the allowance;
subsequent operations are blocked with a weekly reset message. Concurrent in-flight
operations use the same ledger but are not prepaid reservations. Existing framework
availability behavior remains: an unavailable credit store does not block chat.

Weekly spend sums immutable framework credit events by their recorded occurrence
times, across monthly boundaries. Monthly usage resets do not erase weekly spend;
monthly counters, lifetime totals and raw events remain intact. Historical migrated
opening balances have no event timestamps and are not assigned to a week.

The opt-in `billing.weeklyCreditLimit` configuration is local-account only, with
Stripe billing disabled. Velovest configures 1,000 credits, Monday (`weekStartsOn:1`)
and UTC+08:00 (`utcOffsetMinutes:480`). No other product profile enables it.
