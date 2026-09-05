# SteelCost Forecaster – EU Edition

An EU-focused cold-rolled steel cost forecaster that combines market benchmarks, country adjustments, editable assumptions, and transparent directional forecasts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/steelcost-forecaster/src/` — React dashboard, routed assumptions page, theme, and export interactions
- `artifacts/api-server/src/routes/market.ts` — market overview, forecast, and methodology endpoints
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract
- `lib/api-client-react/src/generated/` — generated React Query client hooks
- `lib/api-zod/src/generated/` — generated server validation schemas

## Architecture decisions

- Public FX data is fetched from Frankfurter when available; all other first-release benchmarks are labeled cached or estimated rather than presented as live.
- Forecasts are intentionally directional with widening uncertainty bands; the UI exposes backtest error instead of making a blanket accuracy promise.
- Scenario inputs are recomputed in the browser for immediate interaction while benchmark and forecast data come from the shared API server.
- Country adjustments are explicit multipliers for electricity, labor, and freight so EU differences stay inspectable.

## Product

- Dashboard for market snapshot, baseline cost per tonne, signal confidence, country selection, and editable scenario assumptions
- HRC-dominant cost anatomy with conversion materials, utilities/carbon, labor, logistics, and overhead/margin
- Inputs for zinc, pickling acid, rolling oils, work rolls, water/wastewater, compressed air/inert gases, EUA, free allocation, Brent, FX, and freight
- Independent HRC, electricity, TTF gas, and EUA history/forecast series with ETS model bands, plus a blended 26-week / six-month cost forecast
- Time-ordered held-out validation table with MAE, RMSE, MAPE, naive-baseline comparison, and confidence derivation
- Base / Stress / Severe market scenarios that shift the four forecast series independently
- Cost-anatomy sensitivity ranking for a fixed +10% movement in the four forecast drivers
- Editable plant operating parameters that recompute the cost layer without rerunning price forecasts
- Assumptions and methodology page with source freshness, embedded upstream-input rules, and accuracy disclaimer
- Session-aware live indicators with source, last fetched time, cadence, and next expected update
- Benchmark/proxy provenance labels on input cards, per-series CSV exports, blended CSV export, and print-to-PDF report

## User preferences

No standing preferences recorded.

## Gotchas

- API routes are mounted under `/api`; the frontend uses generated hooks rather than raw requests.
- Forecast and overview endpoints fall back to explicit cached or estimated values if the Frankfurter request is unavailable.
- Live indicators do not turn active because time passed; they require a newer source timestamp than the current session start.
- Forecast model scope intentionally excludes zinc, freight, FX, and other non-core assumptions from the independent price-series layer; those remain in the cost layer.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
