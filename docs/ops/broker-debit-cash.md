# Broker debit cash balances

Broker cash is signed by account and currency. A negative currency balance is a
broker debit, not missing data or an empty cash sleeve. Tiger, Moomoo, Webull,
IBKR Flex and generated CSV imports preserve finite negative balances and zeros.
Invalid numbers and incomplete position responses still fail the complete-snapshot
check, retaining the previous portfolio. Failure messages include the rejected rows.

Broker snapshots reconcile signed cash through balanced, source-linked journals.
Opening debits, positive-to-negative changes, repayment and zero crossings are
supported without a schema migration. Replaying an unchanged observation posts no
additional cash adjustment. State-save failure recovery reconciles against the
already-posted ledger balance. Initial state-to-books import also preserves debits.
The cash projection includes nonzero balances of either sign. Do not post a second
liability for the same debit: its credit cash balance already reduces net assets.

NAV includes each signed cash balance after conversion into the reporting
currency. A debit is subtracted, including when another currency has positive
cash. Missing FX must not produce a complete NAV that excludes the debit. Live
views retain the original currency balances; the dashboard shows debit currencies
and amounts alongside net cash, including in the compact V2 layout.

Trusted broker reconciliation can record a debit. Existing manual-operation
checks still prevent creating or increasing an overdraft; cash credits may repay
an existing debit even if it remains negative. Importing a debit does not authorize
borrowing or imply that the broker makes the net cash immediately withdrawable.

Automatic retry timing is owned by the durable retry scheduler. Notifications
state that a retry is queued rather than promising a fixed 30-minute interval.
Regular user sync frequency is unchanged.

Regression coverage: `broker-debit-cash.test.ts`, `dashboard-debit-cash.test.ts`,
broker parser tests and books ledger/pipeline tests. Use the dedicated test admin
database for integration tests; never run them against production.
