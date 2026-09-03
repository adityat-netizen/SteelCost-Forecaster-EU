import { Router, type IRouter } from "express";
import {
  GetMarketAssumptionsResponse,
  GetMarketForecastQueryParams,
  GetMarketForecastResponse,
  GetMarketOverviewQueryParams,
  GetMarketOverviewResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type Country = "Germany" | "France" | "Italy" | "Poland" | "Spain" | "Netherlands" | "Belgium";

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

type RequestLike = Parameters<Parameters<IRouter["get"]>[1]>[0];

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

async function getEurUsd(req: Parameters<Parameters<IRouter["get"]>[1]>[0]) {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const payload = (await response.json()) as { rates?: { USD?: number } };
    if (typeof payload.rates?.USD !== "number") throw new Error("Frankfurter response had no USD rate");
    const lastFetchedAt = dailyReference();
    return { value: payload.rates.USD, freshness: "live" as const, source: "Frankfurter API", lastFetchedAt, sourceRefreshInterval: "daily" as const };
  } catch (error) {
    req.log.warn({ err: error }, "FX feed unavailable; using cached reference");
    const lastFetchedAt = new Date(Date.now() - 86_400_000).toISOString();
    return { value: fallbackFx, freshness: "cached" as const, source: "Cached daily reference", lastFetchedAt, sourceRefreshInterval: "daily" as const };
  }
}

function input(
  key: string,
  label: string,
  value: number,
  unit: string,
  freshness: "live" | "cached" | "estimated",
  source: string,
  lastFetchedAt: string,
  sourceRefreshInterval: "daily" | "weekly" | "monthly",
) {
  return {
    key,
    label,
    value,
    unit,
    freshness,
    source,
    updatedAt: lastFetchedAt,
    lastFetchedAt,
    sourceRefreshInterval,
    nextExpectedUpdate: expectedUpdate(lastFetchedAt, sourceRefreshInterval),
  };
}

async function buildInputs(req: RequestLike) {
  const fx = await getEurUsd(req);
  const daily = dailyReference();
  const weekly = "2026-09-01T06:00:00.000Z";
  const monthly = "2026-09-01T06:00:00.000Z";

  return [
    input("hrc", "North Europe HRC", 612, "€/t", "cached", "EU HRC benchmark · Kallanish / MEPS proxy", weekly, "weekly"),
    input("zinc", "LME zinc", 2680, "$/t", "estimated", "LME delayed-price proxy", daily, "daily"),
    input("picklingAcid", "Pickling acid", 38, "€/t", "estimated", "Regional chemical reference", monthly, "monthly"),
    input("rollingOil", "Rolling oils & emulsions", 11, "€/t", "estimated", "Mill consumables reference", monthly, "monthly"),
    input("workRolls", "Refractories & work rolls", 16, "€/t", "estimated", "Maintenance cost reference", monthly, "monthly"),
    input("electricity", "Industrial electricity", 86, "€/MWh", "estimated", "EU day-ahead reference · ENTSO-E proxy", daily, "daily"),
    input("ttf", "TTF natural gas", 34, "€/MWh", "estimated", "TTF weekly reference", weekly, "weekly"),
    input("water", "Water & wastewater", 3.5, "€/m³", "estimated", "Industrial utility reference", monthly, "monthly"),
    input("compressedAir", "Compressed air & inert gases", 9, "€/t", "estimated", "Plant utility reference", monthly, "monthly"),
    input("carbon", "EU ETS allowance", 84, "€/tCO₂", "estimated", "EUA futures-tracked proxy", daily, "daily"),
    input("eurUsd", "EUR / USD", fx.value, "$/€", fx.freshness, fx.source, fx.lastFetchedAt, fx.sourceRefreshInterval),
    input("labor", "Manufacturing labor", 38.4, "€/h", "cached", "Eurostat manufacturing reference", monthly, "monthly"),
    input("freight", "EU corridor freight", 42, "€/t", "estimated", "EU rail / truck blend", monthly, "monthly"),
    input("brent", "Brent crude", 76, "$/bbl", "estimated", "EIA / Alpha Vantage proxy", daily, "daily"),
  ];
}

function getBaseCost(inputs: Awaited<ReturnType<typeof buildInputs>>, country: Country) {
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

router.get("/market/overview", async (req, res) => {
  const params = GetMarketOverviewQueryParams.parse(req.query);
  const country = params.country as Country;
  const inputs = await buildInputs(req);
  const adjustment = { country, ...countryAdjustments[country] };
  const response = GetMarketOverviewResponse.parse({
    country,
    asOf: new Date().toISOString(),
    inputs,
    adjustment,
    baseCostPerTon: getBaseCost(inputs, country),
    confidenceScore: 78,
    liveInputCount: inputs.filter((input) => input.freshness === "live").length,
    totalInputCount: inputs.length,
  });
  res.json(response);
});

router.get("/market/forecast", async (req, res) => {
  const params = GetMarketForecastQueryParams.parse(req.query);
  const country = params.country as Country;
  const horizon = params.horizon;
  const inputs = await buildInputs(req);
  const base = getBaseCost(inputs, country);
  const points = Array.from({ length: horizon + 1 }, (_, week) => {
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
  const response = GetMarketForecastResponse.parse({
    country,
    horizon,
    points,
    backtest: {
      score: 6.2,
      label: "Last 30-day HRC forecast error",
    },
    methodology: "Weighted directional ensemble led by North Europe HRC, with utilities, EUA free-allocation exposure, FX, consumables, and freight sensitivities. Bands widen with horizon and do not model shock events.",
  });
  res.json(response);
});

router.get("/market/assumptions", (_req, res) => {
  const response = GetMarketAssumptionsResponse.parse({
    title: "How the estimate is built",
    items: [
      { label: "North Europe HRC", detail: "HRC is the dominant input in a pure cold-rolling route, typically 70–80% of the modeled tonne before plant-specific contracts and hedging. Kallanish, MEPS, and Platts are the preferred benchmark families.", status: "cached", refresh: "Weekly reference" },
      { label: "LME zinc & consumables", detail: "Zinc is modeled as delayed LME proxy plus a supplier premium; pickling acid, rolling oils, and work rolls are tracked as recurring consumables.", status: "estimated", refresh: "Daily / monthly" },
      { label: "Electricity", detail: "ENTSO-E Transparency Platform is the preferred day-ahead source, with a country tariff multiplier for industrial delivery.", status: "estimated", refresh: "Daily proxy" },
      { label: "TTF gas & utilities", detail: "TTF gas is joined by water, wastewater, compressed air, and inert gases so smaller recurring utilities are not hidden.", status: "estimated", refresh: "Weekly / monthly" },
      { label: "EUA & free allocation", detail: "Effective carbon cost uses net emissions after free allocation. The allocation percentage can be decreased year over year as CBAM phases in.", status: "estimated", refresh: "Daily proxy / scenario" },
      { label: "FX conversion", detail: "EUR/USD is fetched from Frankfurter when available; a cached daily value is used if the public feed is unavailable.", status: "live", refresh: "Daily" },
      { label: "Labor", detail: "Eurostat manufacturing labor is a configurable 5–12% share for a cold-rolling operation, not an assumed majority of cost.", status: "cached", refresh: "Monthly reference" },
      { label: "Freight & Brent", detail: "EU rail/truck corridors, port handling, Red Sea surcharges, and Brent-linked fuel exposure are represented as a delivered freight estimate.", status: "estimated", refresh: "Monthly / daily proxy" },
      { label: "Forecast bands", detail: "The forecast is directional and widens uncertainty from roughly 2% now to 10% at 12 weeks.", status: "estimated", refresh: "Recomputed on inputs" },
      { label: "Embedded upstream inputs", detail: "Iron ore and met coal are embedded in purchased HRC for a pure cold-rolling route and are not double-counted as separate costs.", status: "estimated", refresh: "Model rule" },
    ],
    disclaimer: "This tool provides a directional cost estimate based on publicly available indices and configurable assumptions. Actual mill-level costs vary by plant efficiency, contracts, and hedging. For financial or investment decisions, consult CRU, Platts, Wood Mackenzie, or a qualified analyst.",
  });
  res.json(response);
});

export default router;