# Option positions and broker records

Use this skill when the user asks to connect or sync a broker, inspect option positions or fills, or reconcile option records. Keep records work separate from option pricing and strategy analysis, which belongs to OptionsExpert.

1. Read `get_portfolio` or the broker's sync result before stating a position, cost basis, or cash balance. Option lots are keyed by contract and broker channel. Preserve the option right, side, strike, expiry, quantity, and contract multiplier.
2. The option chain quotes premium per share. Book `avg_price` and `mark` are per contract. State the unit explicitly and do not apply the multiplier twice.
3. Current holdings are a snapshot, not execution history. Use the fill journal for fills. IBKR Flex Trades supplies option fills; other connectors may supply open lots without a fill journal. State that gap plainly.
4. For broker sync, load `broker-integration`. Catalog connectors are `ibkr`, `tiger`, `moomoo`, and `webull`. Quote `not_imported` rows and incomplete contracts. Never invent skipped positions or disclose credentials.
5. For reconciliation, use `start_recon`, `source_recon_channel`, `decide_recon_line`, and `apply_recon_channel`. Finish by checking `get_recon` for `next=done`. Compare each custody channel separately.
6. Cash is stored per channel and currency. Never set absolute cash. First recognition uses `post_opening_balance` with a source memo. Later differences use `post_adjustment` with a signed delta, memo, and contra account. Transfers use `transfer_cash`; holding trades use the holding tools with their cash adjustment when appropriate.
7. Verify every write with a read. Report confirmed changes and any unresolved positions or cash gaps. Do not infer assignment or exercise from a missing lot alone.
