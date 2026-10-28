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
