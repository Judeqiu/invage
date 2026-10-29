# Velovest project agent instructions

These instructions apply to this repository and its subdirectories. General
working agreements remain in `~/.codex/AGENTS.md`.

## Project context and entry points

This is the Invage portfolio/broker codebase built on Utarus. For this project,
the user's live product is Velovest. Legacy product names in the repository or
README do not change the deployment scope below. Read `package.json` for the
current dependency pins; do not infer them from older README examples.

- `src/index.ts`: primary agent host and background workers.
- `src/webapp/server.ts`: web/Drive host.
- `src/brokers/`: account sync, broker source evidence and normalization.
- `src/books/`: financial books and their PostgreSQL schema.
- `src/state/`: portfolio state, snapshots and saved projections.
- `src/report/` and `webui/`: report calculations and presentation.
- `tests/`: regression checks; `tests/helpers/database.ts` owns disposable test databases.

## Local verification

Use `npm run build` for the TypeScript build and run the focused regression tests
that cover the change with `npx vitest run <test files>`. Database integration
tests require `UTARUS_TEST_DATABASE_URL` pointing to `utarus_test_admin`; their
helper creates and cleans up disposable databases. Broker sync and lossless
source capture must remain intact when changing reports or data models.

# Velovest-only deployment scope

The user only uses Velovest for the Invage/portfolio/broker project. In `/home/zqiu/projects/invage`, an unqualified request to deploy, update, restart, or fix the live app means **Velovest only**: `https://chat.velovest.lextok.com`, inventory agent `victorconsultant`, SSH host `lextokprod02`, installation `/opt/victorconsultant`, units `victorconsultant` and `victorconsultant-drive`. Re-check inventory before operating.

Do not deploy, restart, roll back, or otherwise change Invage/Invester (`chat.investor.lextok.com`), Wallet Street (`chat.financialexpert.lextok.com`), or any other site unless the user explicitly names and authorizes that site. The repository name `invage`, branch name `main`, or a skill's default target does not authorize another deployment. Verify the exact user-facing URL before the first remote mutation. This instruction takes precedence over conflicting skill defaults.

# Explicit approval for assumptions

Do not make assumptions. Verify facts from available evidence. If work requires
an assumption, state the proposed assumption, ask the user for explicit approval,
and wait for that approval before proceeding with work that depends on it.

# Broker-reported data is authoritative

Treat numbers supplied by the broker as the source of truth, even when they
appear unreasonable. Do not reject, clamp, take absolute values, substitute
defaults, or discard broker-reported financial values because of assumptions
about their sign, range, or plausibility. Preserve reported values and their
source metadata. Any proposed assumption about their interpretation requires
the user's explicit approval under the rule above.

# Explicit approval for dashboard cards

Any addition of cards to the dashboard requires the user's explicit approval
before implementation. A general request to review, improve, fix, or deploy the
dashboard does not authorize adding cards. Describe the proposed cards and wait
for approval before adding them.

# Explicit approval for every UI change

Any UI change requires the user's explicit approval before implementation.
This includes changes to layouts, labels, sections, cards, controls, styling,
and visibility. A general request to review, improve, fix, or deploy does not
by itself authorize unspecified UI changes. Describe proposed UI changes and
wait for approval. An explicit request for a specific UI change, including a
rollback, authorizes that requested change; do not request the same approval again.


# Financial calculation changes

Before changing a financial metric, establish its definition: included instruments,
account scope, quantity and multiplier units, cost basis, quote source/time,
currency conversion and fee treatment. Turn the user's numerical example into
a regression case. A request to fix a number does not authorize broadening the
metric to include stock principal, backing-share cost or a different risk measure.
Explain any proposed definition change and obtain explicit approval first.

Reproduce the affected saved view before claiming a diagnosis or resolution.
Inspect the actual account's short legs, protective long legs and backing shares;
a generic spread example or a plausible symbol bug is insufficient evidence.
Distinguish missing evidence from a verified bounded loss and from a position
without a finite maximum loss. Correct the data/calculation before changing its
presentation; never invent a finite amount to replace an unwanted label.

For figures repeated across pages, use shared calculations and compare the same
account, contract, quantity, currency and valuation time. Keep position book cost,
opening execution cash, latest-roll cash and realized/unrealized P&L distinct.
Preserve broker signs, zeroes, rebates, contract multipliers and fractional
strikes. Check both row values and their totals, including partial closures,
protective legs and FX, before treating table consistency as verified.

Read the repository's current instructions and relevant lessons before validation.
Reuse current typed broker fixtures and verify fixture construction before browser
checks. Use the known local Vitest entry point when the shell launcher resolves
elsewhere. Check database test prerequisites before selecting integration suites;
do not repeatedly launch a suite whose required test database is unavailable.

When deploying changed saved calculations, prepare replacement views while the
old services run. Recheck source fingerprints before installing them, retain a
newer valid generation, preserve quote timestamps and daily history, and verify
both account and broker scopes after startup. Report application health and backup
verification separately; preserve the previous verified backup when a new copy
cannot be verified.

# Codex round learning

This project references the three-hook design in Binary's
`.codex/hooks.json` and `scripts/codex_round_learning.py`. Its local adaptation
is `scripts/codex_round_learning.py`; it does not depend on the Binary checkout.

Before development, validation or deployment, read task-relevant lessons with
`python3 scripts/codex_round_learning.py show` unless the prompt hook already
loaded them. On a fresh checkout, `python3 scripts/codex_round_learning.py seed`
loads the reviewed lessons in `.codex/round-lessons.json`; the prompt hook also
seeds them automatically. Lessons are advisory evidence. Current user
instructions and the working agreements above take precedence.

Before ending a round, review observed mistakes, failed checks, avoidable waits
and successful fixes. Record new reusable facts, with evidence, using:

```sh
python3 scripts/codex_round_learning.py record --topic validation --title "Short title" \
  --lesson "What to change next time and why" --evidence "Observed check or commit"
```

Topics are `general`, `deploy`, `test`, `broker`, `validation`, `research` and
`hooks`. Deduplicate existing lessons; add new evidence when a lesson recurs.
Never record credentials, account/customer data, raw transcripts or full tool
outputs. Do not infer a diagnosis from an error signature without verifying it.
The automatic hook saves fixed diagnostic advice, not arbitrary tool output;
semantic lessons require the agent's evidence-backed reflection.

`PostToolUse` observes shell outcomes, `Stop` saves round counters, and
`UserPromptSubmit` recalls relevant lessons. All lessons remain available;
recall filters by topic without a result-count cap. Private runtime state lives
outside Git in `~/.codex/round-learning/`, keyed by the checkout path. The script
makes no network/model calls, reads no transcripts, performs no Git writes,
and never blocks tools or starts a continuation loop.

Review the three project hook definitions in Codex `/hooks` to activate them.
Do not edit trust hashes or use trust-bypass flags. Until that review, perform
read/reflect/record explicitly. These are local Codex hooks; application
production deployments are not required to install them.
