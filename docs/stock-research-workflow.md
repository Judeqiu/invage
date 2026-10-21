# Velovest stock research reports

The `stock-research-report` catalog workflow turns a listed equity ticker into a private, standalone HTML company report. The report opens through the existing authenticated `/api/files/<filename>/view` link in the chat side panel. It does not need holdings, a broker connection or any account mutation.

## Research design

[CFA Institute’s Equity Research Report Essentials](https://www.cfainstitute.org/sites/default/files/-/media/documents/support/research-challenge/challenge/rc-equity-research-report-essentials.pdf) informs the report structure: business economics, competition, financial performance, valuation, a concise investment assessment and material risks. This implementation adds explicit data coverage and calculation methodology rather than asserting an unsupported price target.

[The SEC’s guide to reading 10-Ks and 10-Qs](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/how-read) informs the evidence hierarchy. Issuer filings and earnings releases establish reported financial results, business developments and risk factors. Quote-provider snapshots and analyst estimates have different dates and provenance; neither is presented as an audited filing. Research workers must read source pages rather than rely on search snippets.

[MSCI’s quality-index description](https://www.msci.com/indexes/group/quality-indexes) illustrates why profitability and leverage are distinct screening dimensions. Our four-factor peer screen is an original, disclosed heuristic. It does not reproduce MSCI’s methodology, ratings or investment performance.

## Input and execution

Call `list_workflows`, then `start_workflow` with:

```json
{"workflow_id":"stock-research-report","input":{"ticker":"MSFT","peers":["ORCL","SAP","ADBE","CRM"]}}
```

Peers are optional. A company researcher can propose up to six business peers; issuer classification, period coverage and complete metrics determine which can actually enter the quantitative screen. A business peer can remain useful context even when its provider industry differs and it cannot be ranked.

Three worker admissions are budgeted: company/source discovery, equity analysis and an independent evidence review. The host retrieves Yahoo quote/company data and up to five annual financial periods, computes the ranking, validates every claim’s source references and renders fixed HTML. Workers have only the framework’s read-only browser tools, not portfolio, accounting, report-writing or delegation tools. A rejected review, malformed response, cancellation or unresolved source reference prevents publication. This does not guarantee that a model reviewer catches every error; sources and coverage remain visible for user review.

The report includes business/competition, annual revenue and financial statements, valuation ratios, separate analyst consensus and targets, a peer comparison, catalysts and risks, source URLs, quote timestamps, reporting periods and evidence gaps. No DCF, quarterly table, scenario probability, options data or trade recommendation is manufactured from absent inputs.

## Peer screen v1

The composite uses four equally weighted factors: annual revenue growth, annual operating margin, annual debt/assets and positive trailing P/E. Higher growth/margin and lower leverage/multiple score better within the sample. These choices are a screening convention, not proof that a security is attractive.

All factors use one complete cohort of at least four companies including the target. Industry classifications must match exactly. Latest annual ends must be within 120 days of the target and no older than 550 days at collection. Revenue growth requires adjacent annual periods 330–400 days apart. Quote timestamps must be available and no more than seven days old. Banks, insurers, REITs and other specified financial industries are excluded because the generic balance-sheet/margin model is unsuitable. Non-positive earnings make the trailing P/E factor unavailable. Missing data never becomes zero. Excluded companies and reasons remain visible.

Each factor score is `100 × (other companies with worse values + half of other companies tied) / (N − 1)`. The composite is the mean of the four scores. Rank is one plus the count of strictly higher composites. All ties therefore receive 50/100 and joint rank 1. Scores are relative only to the named sample, not market-wide percentiles or predicted returns. No composite is produced when the target or sufficient peers fail coverage requirements.

Statement amounts retain provider financial-currency metadata; quote amounts retain quote currency. Cross-company currency amounts are not added. Source statement currency, accounting-standard differences and original filing dates still require issuer verification. The Yahoo client can omit some zero-valued history fields; absent values remain unavailable. Retrieval time does not establish quote freshness or financial publication time.

## Product wiring and validation

The workflow and report preset are registered only for the `consultant` product profile (Velovest). The host purpose routes full HTML equity research requests to this workflow, while ordinary lookups retain their direct tools. The host must supply the resulting durable link after completion rather than claiming publication from a text promise.

On the Velovest deployment only, enable `UTARUS_DYNAMIC_WORKFLOWS=true`; do not enable this on other product agents. No framework version change or database migration is required for the current pin. Any deployment must follow Agent Ops, use committed clean source and restart both `victorconsultant` and `victorconsultant-drive`. Confirm the runtime startup log, authenticated `GET /api/workflows` catalog entry and an actual generated report before claiming production operation.

Focused tests exercise provider failures, period exclusion, missing versus zero, rankings/ties, sector exclusions, strict owner-bound publication, fail-closed review, cancellation, HTML escaping and a real workflow-runtime/catalog-router integration. The latter boots the runtime with an isolated test owner and no model execution; it is not evidence of live provider or production model access.
