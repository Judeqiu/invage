# Broker-reported numeric values

Broker numbers are authoritative. Import does not reject or omit a number because
its sign, magnitude or apparent plausibility conflicts with an internal belief
about what a price, cost, balance, margin, fee or contract term should be.
Numeric formats and account/contract identity still need to be readable; missing
data is not replaced with an invented number. Conflicting source records remain
explicit conflicts rather than silently choosing one interpretation. Raw source
documents preserve every returned field independently of these projections.

The Fund assets card uses the selected account's reported aggregate fund value
when available, otherwise the saved market values of its normalized fund holdings.
All accounts shows the sum of those account contributions in the dashboard's
reporting currency, using that saved view's exchange rates. A reported aggregate
replaces the same account's itemized funds rather than adding to them. Holding
values already converted by the saved valuation are not converted again. The
card excludes cash, equity and option positions; it does not modify NAV, cost
basis, fees or P/L. Historical views use their saved holdings, never current
account totals.

Signed fund amounts and reported zeroes are preserved. Missing amounts or required
exchange rates remain unavailable. A combined available subtotal explicitly notes
when some accounts are unavailable; no available contributions produces a dash.
The same fund summary is used on Dashboard and Insights for every broker channel.

Current snapshots retain signed and zero costs, marks, share quantities, buying
power, maintenance margin, aggregate fund assets, cash and accrued interest.
Broker cost-validity flags remain in the source evidence; a supplied numeric cost
is not discarded merely because the flag is false. Finite contract terms are not
subject to positivity checks. Historical rows retain signed prices, proceeds,
fees and rebates, and reported zero fees are no longer classified as unknown
based on their date. The shared decimal parser has no arbitrary digit-count cap.
Broker-reported execution cash is retained even when historical contract size
is missing or a separately calculated amount differs. Missing contract metadata
does not make a directly reported cash amount unknown. Calculated cash is used
only when the response supplies no execution amount and the required factors
are available.

The following are documented representation conversions, not plausibility fixes:

- MooMoo/Tiger/Webull option prices per share become dollars per contract by
  multiplication with the supplied exact contract size. A negative cost keeps
  its sign. Missing size remains missing rather than assuming 100.
- Options use a contract count plus an explicit long/short side. Stock quantities
  are signed; an explicit broker SHORT side also identifies a short position
  when its reported quantity is a positive magnitude. Original quantities and
  side fields remain in source evidence.
- IBKR defines cost basis money as quantity multiplied by cost price. When money
  is supplied, its internal per-contract/per-unit cost is computed by division
  by the reported signed quantity, without an absolute-value operation. See
  [IBKR's Open Positions field reference](https://www.ibkrguides.com/reportingreference/reportguide/open%20positionsfq.htm).
- Parent order charges use the broker's reported sign. Allocated execution fee
  cash is the negative of that charge, including a positive cash effect for a
  negative reported charge. Allocation requires complete matching fill evidence;
  division by zero leaves allocation unknown and preserves the parent report.

The books support signed snapshot quantities and cost basis. A zero-cost position
posts its quantity change without fabricating a nonzero money amount or a zero
money counterpart. Repeated unchanged snapshots are idempotent, and subsequent
changes or closure reverse the actual stored signed balance and quantity.
Manual cash-changing trade operations retain their separate transaction rules;
those rules are not imposed on broker snapshots.

David's recorded SKHY November 20, 2026 $135 put demonstrates the original fault:
the broker supplied cost `-7.4400`, `cost_price_valid: true`, quantity `-1`, mark
`5.092`, and contract size `100`. The position imports with internal cost `-744`
and mark `509.2`. A read-only rehearsal imports all 14 positions in that archived
response. This code change does not itself update the live account or deploy a
release.
