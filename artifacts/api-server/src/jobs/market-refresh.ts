import { and, asc, eq, gte, isNull, isNotNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  forecastSnapshotsTable,
  marketObservationsTable,
  type ForecastSnapshot,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  COUNTRIES,
  buildInputs,
  createForecastPoints,
  getBaseCost,
  type Country,
} from "../routes/market";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const BACKTEST_WINDOWS = [30, 90] as const;

type BacktestWindow = {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  observationCount: number;
  meanAbsolutePercentageError: number | null;
  medianAbsolutePercentageError: number | null;
  bandCoveragePercent: number | null;
  status: "ready" | "insufficient";
};

export type MarketBacktest = {
  generatedAt: string;
  sampleWindow: string;
  observationCount: number;
  rolling30: BacktestWindow;
  rolling90: BacktestWindow;
  errorBandMethodology: string;
};

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function emptyWindow(windowDays: number, now: Date): BacktestWindow {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - windowDays);
  return {
    windowDays,
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
    observationCount: 0,
    meanAbsolutePercentageError: null,
    medianAbsolutePercentageError: null,
    bandCoveragePercent: null,
    status: "insufficient",
  };
}

async function resolveMaturedSnapshots(now: Date) {
  const pending = await db
    .select()
    .from(forecastSnapshotsTable)
    .where(
      and(
        isNull(forecastSnapshotsTable.actualCostPerTon),
        lte(forecastSnapshotsTable.targetDate, now),
      ),
    )
    .orderBy(asc(forecastSnapshotsTable.targetDate));

  if (!pending.length) return 0;

  const observations = await db.select().from(marketObservationsTable);
  const currentInputs = await buildInputs(logger);
  let resolved = 0;

  for (const snapshot of pending) {
    const targetDate = asDate(snapshot.targetDate);
    const valuesByKey = new Map<string, number>();

    for (const input of currentInputs) {
      const matching = observations
        .filter(
          (observation) =>
            observation.inputKey === input.key &&
            asDate(observation.observedAt).getTime() <= targetDate.getTime(),
        )
        .sort(
          (a, b) =>
            asDate(b.observedAt).getTime() - asDate(a.observedAt).getTime(),
        )[0];
      if (matching) valuesByKey.set(input.key, matching.value);
    }

    if (valuesByKey.size < currentInputs.length) continue;

    const actualInputs = currentInputs.map((input) => ({
      ...input,
      value: valuesByKey.get(input.key) ?? input.value,
    }));
    const actualCost = getBaseCost(actualInputs, snapshot.country as Country);
    const absoluteError = Math.abs(actualCost - snapshot.predictedCostPerTon);
    const percentageError = actualCost
      ? (absoluteError / actualCost) * 100
      : null;

    await db
      .update(forecastSnapshotsTable)
      .set({
        actualCostPerTon: actualCost,
        absoluteError,
        percentageError,
        withinBand:
          actualCost >= snapshot.lowerBound && actualCost <= snapshot.upperBound,
      })
      .where(eq(forecastSnapshotsTable.id, snapshot.id));
    resolved += 1;
  }

  return resolved;
}

async function storeRefresh(now: Date) {
  const inputs = await buildInputs(logger);
  const runAt = now;

  await db.transaction(async (tx) => {
    for (const input of inputs) {
      await tx
        .insert(marketObservationsTable)
        .values({
          inputKey: input.key,
          observedAt: new Date(input.lastFetchedAt),
          value: input.value,
          unit: input.unit,
          source: input.source,
          freshness: input.freshness,
          sourceFetchedAt: new Date(input.lastFetchedAt),
        })
        .onConflictDoUpdate({
          target: [
            marketObservationsTable.inputKey,
            marketObservationsTable.observedAt,
          ],
          set: {
            value: input.value,
            source: input.source,
            freshness: input.freshness,
            sourceFetchedAt: new Date(input.lastFetchedAt),
          },
        });
    }

    for (const country of COUNTRIES) {
      const base = getBaseCost(inputs, country);
      const points = createForecastPoints(base, 12);
      for (const point of points.filter((forecastPoint) => forecastPoint.week > 0)) {
        const targetDate = new Date(runAt);
        targetDate.setUTCDate(targetDate.getUTCDate() + point.week * 7);
        await tx
          .insert(forecastSnapshotsTable)
          .values({
            country,
            runAt,
            targetDate,
            horizonWeeks: point.week,
            predictedCostPerTon: point.costPerTon,
            lowerBound: point.lower,
            upperBound: point.upper,
          })
          .onConflictDoNothing({
            target: [
              forecastSnapshotsTable.country,
              forecastSnapshotsTable.runAt,
              forecastSnapshotsTable.targetDate,
            ],
          });
      }
    }
  });

  return resolveMaturedSnapshots(now);
}

export async function refreshMarketHistory() {
  const startedAt = new Date();
  try {
    const resolved = await storeRefresh(startedAt);
    logger.info({ resolved, runAt: startedAt.toISOString() }, "Market history refreshed");
  } catch (error) {
    logger.error({ err: error }, "Market history refresh failed");
  }
}

export async function getBacktestSummary(
  country: Country,
  now = new Date(),
): Promise<MarketBacktest> {
  const windows = await Promise.all(
    BACKTEST_WINDOWS.map(async (windowDays) => {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - windowDays);
      const rows = await db
        .select({
          percentageError: forecastSnapshotsTable.percentageError,
          withinBand: forecastSnapshotsTable.withinBand,
        })
        .from(forecastSnapshotsTable)
        .where(
          and(
            eq(forecastSnapshotsTable.country, country),
            gte(forecastSnapshotsTable.targetDate, start),
            lte(forecastSnapshotsTable.targetDate, now),
            isNotNull(forecastSnapshotsTable.actualCostPerTon),
            isNotNull(forecastSnapshotsTable.percentageError),
          ),
        );
      const errors = rows
        .map((row) => row.percentageError)
        .filter((value): value is number => value !== null);
      const mean =
        errors.length > 0
          ? errors.reduce((sum, value) => sum + value, 0) / errors.length
          : null;
      const coverage =
        rows.length > 0
          ? (rows.filter((row) => row.withinBand === true).length / rows.length) * 100
          : null;
      return {
        ...emptyWindow(windowDays, now),
        observationCount: rows.length,
        meanAbsolutePercentageError:
          mean === null ? null : Number(mean.toFixed(2)),
        medianAbsolutePercentageError:
          median(errors) === null ? null : Number(median(errors)!.toFixed(2)),
        bandCoveragePercent:
          coverage === null ? null : Number(coverage.toFixed(1)),
        status: errors.length >= 3 ? ("ready" as const) : ("insufficient" as const),
      };
    }),
  );

  const [rolling30, rolling90] = windows;
  return {
    generatedAt: now.toISOString(),
    sampleWindow: "Rolling target dates; only matured forecasts with complete source observations are included.",
    observationCount: rolling90.observationCount,
    rolling30,
    rolling90,
    errorBandMethodology:
      "Mean and median absolute percentage error (|forecast − actual| ÷ actual) are calculated on matured forecast snapshots. Band coverage is the share of those outcomes inside the published lower/upper interval.",
  };
}

export function startMarketRefreshJob() {
  void refreshMarketHistory();
  const timer = setInterval(() => void refreshMarketHistory(), REFRESH_INTERVAL_MS);
  timer.unref?.();
  return timer;
}