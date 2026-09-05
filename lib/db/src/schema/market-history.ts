import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const marketObservationsTable = pgTable(
  "market_observations",
  {
    id: serial("id").primaryKey(),
    inputKey: text("input_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    source: text("source").notNull(),
    freshness: text("freshness").notNull(),
    sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    inputObservedUnique: uniqueIndex("market_observations_input_observed_unique").on(
      table.inputKey,
      table.observedAt,
    ),
    observedAtIndex: index("market_observations_observed_at_idx").on(table.observedAt),
  }),
);

export const forecastSnapshotsTable = pgTable(
  "forecast_snapshots",
  {
    id: serial("id").primaryKey(),
    country: text("country").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    targetDate: timestamp("target_date", { withTimezone: true }).notNull(),
    horizonWeeks: integer("horizon_weeks").notNull(),
    predictedCostPerTon: doublePrecision("predicted_cost_per_ton").notNull(),
    lowerBound: doublePrecision("lower_bound").notNull(),
    upperBound: doublePrecision("upper_bound").notNull(),
    actualCostPerTon: doublePrecision("actual_cost_per_ton"),
    absoluteError: doublePrecision("absolute_error"),
    percentageError: doublePrecision("percentage_error"),
    withinBand: boolean("within_band"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    forecastIdentityUnique: uniqueIndex("forecast_snapshots_identity_unique").on(
      table.country,
      table.runAt,
      table.targetDate,
    ),
    targetDateIndex: index("forecast_snapshots_target_date_idx").on(table.targetDate),
  }),
);

export const insertMarketObservationSchema = createInsertSchema(marketObservationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMarketObservation = z.infer<typeof insertMarketObservationSchema>;
export type MarketObservation = typeof marketObservationsTable.$inferSelect;

export const insertForecastSnapshotSchema = createInsertSchema(forecastSnapshotsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertForecastSnapshot = z.infer<typeof insertForecastSnapshotSchema>;
export type ForecastSnapshot = typeof forecastSnapshotsTable.$inferSelect;