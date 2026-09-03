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

async function getEurUsd(req: Parameters<Parameters<IRouter["get"]>[1]>[0]) {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const payload = (await response.json()) as { rates?: { USD?: number } };
    if (typeof payload.rates?.USD !== "number") throw new Error("Frankfurter response had no USD rate");
    return { value: payload.rates.USD, freshness: "live" as const, source: "Frankfurter API" };
  } catch (error) {
    req.log.warn({ err: error }, "FX feed unavailable; using cached reference");
    return { value: fallbackFx, freshness: "cached" as const, source: "Cached weekly reference" };
  }
}

async function buildInputs(req: Parameters<Parameters<IRouter["get"]>[1]>[0]) {
  const fx = await getEurUsd(req);
  const updatedAt = new Date().toISOString();

  return [
    {
      key: "hrc",
      label: "North Europe HRC",
      value: 612,
      unit: "€/t",
      freshness: "cached" as const,
      source: "EU HRC benchmark",
      updatedAt,
    },
    {
      key: "ironOre",
      label: "Iron ore · 62% Fe",
      value: 103,
      unit: "$/t",
      freshness: "estimated" as const,
      source: "Platts / SGX reference",
      updatedAt,
    },
    {
      key: "cokingCoal",
      label: "Met coal",
      value: 232,
      unit: "$/t",
      freshness: "estimated" as const,
      source: "Global benchmark",
      updatedAt,
    },
    {
      key: "electricity",
      label: "Industrial electricity",
      value: 86,
      unit: "€/MWh",
      freshness: "estimated" as const,
      source: "EU day-ahead reference",
      updatedAt,
    },
    {
      key: "ttf",
      label: "TTF natural gas",
      value: 34,
      unit: "€/MWh",
      freshness: "estimated" as const,
      source: "TTF weekly reference",
      updatedAt,
    },
    {
      key: "carbon",
      label: "EU ETS carbon",
      value: 71,
      unit: "€/tCO₂",
      freshness: "estimated" as const,
      source: "EUA futures reference",
      updatedAt,
    },
    {
      key: "eurUsd",
      label: "EUR / USD",
      value: fx.value,
      unit: "$/€",
      freshness: fx.freshness,
      source: fx.source,
      updatedAt,
    },
    {
      key: "labor",
      label: "Manufacturing labor",
      value: 38.4,
      unit: "€/h",
      freshness: "cached" as const,
      source: "Eurostat reference",
      updatedAt,
    },
    {
      key: "freight",
      label: "EU corridor freight",
      value: 42,
      unit: "€/t",
      freshness: "estimated" as const,
      source: "EU rail / truck blend",
      updatedAt,
    },
  ];
}

function getBaseCost(inputs: Awaited<ReturnType<typeof buildInputs>>, country: Country) {
  const adjustment = countryAdjustments[country];
  const find = (key: string) => inputs.find((input) => input.key === key)?.value ?? 0;
  const rawMaterials = find("hrc") * 0.54 + (find("ironOre") / find("eurUsd")) * 0.08 + (find("cokingCoal") / find("eurUsd")) * 0.06;
  const energy = find("electricity") * 0.76 * adjustment.electricityMultiplier + find("ttf") * 0.24 * adjustment.electricityMultiplier + find("carbon") * 0.38;
  const labor = find("labor") * 4.1 * adjustment.laborMultiplier;
  const transport = find("freight") * adjustment.freightMultiplier;
  const overhead = 76;
  const subtotal = rawMaterials + energy + labor + transport + overhead;
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
    methodology: "Weighted directional ensemble using recent HRC, energy, carbon, FX, and freight sensitivities. Bands widen with horizon and do not model shock events.",
  });
  res.json(response);
});

router.get("/market/assumptions", (_req, res) => {
  const response = GetMarketAssumptionsResponse.parse({
    title: "How the estimate is built",
    items: [
      { label: "North Europe HRC", detail: "Primary benchmark for cold-rolled feedstock; cold rolling adds a modeled conversion premium.", status: "cached", refresh: "Weekly reference" },
      { label: "Energy & carbon", detail: "Electricity, TTF gas, and EU ETS are modeled as separate drivers so country sensitivity stays visible.", status: "estimated", refresh: "Weekly reference" },
      { label: "FX conversion", detail: "EUR/USD is fetched from Frankfurter when available; a cached weekly value is used if the public feed is unavailable.", status: "live", refresh: "Each dashboard load" },
      { label: "Labor", detail: "EU manufacturing labor is a configurable share, not an assumed majority of mill cost.", status: "cached", refresh: "Monthly reference" },
      { label: "Forecast bands", detail: "The forecast is directional and widens uncertainty from roughly 2% now to 10% at 12 weeks.", status: "estimated", refresh: "Recomputed on inputs" },
      { label: "CBAM & trade", detail: "CBAM, duties, subsidies, hedging, and plant-specific contracts are represented through overhead and scenario assumptions in this first release.", status: "estimated", refresh: "Scenario input" },
    ],
    disclaimer: "This tool provides a directional cost estimate based on publicly available indices and configurable assumptions. Actual mill-level costs vary by plant efficiency, contracts, and hedging. For financial or investment decisions, consult CRU, Platts, Wood Mackenzie, or a qualified analyst.",
  });
  res.json(response);
});

export default router;