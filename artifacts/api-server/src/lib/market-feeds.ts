import { desc, eq } from "drizzle-orm";
import { db, marketObservationsTable } from "@workspace/db";
import type { Country, MarketLogger } from "../routes/market";

export type FeedCadence = "daily" | "weekly" | "monthly";
export type FeedFreshness = "live" | "cached" | "estimated";

export type ResolvedFeed = {
  value: number;
  freshness: FeedFreshness;
  source: string;
  lastFetchedAt: string;
  sourceRefreshInterval: FeedCadence;
  statusMessage: string;
};

type FeedSpec = {
  key: string;
  provider: string;
  cadence: FeedCadence;
  fallback: string;
  defaultValue: number;
  unit: string;
  urlEnv?: string;
  keyEnv?: string;
};

type RemoteValue = {
  value: number;
  timestamp: string;
  provider: string;
};

const feedSpecs: Record<string, FeedSpec> = {
  hrc: {
    key: "hrc",
    provider: "EU HRC licensed benchmark feed",
    cadence: "weekly",
    fallback: "Last successful provider value; then maintained regional estimate",
    defaultValue: 612,
    unit: "€/t",
    urlEnv: "MARKET_HRC_FEED_URL",
    keyEnv: "MARKET_HRC_API_KEY",
  },
  zinc: {
    key: "zinc",
    provider: "LME licensed zinc price feed",
    cadence: "daily",
    fallback: "Last successful provider value; then maintained LME reference",
    defaultValue: 2680,
    unit: "$/t",
    urlEnv: "MARKET_LME_ZINC_FEED_URL",
    keyEnv: "MARKET_LME_ZINC_API_KEY",
  },
  electricity: {
    key: "electricity",
    provider: "ENTSO-E Transparency Platform",
    cadence: "daily",
    fallback: "Last successful ENTSO-E day-ahead value; then maintained EU reference",
    defaultValue: 86,
    unit: "€/MWh",
    keyEnv: "ENTSOE_API_TOKEN",
  },
  ttf: {
    key: "ttf",
    provider: "ICE Endex TTF benchmark feed",
    cadence: "daily",
    fallback: "Last successful provider value; then maintained TTF reference",
    defaultValue: 34,
    unit: "€/MWh",
    urlEnv: "MARKET_TTF_FEED_URL",
    keyEnv: "MARKET_TTF_API_KEY",
  },
  carbon: {
    key: "carbon",
    provider: "ICE Endex EUA benchmark feed",
    cadence: "daily",
    fallback: "Last successful provider value; then maintained EUA reference",
    defaultValue: 84,
    unit: "€/tCO₂",
    urlEnv: "MARKET_EUA_FEED_URL",
    keyEnv: "MARKET_EUA_API_KEY",
  },
  labor: {
    key: "labor",
    provider: "Eurostat lc_lci_lev · manufacturing labour cost level",
    cadence: "monthly",
    fallback: "Last successful Eurostat value; then maintained EU manufacturing reference",
    defaultValue: 38.4,
    unit: "€/h",
  },
  freight: {
    key: "freight",
    provider: "EU corridor freight managed feed",
    cadence: "monthly",
    fallback: "Last successful provider value; then maintained EU corridor estimate",
    defaultValue: 42,
    unit: "€/t",
    urlEnv: "MARKET_FREIGHT_FEED_URL",
    keyEnv: "MARKET_FREIGHT_API_KEY",
  },
  brent: {
    key: "brent",
    provider: "EIA Brent spot feed",
    cadence: "daily",
    fallback: "Last successful provider value; then maintained Brent reference",
    defaultValue: 76,
    unit: "$/bbl",
    urlEnv: "MARKET_BRENT_FEED_URL",
    keyEnv: "MARKET_BRENT_API_KEY",
  },
};

export const MARKET_FEED_CATALOG = Object.values(feedSpecs);

const zones: Record<Country, string> = {
  Germany: "10Y1001A1001A82H",
  France: "10YFR-RTE------C",
  Italy: "10YIT-GRTN-----B",
  Poland: "10YPL-AREA-----S",
  Spain: "10YES-REE------0",
  Netherlands: "10YNL----------L",
  Belgium: "10YBE----------2",
};

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimestamp(value: unknown, fallback = new Date().toISOString()) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function findRemoteValue(payload: unknown): number | null {
  if (isValidNumber(payload)) return payload;
  if (Array.isArray(payload)) {
    for (const value of payload) {
      const found = findRemoteValue(value);
      if (found !== null) return found;
    }
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["value", "price", "last", "close", "settlement", "rate"]) {
    if (isValidNumber(record[key])) return record[key];
  }
  for (const value of Object.values(record)) {
    const found = findRemoteValue(value);
    if (found !== null) return found;
  }
  return null;
}

function findRemoteTimestamp(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return new Date().toISOString();
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["timestamp", "time", "date", "asOf", "updatedAt", "observedAt"]) {
    if (typeof record[key] === "string") return parseTimestamp(record[key]);
  }
  return new Date().toISOString();
}

async function fetchConfiguredFeed(spec: FeedSpec): Promise<RemoteValue | null> {
  if (!spec.urlEnv) return null;
  const url = process.env[spec.urlEnv];
  if (!url) return null;
  const headers: Record<string, string> = { accept: "application/json" };
  if (spec.keyEnv && process.env[spec.keyEnv]) {
    headers.authorization = `Bearer ${process.env[spec.keyEnv]}`;
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`${spec.provider} returned ${response.status}`);
  const payload = (await response.json()) as unknown;
  const value = findRemoteValue(payload);
  if (value === null) throw new Error(`${spec.provider} response contained no numeric value`);
  return {
    value,
    timestamp: findRemoteTimestamp(payload),
    provider: process.env[spec.key === "hrc" ? "MARKET_HRC_PROVIDER" : `MARKET_${spec.key.toUpperCase()}_PROVIDER`] ?? spec.provider,
  };
}

function entsoePeriodStart(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}0000`;
}

async function fetchEntsoe(country: Country): Promise<RemoteValue | null> {
  const token = process.env.ENTSOE_API_TOKEN;
  if (!token) return null;
  const periodStart = entsoePeriodStart();
  const periodEnd = `${periodStart.slice(0, 8)}2359`;
  const params = new URLSearchParams({
    documentType: "A44",
    in_Domain: zones[country],
    out_Domain: zones[country],
    periodStart,
    periodEnd,
    securityToken: token,
  });
  const response = await fetch(`https://web-api.tp.entsoe.eu/api?${params}`, {
    headers: { accept: "application/xml" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`ENTSO-E returned ${response.status}`);
  const xml = await response.text();
  const prices = [...xml.matchAll(/<price\.amount>([-+]?\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (!prices.length) throw new Error("ENTSO-E response contained no day-ahead prices");
  const value = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const start = xml.match(/<timeInterval>\s*<start>([^<]+)<\/start>/)?.[1];
  return {
    value: Number(value.toFixed(2)),
    timestamp: parseTimestamp(start),
    provider: "ENTSO-E Transparency Platform",
  };
}

async function fetchEurostatLabor(): Promise<RemoteValue> {
  const params = new URLSearchParams({
    format: "JSON",
    lang: "en",
    geo: "EU27_2020",
    lcstruct: "D1_D4_MD5",
    nace_r2: "C",
    unit: "EUR",
  });
  const response = await fetch(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/lc_lci_lev?${params}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Eurostat returned ${response.status}`);
  const payload = (await response.json()) as {
    value?: Record<string, number>;
    dimension?: { time?: { category?: { index?: Record<string, number> } } };
  };
  const values = payload.value ?? {};
  const timeIndex = payload.dimension?.time?.category?.index ?? {};
  const latest = Object.entries(timeIndex).sort(([, a], [, b]) => b - a)[0]?.[0];
  const index = latest === undefined ? undefined : timeIndex[latest];
  const value = index === undefined ? null : values[String(index)];
  if (!isValidNumber(value)) throw new Error("Eurostat response contained no manufacturing labour value");
  return {
    value,
    timestamp: parseTimestamp(latest ? `${latest}-12-31T00:00:00Z` : undefined),
    provider: "Eurostat lc_lci_lev",
  };
}

export async function getLatestCachedObservation(key: string) {
  try {
    return (await db
      .select()
      .from(marketObservationsTable)
      .where(eq(marketObservationsTable.inputKey, key))
      .orderBy(desc(marketObservationsTable.observedAt))
      .limit(1))[0];
  } catch {
    return undefined;
  }
}

async function resolveFeed(
  spec: FeedSpec,
  fetcher: () => Promise<RemoteValue | null>,
  log: MarketLogger,
): Promise<ResolvedFeed> {
  try {
    const remote = await fetcher();
    if (remote) {
      return {
        value: remote.value,
        freshness: "live",
        source: remote.provider,
        lastFetchedAt: remote.timestamp,
        sourceRefreshInterval: spec.cadence,
        statusMessage: "Latest successful value from the configured provider.",
      };
    }
  } catch (error) {
    log.warn({ err: error, source: spec.provider }, "Market feed unavailable; checking cached value");
  }

  const cached = await getLatestCachedObservation(spec.key);
  if (cached) {
    return {
      value: cached.value,
      freshness: "cached",
      source: `${cached.source} · cached`,
      lastFetchedAt: new Date(cached.sourceFetchedAt).toISOString(),
      sourceRefreshInterval: spec.cadence,
      statusMessage: `${spec.provider} is unavailable. Showing the last successful value fetched at ${new Date(cached.sourceFetchedAt).toISOString()}.`,
    };
  }

  return {
    value: spec.defaultValue,
    freshness: "estimated",
    source: `Maintained fallback · ${spec.provider}`,
    lastFetchedAt: new Date().toISOString(),
    sourceRefreshInterval: spec.cadence,
    statusMessage: `${spec.provider} is not configured or unavailable. Showing a maintained fallback until a successful source value is available.`,
  };
}

export async function resolveMarketFeeds(log: MarketLogger, country: Country) {
  const [hrc, zinc, electricity, ttf, carbon, labor, freight, brent] = await Promise.all([
    resolveFeed(feedSpecs.hrc, () => fetchConfiguredFeed(feedSpecs.hrc), log),
    resolveFeed(feedSpecs.zinc, () => fetchConfiguredFeed(feedSpecs.zinc), log),
    resolveFeed(feedSpecs.electricity, () => fetchEntsoe(country), log),
    resolveFeed(feedSpecs.ttf, () => fetchConfiguredFeed(feedSpecs.ttf), log),
    resolveFeed(feedSpecs.carbon, () => fetchConfiguredFeed(feedSpecs.carbon), log),
    resolveFeed(feedSpecs.labor, fetchEurostatLabor, log),
    resolveFeed(feedSpecs.freight, () => fetchConfiguredFeed(feedSpecs.freight), log),
    resolveFeed(feedSpecs.brent, () => fetchConfiguredFeed(feedSpecs.brent), log),
  ]);
  return { hrc, zinc, electricity, ttf, carbon, labor, freight, brent };
}