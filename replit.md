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
- Cost anatomy showing modeled contributions from raw materials, energy, conversion/labor, and freight/other
- 1–12 week forecast with uncertainty bands and last-30-day forecast error
- Assumptions and methodology page with source freshness and accuracy disclaimer
- CSV forecast export

## User preferences

No standing preferences recorded.

## Gotchas

- API routes are mounted under `/api`; the frontend uses generated hooks rather than raw requests.
- Forecast and overview endpoints fall back to explicit cached or estimated values if the Frankfurter request is unavailable.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
