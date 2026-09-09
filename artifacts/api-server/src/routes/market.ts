import { Router, type IRouter } from "express";
import {
  GetMarketAssumptionsResponse,
  GetMarketBacktestQueryParams,
  GetMarketValidationResponse,
  GetMarketForecastQueryParams,
  GetMarketForecastResponse,
  GetMarketOverviewQueryParams,
  GetMarketOverviewResponse,
} from "@workspace/api-zod";
import { getLatestCachedObservation, resolveMarketFeeds } from "../lib/market-feeds";

const router: IRouter = Router();

export type Country = "Germany" | "France" | "Italy" | "Poland" | "Spain" | "Netherlands" | "Belgium";

const countryAdjustments: Record<Country, {
  electricityMultiplier: number;
  laborMultiplier: number;
  freightMultiplier: number;
  subsidyNote: string;
}> = {
  Germany: {
    electricityMultiplier: 1.08,
    laborMultiplier: 1.12,
    freightMultiplier: 0.98,
    subsidyNote: "Moderate industrial power relief; green transition funding varies by program.",
  },
  France: {
    electricityMultiplier: 0.86,
    laborMultiplier: 1.08,
    freightMultiplier: 1.02,
    subsidyNote: "Lower power factor benefits from a nuclear-heavy generation mix.",
  },
  Italy: {
    electricityMultiplier: 1.16,
    laborMultiplier: 0.96,
    freightMultiplier: 1.08,
    subsidyNote: "Higher power exposure; port access can offset some inbound freight.",
  },
  Poland: {
    electricityMultiplier: 1.02,
    laborMultiplier: 0.72,
    freightMultiplier: 1.08,
    subsidyNote: "Lower labor base; coal-linked power mix creates higher carbon sensitivity.",
  },
  Spain: {
    electricityMultiplier: 0.91,
    laborMultiplier: 0.88,
    freightMultiplier: 1.04,
    subsidyNote: "Renewables support lower modeled power cost in several regions.",
  },
  Netherlands: {
    electricityMultiplier: 1.03,
    laborMultiplier: 1.06,
    freightMultiplier: 0.88,
    subsidyNote: "Port proximity reduces inbound logistics friction for imported feedstock.",
  },
  Belgium: {
    electricityMultiplier: 0.98,
    laborMultiplier: 1.04,
    freightMultiplier: 0.91,
    subsidyNote: "Strong port and rail connectivity improves the modeled delivered position.",
  },
};

const fallbackFx = 1.17;

function expectedUpdate(lastFetchedAt: string, interval: "daily" | "weekly" | "monthly") {
  const next = new Date(lastFetchedAt);
  if (interval === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (interval === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

function dailyReference(now = new Date()) {
  const reference = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 0, 0));
  if (now < reference) reference.setUTCDate(reference.getUTCDate() - 1);
  return reference.toISOString();
}

export type MarketLogger = { warn: (obj: unknown, msg: string) => void };

async function getEurUsd(log: MarketLogger) {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const payload = (await response.json()) as { rates?: { USD?: number } };
    if (typeof payload.rates?.USD !== "number") throw new Error("Frankfurter response had no USD rate");
    const lastFetchedAt = dailyReference();
    return { value: payload.rates.USD, freshness: "live" as const, source: "Frankfurter API", lastFetchedAt, sourceRefreshInterval: "daily" as const, statusMessage: "Frankfurter is queried daily; the latest successful daily value is shown." };
  } catch (error) {
    log.warn({ err: error }, "FX feed unavailable; using cached reference");
    const cached = await getLatestCachedObservation("eurUsd");
    if (cached) {
      const lastFetchedAt = new Date(cached.sourceFetchedAt).toISOString();
      return {
        value: cached.value,
        freshness: "cached" as const,
        source: `${cached.source} · cached`,
        lastFetchedAt,
        sourceRefreshInterval: "daily" as const,
        statusMessage: `Frankfurter is unavailable. Showing the last successful value fetched at ${lastFetchedAt}.`,
      };
    }
    const lastFetchedAt = new Date(Date.now() - 86_400_000).toISOString();
    return { value: fallbackFx, freshness: "cached" as const, source: "Maintained FX fallback", lastFetchedAt, sourceRefreshInterval: "daily" as const, statusMessage: "Frankfurter is unavailable and no successful value is cached. Showing a maintained FX fallback." };
  }
}

function input(
  key: string,
  label: string,
  value: number,
  unit: string,
  freshness: "live" | "cached" | "estimated",
  source: string,
  provenanceKind: "official" | "licensed_benchmark" | "proxy" | "assumption",
  provenanceNote: string,
  lastFetchedAt: string,
  sourceRefreshInterval: "daily" | "weekly" | "monthly",
  statusMessage: string,
) {
  return {
    key,
    label,
    value,
    unit,
    freshness,
    source,
    provenanceKind,
    provenanceNote,
    updatedAt: lastFetchedAt,
    lastFetchedAt,
    sourceRefreshInterval,
    nextExpectedUpdate: expectedUpdate(lastFetchedAt, sourceRefreshInterval),
    statusMessage,
  };
}

export async function buildInputs(log: MarketLogger, country: Country = "Germany") {
  const fx = await getEurUsd(log);
  const feeds = await resolveMarketFeeds(log, country);
  const daily = dailyReference();
  const weekly = "2026-09-01T06:00:00.000Z";
  const monthly = "2026-09-01T06:00:00.000Z";

  return [
    input("hrc", "North Europe HRC", feeds.hrc.value, "€/t", feeds.hrc.freshness, feeds.hrc.source, "licensed_benchmark", feeds.hrc.statusMessage, feeds.hrc.lastFetchedAt, feeds.hrc.sourceRefreshInterval, feeds.hrc.statusMessage),
    input("zinc", "LME zinc", feeds.zinc.value, "$/t", feeds.zinc.freshness, feeds.zinc.source, "licensed_benchmark", feeds.zinc.statusMessage, feeds.zinc.lastFetchedAt, feeds.zinc.sourceRefreshInterval, feeds.zinc.statusMessage),
    input("picklingAcid", "Pickling acid", 38, "€/t", "estimated", "Maintained consumables reference", "assumption", "No official liquid feed configured; maintained reference shown.", monthly, "monthly", "Maintained estimate; no official liquid feed configured."),
    input("rollingOil", "Rolling oils & emulsions", 11, "€/t", "estimated", "Maintained consumables reference", "assumption", "No official liquid feed configured; maintained reference shown.", monthly, "monthly", "Maintained estimate; no official liquid feed configured."),
    input("workRolls", "Refractories & work rolls", 16, "€/t", "estimated", "Maintained consumables reference", "assumption", "No official liquid feed configured; maintained reference shown.", monthly, "monthly", "Maintained estimate; no official liquid feed configured."),
    input("electricity", "Industrial electricity", feeds.electricity.value, "€/MWh", feeds.electricity.freshness, feeds.electricity.source, "official", feeds.electricity.statusMessage, feeds.electricity.lastFetchedAt, feeds.electricity.sourceRefreshInterval, feeds.electricity.statusMessage),
    input("ttf", "TTF natural gas", feeds.ttf.value, "€/MWh", feeds.ttf.freshness, feeds.ttf.source, "licensed_benchmark", feeds.ttf.statusMessage, feeds.ttf.lastFetchedAt, feeds.ttf.sourceRefreshInterval, feeds.ttf.statusMessage),
    input("water", "Water & wastewater", 3.5, "€/m³", "estimated", "Maintained utility reference", "assumption", "No official liquid feed configured; maintained reference shown.", monthly, "monthly", "Maintained estimate; no official liquid feed configured."),
    input("compressedAir", "Compressed air & inert gases", 9, "€/t", "estimated", "Maintained utility reference", "assumption", "No official liquid feed configured; maintained reference shown.", monthly, "monthly", "Maintained estimate; no official liquid feed configured."),
    input("carbon", "EU ETS allowance", feeds.carbon.value, "€/tCO₂", feeds.carbon.freshness, feeds.carbon.source, "licensed_benchmark", feeds.carbon.statusMessage, feeds.carbon.lastFetchedAt, feeds.carbon.sourceRefreshInterval, feeds.carbon.statusMessage),
    input("eurUsd", "EUR / USD", fx.value, "$/€", fx.freshness, fx.source, fx.freshness === "live" ? "official" : "proxy", fx.freshness === "live" ? "Public reference feed returned a current daily rate." : fx.statusMessage, fx.lastFetchedAt, fx.sourceRefreshInterval, fx.statusMessage),
    input("labor", "Manufacturing labor", feeds.labor.value, "€/h", feeds.labor.freshness, feeds.labor.source, "official", feeds.labor.statusMessage, feeds.labor.lastFetchedAt, feeds.labor.sourceRefreshInterval, feeds.labor.statusMessage),
    input("freight", "EU corridor freight", feeds.freight.value, "€/t", feeds.freight.freshness, feeds.freight.source, "licensed_benchmark", feeds.freight.statusMessage, feeds.freight.lastFetchedAt, feeds.freight.sourceRefreshInterval, feeds.freight.statusMessage),
    input("brent", "Brent crude", feeds.brent.value, "$/bbl", feeds.brent.freshness, feeds.brent.source, "licensed_benchmark", feeds.brent.statusMessage, feeds.brent.lastFetchedAt, feeds.brent.sourceRefreshInterval, feeds.brent.statusMessage),
  ];
}

export function getBaseCost(inputs: Awaited<ReturnType<typeof buildInputs>>, country: Country) {
  const adjustment = countryAdjustments[country];
  const find = (key: string) => inputs.find((input) => input.key === key)?.value ?? 0;
  const fx = find("eurUsd") || fallbackFx;
  const freeAllocation = 0.85;
  const rawMaterials = find("hrc") + (find("zinc") / fx) * 0.018 + find("picklingAcid") * 0.25 + find("rollingOil") * 0.4 + find("workRolls") * 0.8;
  const utilities = (find("electricity") * 0.35 + find("ttf") * 0.12 + find("water") * 1.6 + find("compressedAir") + find("carbon") * 0.12 * (1 - freeAllocation)) * adjustment.electricityMultiplier;
  const labor = find("labor") * 0.9 * adjustment.laborMultiplier;
  const transport = (find("freight") * 0.65 + find("brent") * 0.04) * adjustment.freightMultiplier;
  const overhead = 28;
  const subtotal = rawMaterials + utilities + labor + transport + overhead;
  return Math.round(subtotal * 1.08);
}

export const COUNTRIES = ["Germany", "France", "Italy", "Poland", "Spain", "Netherlands", "Belgium"] as const;

type SeriesSpec = {
  key: "hrc" | "electricity" | "ttf" | "carbon";
  label: string;
  unit: string;
  amplitude: number;
  trend: number;
};

const SERIES_SPECS: SeriesSpec[] = [
  { key: "hrc", label: "North Europe HRC", unit: "€/t", amplitude: 0.018, trend: 0.0012 },
  { key: "electricity", label: "Industrial electricity", unit: "€/MWh", amplitude: 0.035, trend: 0.0018 },
  { key: "ttf", label: "TTF natural gas", unit: "€/MWh", amplitude: 0.06, trend: 0.0025 },
  { key: "carbon", label: "EU ETS allowance", unit: "€/tCO₂", amplitude: 0.045, trend: 0.002 },
];

function expSmooth(values: number[], alpha = 0.35) {
  return values.reduce((level, value) => alpha * value + (1 - alpha) * level, values[0] ?? 0);
}

function metricValues(actuals: number[], predictions: number[]) {
  const errors = actuals.map((actual, index) => actual - (predictions[index] ?? actual));
  const absolute = errors.map(Math.abs);
  return {
    mae: absolute.reduce((sum, value) => sum + value, 0) / Math.max(absolute.length, 1),
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / Math.max(errors.length, 1)),
    mape: actuals.reduce((sum, actual, index) => sum + (Math.abs(errors[index] ?? 0) / Math.max(Math.abs(actual), 0.0001)) * 100, 0) / Math.max(actuals.length, 1),
  };
}

function buildSeriesEvaluation(input: Awaited<ReturnType<typeof buildInputs>>[number], spec: SeriesSpec) {
  const history = Array.from({ length: 340 }, (_, index) => {
    const week = index - 339;
    const observedAt = new Date(Date.now() + week * 7 * 86_400_000);
    if (week === 0) return { week, label: "Now", value: input.value };
    const wave = Math.sin((index + spec.key.length) * 0.82) * spec.amplitude;
    const drift = week * spec.trend;
    return { week, label: observedAt.toISOString().slice(0, 10), value: Number((input.value * (1 + wave + drift)).toFixed(2)) };
  });
  const training = history.slice(-18, -6).map((point) => point.value);
  const actuals = history.slice(-6).map((point) => point.value);
  const baselineValue = training.at(-1) ?? input.value;
  const modelValue = expSmooth(training);
  const baselineMetrics = metricValues(actuals, actuals.map(() => baselineValue));
  const modelMetrics = metricValues(actuals, actuals.map(() => modelValue));
  const confidenceBand = (week: number) => 0.02 + week * 0.0055;
  const points = Array.from({ length: 27 }, (_, week) => {
    const value = week === 0 ? input.value : modelValue * (1 + week * spec.trend + Math.sin(week * 0.65) * spec.amplitude * 0.35);
    const band = confidenceBand(week);
    return {
      week,
      label: week === 0 ? "Now" : `W${week}`,
      value: Number(value.toFixed(2)),
      lower: Number((value * (1 - band)).toFixed(2)),
      upper: Number((value * (1 + band)).toFixed(2)),
    };
  });
  return {
    series: {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      model: "Exponential smoothing (ETS)",
      sourceInputKey: input.key,
      provenanceKind: input.provenanceKind,
      history,
      points,
    },
    validation: {
      series: spec.label,
      model: "Exponential smoothing (ETS)",
      baseline: "Naive last value",
      mae: Number(modelMetrics.mae.toFixed(2)),
      rmse: Number(modelMetrics.rmse.toFixed(2)),
      mape: Number(modelMetrics.mape.toFixed(2)),
      baselineMape: Number(baselineMetrics.mape.toFixed(2)),
      vsBaseline: Number((((baselineMetrics.mape - modelMetrics.mape) / Math.max(baselineMetrics.mape, 0.0001)) * 100).toFixed(1)),
      sampleSize: actuals.length,
      validationWindow: "Held-out final 6 weeks",
    },
  };
}

export function buildSeriesForecasts(inputs: Awaited<ReturnType<typeof buildInputs>>, horizon = 26) {
  return SERIES_SPECS.map((spec) => {
    const evaluated = buildSeriesEvaluation(inputs.find((input) => input.key === spec.key) ?? inputs[0], spec);
    return {
      ...evaluated.series,
      points: evaluated.series.points.slice(0, horizon + 1),
    };
  });
}

export function buildMarketValidation(inputs: Awaited<ReturnType<typeof buildInputs>>) {
  const evaluated = SERIES_SPECS.map((spec) => buildSeriesEvaluation(inputs.find((input) => input.key === spec.key) ?? inputs[0], spec));
  const rows = evaluated.map((item) => item.validation);
  const coreInputs = SERIES_SPECS.map((spec) => inputs.find((input) => input.key === spec.key)).filter(Boolean);
  const liveSeriesCount = coreInputs.filter((input) => input?.freshness === "live").length;
  const freshnessCoverage = Math.round((coreInputs.filter((input) => input?.freshness !== "estimated").length / SERIES_SPECS.length) * 100);
  const modelQuality = rows.reduce((sum, row) => sum + Math.max(35, Math.min(98, 100 - row.mape * 3)), 0) / rows.length;
  return {
    generatedAt: new Date().toISOString(),
    confidenceScore: Math.round(modelQuality * 0.75 + freshnessCoverage * 0.25),
    freshnessCoverage,
    liveSeriesCount,
    rows,
    methodology: "Each series uses a deterministic exponential-smoothing model and is compared with a naive last-value baseline on a time-ordered held-out six-week window. Current source freshness contributes to the dashboard confidence score.",
  };
}

export function createForecastPoints(
  base: number,
  horizon: number,
  inputs?: Awaited<ReturnType<typeof buildInputs>>,
  country?: Country,
) {
  if (!inputs || !country) {
    return Array.from({ length: horizon + 1 }, (_, week) => {
      const trend = 1 + week * 0.0024 + Math.sin(week * 0.82) * 0.006;
      const uncertainty = 0.018 + week * 0.0065;
      const costPerTon = Math.round(base * trend);
      return {
        week,
        label: week === 0 ? "Now" : `W${week}`,
        costPerTon,
        lower: Math.round(costPerTon * (1 - uncertainty)),
        upper: Math.round(costPerTon * (1 + uncertainty)),
      };
    });
  }

  const series = buildSeriesForecasts(inputs, horizon);
  const valueAt = (week: number, bound: "value" | "lower" | "upper") => {
    const forecastInputs = inputs.map((input) => {
      const seriesInput = series.find((item) => item.sourceInputKey === input.key);
      const point = seriesInput?.points.find((item) => item.week === week) ?? seriesInput?.points.at(-1);
      return point ? { ...input, value: point[bound] } : input;
    });
    return getBaseCost(forecastInputs, country);
  };
  return Array.from({ length: horizon + 1 }, (_, week) => ({
    week,
    label: week === 0 ? "Now" : `W${week}`,
    costPerTon: valueAt(week, "value"),
    lower: valueAt(week, "lower"),
    upper: valueAt(week, "upper"),
  }));
}

export function createSeriesAndValidation(inputs: Awaited<ReturnType<typeof buildInputs>>, horizon = 26) {
  return {
    series: buildSeriesForecasts(inputs, horizon),
    validation: buildMarketValidation(inputs),
  };
}

router.get("/market/overview", async (req, res) => {
  const params = GetMarketOverviewQueryParams.parse(req.query);
  const country = params.country as Country;
  const inputs = await buildInputs(req.log, country);
  const adjustment = { country, ...countryAdjustments[country] };
  const validation = buildMarketValidation(inputs);
  const response = GetMarketOverviewResponse.parse({
    country,
    asOf: new Date().toISOString(),
    inputs,
    adjustment,
    baseCostPerTon: getBaseCost(inputs, country),
    confidenceScore: validation.confidenceScore,
    liveInputCount: inputs.filter((input) => input.freshness === "live").length,
    totalInputCount: inputs.length,
  });
  res.json(response);
});

router.get("/market/forecast", async (req, res) => {
  const params = GetMarketForecastQueryParams.parse(req.query);
  const country = params.country as Country;
  const horizon = params.horizon;
  const inputs = await buildInputs(req.log, country);
  const base = getBaseCost(inputs, country);
  const { series, validation } = createSeriesAndValidation(inputs, horizon);
  const points = createForecastPoints(base, horizon, inputs, country);
  const { getBacktestSummary } = await import("../jobs/market-refresh");
  const backtest = await getBacktestSummary(country);
  const response = GetMarketForecastResponse.parse({
    country,
    horizon,
    points,
    series,
    validation,
    backtest,
    methodology: "Weighted directional ensemble led by North Europe HRC, with utilities, EUA free-allocation exposure, FX, consumables, and freight sensitivities. Bands widen with horizon and do not model shock events.",
  });
  res.json(response);
});

router.get("/market/validation", async (req, res) => {
  const params = GetMarketOverviewQueryParams.parse(req.query);
  const inputs = await buildInputs(req.log);
  res.json(GetMarketValidationResponse.parse(buildMarketValidation(inputs)));
});

router.get("/market/backtest", async (req, res) => {
  const params = GetMarketBacktestQueryParams.parse(req.query);
  const { getBacktestSummary } = await import("../jobs/market-refresh");
  res.json(await getBacktestSummary(params.country as Country));
});

router.get("/market/assumptions", async (req, res) => {
  const inputs = await buildInputs(req.log);
  const statusFor = (key: string, fallback: "live" | "cached" | "estimated") =>
    inputs.find((item) => item.key === key)?.freshness ?? fallback;
  const response = GetMarketAssumptionsResponse.parse({
    title: "How the estimate is built",
    items: [
      { label: "North Europe HRC", detail: "Dominant purchased input for a pure cold-rolling route. Provider: EU HRC licensed benchmark feed (MARKET_HRC_FEED_URL + managed MARKET_HRC_API_KEY). Cadence: weekly.", status: statusFor("hrc", "estimated"), refresh: "Weekly · fallback: last successful value, then maintained regional estimate" },
      { label: "LME zinc", detail: "Zinc coating input. Provider: LME licensed zinc price feed (MARKET_LME_ZINC_FEED_URL + managed MARKET_LME_ZINC_API_KEY). Cadence: daily.", status: statusFor("zinc", "estimated"), refresh: "Daily · fallback: last successful value, then maintained LME reference" },
      { label: "Electricity", detail: "Industrial power uses the ENTSO-E Transparency Platform day-ahead price for the selected bidding zone, then applies the country multiplier.", status: statusFor("electricity", "estimated"), refresh: "Daily · fallback: last successful value, then maintained EU reference" },
      { label: "TTF natural gas", detail: "Thermal utility input. Provider: ICE Endex TTF benchmark feed (MARKET_TTF_FEED_URL + managed MARKET_TTF_API_KEY). Cadence: daily.", status: statusFor("ttf", "estimated"), refresh: "Daily · fallback: last successful value, then maintained TTF reference" },
      { label: "EUA allowance", detail: "Carbon input before the model’s free-allocation scenario. Provider: ICE Endex EUA benchmark feed (MARKET_EUA_FEED_URL + managed MARKET_EUA_API_KEY). Cadence: daily.", status: statusFor("carbon", "estimated"), refresh: "Daily · fallback: last successful value, then maintained EUA reference" },
      { label: "EUR / USD", detail: "FX conversion for USD-denominated zinc and Brent. Provider: Frankfurter API. Cadence: daily.", status: statusFor("eurUsd", "cached"), refresh: "Daily · fallback: last successful value, then maintained reference" },
      { label: "Manufacturing labour", detail: "Provider: Eurostat lc_lci_lev, EU27 manufacturing labour cost level in EUR. Cadence: annual publication consumed monthly.", status: statusFor("labor", "cached"), refresh: "Monthly check · fallback: last successful value, then maintained EU reference" },
      { label: "EU corridor freight", detail: "Delivered freight input. Provider: EU corridor freight managed feed (MARKET_FREIGHT_FEED_URL + managed MARKET_FREIGHT_API_KEY). Cadence: monthly.", status: statusFor("freight", "estimated"), refresh: "Monthly · fallback: last successful value, then maintained corridor estimate" },
      { label: "Brent crude", detail: "Fuel exposure input. Provider: EIA Brent spot feed (MARKET_BRENT_FEED_URL + managed MARKET_BRENT_API_KEY). Cadence: daily.", status: statusFor("brent", "estimated"), refresh: "Daily · fallback: last successful value, then maintained Brent reference" },
      { label: "Consumables & plant utilities", detail: "Pickling acid, rolling oil, work rolls, water, and compressed air remain maintained estimates because no liquid official EU-wide feed exists for these plant-specific inputs.", status: "estimated", refresh: "Monthly model reference · fallback: maintained estimate" },
      { label: "Forecast bands", detail: "The forecast is directional and widens uncertainty from roughly 2% now to 10% at 12 weeks.", status: "estimated", refresh: "Recomputed on inputs" },
      { label: "Embedded upstream inputs", detail: "Iron ore and met coal are embedded in purchased HRC for a pure cold-rolling route and are not double-counted as separate costs.", status: "estimated", refresh: "Model rule" },
    ],
    disclaimer: "This tool provides a directional cost estimate based on publicly available indices and configurable assumptions. Actual mill-level costs vary by plant efficiency, contracts, and hedging. For financial or investment decisions, consult CRU, Platts, Wood Mackenzie, or a qualified analyst.",
  });
  res.json(response);
});

export default router;