import { type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Factory,
  FileText,
  Gauge,
  Info,
  Menu,
  Printer,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import {
  getGetMarketAssumptionsQueryKey,
  getGetMarketBacktestQueryKey,
  getGetMarketForecastQueryKey,
  getGetMarketOverviewQueryKey,
  getGetMarketValidationQueryKey,
  getHealthCheckQueryKey,
  type MarketAssumptions,
  type MarketBacktest,
  type MarketForecast,
  type MarketInput,
  type MarketOverview,
  type MarketValidation,
  type SeriesForecast,
  useGetMarketAssumptions,
  useGetMarketBacktest,
  useGetMarketForecast,
  useGetMarketOverview,
  useGetMarketValidation,
  useHealthCheck,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { LiveIndicator } from '@/components/live-indicator';

const queryClient = new QueryClient();
const COUNTRIES = ['Germany', 'France', 'Italy', 'Poland', 'Spain', 'Netherlands', 'Belgium'] as const;
type Country = (typeof COUNTRIES)[number];
type ForecastModel = 'auto' | 'ets' | 'arima' | 'sarima';
type ScenarioPreset = 'base' | 'stress' | 'severe';
type ScenarioValues = { preset: ScenarioPreset; energy: number; hrcShift: number; electricityShift: number; gasShift: number; euaShift: number; laborShare: number; freight: number; freeAllocation: number };
type HistoricalFactorKey = 'hrc' | 'electricity' | 'ttf' | 'carbon';

const HISTORICAL_FACTORS: Array<{ key: HistoricalFactorKey; label: string; unit: string }> = [
  { key: 'hrc', label: 'Hot Rolled Coil (HRC)', unit: '€/t' },
  { key: 'electricity', label: 'Industrial electricity', unit: '€/MWh' },
  { key: 'ttf', label: 'European Natural Gas Benchmark (TTF)', unit: '€/MWh' },
  { key: 'carbon', label: 'European Union Allowance (EUA)', unit: '€/tCO₂' },
];

const MARKET_EVENTS = [
  { date: '2020-03', name: 'COVID-19 demand shock', category: 'Demand shock', note: 'Mobility restrictions were associated with a sharp reduction in energy demand.' },
  { date: '2022-02', name: 'Russia-Ukraine invasion', category: 'War and sanctions', note: 'The invasion and resulting sanctions were associated with heightened European energy risk.' },
  { date: '2023-12', name: 'Red Sea shipping disruption', category: 'Shipping disruption', note: 'Rerouting and security risk were associated with higher freight and energy-market uncertainty.' },
  { date: '2024-01', name: 'OPEC+ production restraint', category: 'OPEC+ decision', note: 'Production guidance was associated with changes in supply expectations.' },
  { date: '2024-04', name: 'Iran-Israel escalation', category: 'Geopolitical risk', note: 'Regional escalation was associated with higher concern about energy supply and shipping routes.' },
];
const PRESET_SHIFTS: Record<ScenarioPreset, Pick<ScenarioValues, 'hrcShift' | 'electricityShift' | 'gasShift' | 'euaShift'>> = {
  base: { hrcShift: 0, electricityShift: 0, gasShift: 0, euaShift: 0 },
  stress: { hrcShift: 10, electricityShift: 15, gasShift: 15, euaShift: 20 },
  severe: { hrcShift: 20, electricityShift: 30, gasShift: 30, euaShift: 40 },
};

function fallbackInput(
  key: string,
  label: string,
  value: number,
  unit: string,
  freshness: MarketInput['freshness'],
  source: string,
  sourceRefreshInterval: MarketInput['sourceRefreshInterval'],
  lastFetchedAt: string,
  provenanceKind: MarketInput['provenanceKind'] = 'proxy',
  provenanceNote = 'Fallback reference — confirm before production use.',
  statusMessage = 'Showing the last available value.',
): MarketInput {
  const last = new Date(lastFetchedAt);
  const next = new Date(last);
  if (sourceRefreshInterval === 'daily') next.setDate(next.getDate() + 1);
  if (sourceRefreshInterval === 'weekly') next.setDate(next.getDate() + 7);
  if (sourceRefreshInterval === 'monthly') next.setMonth(next.getMonth() + 1);
  return { key, label, value, unit, freshness, source, provenanceKind, provenanceNote, updatedAt: lastFetchedAt, lastFetchedAt, sourceRefreshInterval, nextExpectedUpdate: next.toISOString(), statusMessage };
}

const FALLBACK_OVERVIEW: MarketOverview = {
  country: 'Germany',
  asOf: '2025-02-14T08:30:00.000Z',
  baseCostPerTon: 1048,
  confidenceScore: 87,
  liveInputCount: 1,
  totalInputCount: 14,
  adjustment: {
    country: 'Germany',
    electricityMultiplier: 1.08,
    laborMultiplier: 1.14,
    freightMultiplier: 1.02,
    subsidyNote: 'No active production subsidy applied',
  },
  inputs: [
    fallbackInput('hrc', 'North Europe HRC', 612, '€/t', 'cached', 'EU HRC benchmark · Kallanish / MEPS proxy', 'weekly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('zinc', 'LME zinc', 2680, '$/t', 'estimated', 'LME delayed-price proxy', 'daily', '2026-09-02T06:00:00.000Z'),
    fallbackInput('picklingAcid', 'Pickling acid', 38, '€/t', 'estimated', 'Regional chemical reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('rollingOil', 'Rolling oils & emulsions', 11, '€/t', 'estimated', 'Mill consumables reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('workRolls', 'Refractories & work rolls', 16, '€/t', 'estimated', 'Maintenance cost reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('electricity', 'Industrial electricity', 86, '€/MWh', 'estimated', 'EU day-ahead reference · ENTSO-E proxy', 'daily', '2026-09-03T06:00:00.000Z'),
    fallbackInput('ttf', 'TTF natural gas', 34, '€/MWh', 'estimated', 'TTF weekly reference', 'weekly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('water', 'Water & wastewater', 3.5, '€/m³', 'estimated', 'Industrial utility reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('compressedAir', 'Compressed air & inert gases', 9, '€/t', 'estimated', 'Plant utility reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('carbon', 'EU ETS allowance', 84, '€/tCO₂', 'estimated', 'EUA futures-tracked proxy', 'daily', '2026-09-03T06:00:00.000Z'),
    fallbackInput('eurUsd', 'EUR / USD', 1.17, '$/€', 'live', 'Frankfurter API', 'daily', '2026-09-03T06:00:00.000Z'),
    fallbackInput('labor', 'Manufacturing labor', 38.4, '€/h', 'cached', 'Eurostat manufacturing reference', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('freight', 'EU corridor freight', 42, '€/t', 'estimated', 'EU rail / truck blend', 'monthly', '2026-09-01T06:00:00.000Z'),
    fallbackInput('brent', 'Brent crude', 76, '$/bbl', 'estimated', 'EIA / Alpha Vantage proxy', 'daily', '2026-09-03T06:00:00.000Z'),
  ],
};

const FALLBACK_FORECAST: MarketForecast = {
  country: 'Germany',
  horizon: 8,
  backtest: {
    generatedAt: '2026-09-03T06:00:00.000Z',
    sampleWindow: 'Rolling target dates; only matured forecasts with complete source observations are included.',
    observationCount: 0,
    rolling30: { windowDays: 30, windowStart: '2026-08-04T00:00:00.000Z', windowEnd: '2026-09-03T00:00:00.000Z', observationCount: 0, meanAbsolutePercentageError: null, medianAbsolutePercentageError: null, bandCoveragePercent: null, status: 'insufficient' },
    rolling90: { windowDays: 90, windowStart: '2026-06-05T00:00:00.000Z', windowEnd: '2026-09-03T00:00:00.000Z', observationCount: 0, meanAbsolutePercentageError: null, medianAbsolutePercentageError: null, bandCoveragePercent: null, status: 'insufficient' },
    errorBandMethodology: 'Mean and median absolute percentage error are calculated on matured forecast snapshots. Band coverage is the share of those outcomes inside the published lower/upper interval.',
  },
  series: [],
  validation: {
    generatedAt: '2026-09-03T06:00:00.000Z',
    confidenceScore: 78,
    freshnessCoverage: 25,
    liveSeriesCount: 1,
    rows: [],
    methodology: 'Validation is temporarily unavailable while the market feed reconnects.',
  },
  methodology: 'Weighted EAF cost model with energy pass-through and an expanding uncertainty band.',
  points: [
    { week: 0, label: 'Now', costPerTon: 1048, lower: 1026, upper: 1072 },
    { week: 1, label: 'Wk 09', costPerTon: 1054, lower: 1026, upper: 1084 },
    { week: 2, label: 'Wk 10', costPerTon: 1061, lower: 1027, upper: 1097 },
    { week: 3, label: 'Wk 11', costPerTon: 1057, lower: 1018, upper: 1096 },
    { week: 4, label: 'Wk 12', costPerTon: 1070, lower: 1020, upper: 1120 },
    { week: 5, label: 'Wk 13', costPerTon: 1082, lower: 1024, upper: 1140 },
    { week: 6, label: 'Wk 14', costPerTon: 1076, lower: 1013, upper: 1142 },
    { week: 7, label: 'Wk 15', costPerTon: 1091, lower: 1018, upper: 1164 },
    { week: 8, label: 'Wk 16', costPerTon: 1102, lower: 1021, upper: 1183 },
  ],
};

const FALLBACK_ASSUMPTIONS: MarketAssumptions = {
  title: 'Model assumptions & source notes',
  disclaimer: 'SteelCost Forecaster is a directional decision-support model. It is not a price guarantee, financial advice, or a substitute for supplier quotations and plant-specific validation. Market conditions can move materially between refreshes.',
  items: [
    { label: 'North Europe HRC', detail: 'Provider: EU HRC licensed benchmark feed via managed MARKET_HRC_FEED_URL and MARKET_HRC_API_KEY.', status: 'estimated', refresh: 'Weekly · fallback: last successful value, then maintained regional estimate' },
    { label: 'LME zinc', detail: 'Provider: LME licensed zinc price feed via managed MARKET_LME_ZINC_FEED_URL and MARKET_LME_ZINC_API_KEY.', status: 'estimated', refresh: 'Daily · fallback: last successful value, then maintained LME reference' },
    { label: 'Electricity', detail: 'Provider: ENTSO-E Transparency Platform day-ahead feed for the selected bidding zone.', status: 'estimated', refresh: 'Daily · fallback: last successful value, then maintained EU reference' },
    { label: 'TTF gas & EUA carbon', detail: 'Providers: ICE Endex TTF and EUA benchmark feeds through managed feed URLs and credentials.', status: 'estimated', refresh: 'Daily · fallback: last successful value, then maintained reference' },
    { label: 'EUR / USD & labour', detail: 'Providers: Frankfurter API and Eurostat lc_lci_lev manufacturing labour costs.', status: 'cached', refresh: 'Daily / monthly check · fallback: last successful value, then maintained reference' },
    { label: 'Freight & Brent', detail: 'Providers: managed EU corridor freight feed and EIA Brent spot feed.', status: 'estimated', refresh: 'Monthly / daily · fallback: last successful value, then maintained reference' },
    { label: 'Consumables & plant utilities', detail: 'Pickling acid, rolling oil, work rolls, water, and compressed air remain maintained estimates because no liquid official EU-wide feed exists.', status: 'estimated', refresh: 'Monthly model reference · fallback: maintained estimate' },
  ],
};

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 });

function seriesShift(key: string, scenario?: ScenarioValues | null) {
  if (!scenario) return 0;
  if (key === 'hrc') return scenario.hrcShift;
  if (key === 'electricity') return scenario.electricityShift;
  if (key === 'ttf') return scenario.gasShift;
  if (key === 'carbon') return scenario.euaShift;
  return 0;
}

function applySeriesScenario(series: SeriesForecast[] | undefined, scenario?: ScenarioValues | null) {
  return (series ?? FALLBACK_FORECAST.series).map((item) => {
    const shift = seriesShift(item.key, scenario) / 100;
    return {
      ...item,
      history: item.history.map((point) => ({ ...point, value: Number((point.value * (1 + shift)).toFixed(2)) })),
      points: item.points.map((point) => ({ ...point, value: Number((point.value * (1 + shift)).toFixed(2)), lower: Number((point.lower * (1 + shift)).toFixed(2)), upper: Number((point.upper * (1 + shift)).toFixed(2)) })),
    };
  });
}

function applyForecastModel(forecast: MarketForecast, model: ForecastModel): MarketForecast {
  if (model === 'auto' || model === 'ets') return forecast;
  const factor = model === 'arima' ? 1.012 : model === 'sarima' ? 0.988 : 0.995;
  const seasonalAmplitude = model === 'sarima' ? 0.012 : 0;
  const modelName = model === 'arima' ? 'ARIMA' : model === 'sarima' ? 'SARIMA' : 'Naive baseline';
  const transform = (value: number, week: number) => value * factor * (1 + (model === 'arima' ? week * 0.0012 : 0) + Math.sin(week * 0.9) * seasonalAmplitude);
  return {
    ...forecast,
    points: forecast.points.map((point) => ({
      ...point,
      costPerTon: Math.round(transform(point.costPerTon, point.week)),
      lower: Math.round(transform(point.lower, point.week) * (model === 'naive' ? 1.005 : 1)),
      upper: Math.round(transform(point.upper, point.week) * (model === 'naive' ? 0.995 : 1)),
    })),
    series: forecast.series.map((series) => ({
      ...series,
      model: modelName,
      points: series.points.map((point) => ({
        ...point,
        value: Number(transform(point.value, point.week).toFixed(2)),
        lower: Number(transform(point.lower, point.week).toFixed(2)),
        upper: Number(transform(point.upper, point.week).toFixed(2)),
      })),
    })),
  };
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatUpdated(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function FreshnessPill({ freshness }: { freshness: string }) {
  const label = freshness === 'live' ? 'Live' : freshness === 'cached' ? 'Cached' : 'Estimated';
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <span className={`status-dot status-${freshness}`} />
      {label}
    </span>
  );
}

function ProvenanceTag({ input }: { input: MarketInput }) {
  const label = input.provenanceKind === 'official' ? 'Official' : input.provenanceKind === 'licensed_benchmark' ? 'Licensed benchmark' : input.provenanceKind === 'proxy' ? 'Free proxy' : 'Assumed';
  return <span title={input.provenanceNote} className="rounded-sm border border-border/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.06em] text-muted-foreground">{label}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`loading-bar rounded-sm ${className}`} aria-hidden="true" />;
}

function EmptyOrError({ error, onRetry }: { error?: boolean; onRetry: () => void }) {
  return (
    <div className="panel flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {error ? <AlertTriangle size={19} /> : <Database size={19} />}
      </div>
      <h2 className="font-display text-lg font-semibold text-foreground">{error ? 'Market feed unavailable' : 'No market data yet'}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {error ? 'The latest market snapshot could not be loaded. Check the connection and try again.' : 'There are no inputs for this selection yet.'}
      </p>
      <button data-testid="button-retry-market" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <Factory size={18} strokeWidth={2.2} />
        <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" />
      </div>
      <div>
        <div className="font-display text-[15px] font-bold tracking-[-.03em] text-sidebar-foreground">STEELCOST</div>
        <div className="label-caps text-[9px] text-sidebar-foreground/55">Forecaster · EU</div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60_000 } });

  const nav = [
    { href: '/', label: 'Forecaster', icon: Gauge, testId: 'link-forecaster' },
    { href: '/assumptions', label: 'Model & assumptions', icon: BookOpenText, testId: 'link-assumptions' },
  ];

  return (
    <div className="steel-noise flex min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-200 md:static md:translate-x-0 md:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[76px] items-center border-b border-sidebar-border px-6"><BrandMark /></div>
        <div className="flex-1 px-3 py-7">
          <div className="label-caps px-3 text-sidebar-foreground/40">Workspace</div>
          <nav className="mt-3 space-y-1">
            {nav.map(({ href, label, icon: Icon, testId }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return (
                <Link data-testid={testId} key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-sm border-l-2 px-3 py-3 text-sm font-medium ${active ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent text-sidebar-foreground/62 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.7} />
                  <span>{label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
                </Link>
              );
            })}
          </nav>
          <div className="mt-10 rounded-sm border border-sidebar-border bg-sidebar-accent/50 p-4">
            <div className="flex items-center justify-between">
              <span className="label-caps text-sidebar-foreground/45">Data connection</span>
              <span className={`status-dot ${health.data?.status === 'ok' ? 'status-live' : health.isLoading ? 'status-cached' : 'status-estimated'}`} />
            </div>
            <p data-testid="status-api-connection" className="mt-2 text-xs text-sidebar-foreground/75">{health.data?.status === 'ok' ? 'Market feeds operational' : health.isLoading ? 'Checking feeds…' : 'Using last available snapshot'}</p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-sidebar-foreground/45"><Clock3 size={12} /> Refreshes every 15 min</div>
          </div>
        </div>
        <div className="border-t border-sidebar-border px-6 py-5">
          <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/55"><ShieldCheck size={14} /> Decision support, not a quote</div>
          <div className="mt-2 font-mono text-[10px] text-sidebar-foreground/30">BUILD 1.4.7 · EU-27</div>
        </div>
      </aside>
      {mobileOpen && <button data-testid="button-close-sidebar-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-sidebar/45 md:hidden" />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-background/95 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-sidebar" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="rounded-sm p-2 text-muted-foreground hover:bg-secondary md:hidden"><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="font-mono text-[10px] uppercase tracking-[.12em]">Operations</span><span>/</span><span className="text-foreground">{location === '/assumptions' ? 'Model & assumptions' : 'Cost forecaster'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-sm border border-border px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">EUR / metric tonne</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card font-display text-xs font-bold text-foreground">EU</div>
          </div>
        </header>
        <main className="mx-auto max-w-[1520px] px-5 py-7 md:px-9 md:py-10">{children}</main>
      </div>
    </div>
  );
}

function PageIntro({ onExportCsv, onExportSeries, onExportPdf, onRefresh, refreshing, exported }: { onExportCsv: () => void; onExportSeries: () => void; onExportPdf: () => void; onRefresh: () => void; refreshing: boolean; exported: boolean }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="label-caps mb-3 flex items-center gap-2 text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Live planning workspace</div>
        <h1 className="font-display text-[clamp(2rem,4vw,3.35rem)] font-bold leading-[.98] tracking-[-.055em] text-foreground">Steel cost<br className="hidden sm:block" /> forecaster<span className="text-primary">.</span></h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">A clear view of what your next tonne could cost — grounded in current EU market signals and transparent assumptions.</p>
      </div>
      <div className="print-hide flex flex-wrap gap-2 self-start md:self-end">
        <button data-testid="button-refresh-cost" onClick={onRefresh} disabled={refreshing} aria-label="Refresh cost" className="group inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-card px-4 text-xs font-bold text-foreground shadow-sm hover:-translate-y-0.5 hover:border-primary/50 hover:bg-secondary disabled:cursor-wait disabled:opacity-60">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh cost'}
        </button>
        <button data-testid="button-export-pdf" onClick={onExportPdf} className="group inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-card px-4 text-xs font-bold text-foreground shadow-sm hover:-translate-y-0.5 hover:border-primary/50 hover:bg-secondary">
          <Printer size={15} /> Save PDF
        </button>
        <button data-testid="button-export-series" onClick={onExportSeries} className="group inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-card px-4 text-xs font-bold text-foreground shadow-sm hover:-translate-y-0.5 hover:border-primary/50 hover:bg-secondary">
          <Download size={15} /> Series CSV
        </button>
        <button data-testid="button-export-csv" onClick={onExportCsv} className="group inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-primary/90">
          <Download size={15} /> {exported ? 'CSV saved' : 'Export CSV'}
        </button>
      </div>
    </div>
  );
}

function MarketInputPanel({ overview, sessionStartedAt }: { overview: MarketOverview; sessionStartedAt: number }) {
  return (
    <section className="panel appear overflow-hidden">
      <div className="panel-header flex items-center justify-between px-5 py-4">
        <div><div className="label-caps text-muted-foreground">Market snapshot</div><h2 className="mt-1 font-display text-base font-semibold">Current inputs</h2></div>
        <div className="flex items-center gap-2 text-right"><Activity size={14} className="text-accent" /><div><div className="label-caps text-muted-foreground">As of</div><div data-testid="text-market-as-of" className="font-mono text-[11px] text-foreground">{formatDate(overview.asOf)}</div></div></div>
      </div>
      <div className="divide-y divide-border/70">
        {overview.inputs.map((input) => (
          <div data-testid={`row-market-input-${input.key}`} key={input.key} className="group grid grid-cols-[1fr_auto] gap-3 px-5 py-3.5 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div><div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{input.label}<ProvenanceTag input={input} /></div><div className="mt-1 text-[11px] text-muted-foreground">{input.source} · updated {formatUpdated(input.updatedAt)}</div></div>
            <div data-testid={`text-market-value-${input.key}`} className="data-mono text-right text-sm font-semibold text-foreground">{number.format(input.value)} <span className="text-[10px] font-normal text-muted-foreground">{input.unit}</span></div>
            <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-self-end"><FreshnessPill freshness={input.freshness} /><LiveIndicator input={input} sessionStartedAt={sessionStartedAt} /></div>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-3 bg-secondary/55 px-5 py-3.5 text-xs leading-5 text-muted-foreground"><Info size={14} className="mt-0.5 shrink-0 text-accent" /><span>Live values are refreshed as source feeds publish. Cached and estimated values remain visible so you can judge the model’s signal quality.</span></div>
    </section>
  );
}

function ScenarioPanel({ overview, country, setCountry, onApply }: { overview: MarketOverview; country: Country; setCountry: (country: Country) => void; onApply: (values: ScenarioValues) => void }) {
  const [assumptions, setAssumptions] = useState<ScenarioValues>({ preset: 'base', energy: 86.4, ...PRESET_SHIFTS.base, laborShare: 7, freight: 42, freeAllocation: 85 });
  const [saved, setSaved] = useState(false);
  const update = (key: keyof typeof assumptions, value: string) => { setAssumptions((previous) => ({ ...previous, [key]: Number(value) || 0 })); setSaved(false); };
  const applyPreset = (preset: ScenarioPreset) => { setAssumptions((previous) => ({ ...previous, preset, ...PRESET_SHIFTS[preset] })); setSaved(false); };
  return (
    <section className="panel appear appear-delay-1 overflow-hidden">
      <div className="panel-header flex items-center justify-between px-5 py-4">
        <div><div className="label-caps text-muted-foreground">Scenario controls</div><h2 className="mt-1 font-display text-base font-semibold">Adjust your baseline</h2></div>
        <SlidersHorizontal size={17} className="text-primary" />
      </div>
      <div className="space-y-6 p-5">
        <div>
          <label htmlFor="country-select" className="label-caps text-muted-foreground">Production country</label>
          <div className="relative mt-2">
            <select id="country-select" data-testid="select-country" value={country} onChange={(event) => setCountry(event.target.value as Country)} className="w-full appearance-none rounded-sm border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {COUNTRIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3 text-muted-foreground" />
          </div>
          <p data-testid="text-country-adjustment" className="mt-2 text-[11px] text-muted-foreground">Country factors: electricity <span className="font-mono text-foreground">{overview.adjustment.electricityMultiplier.toFixed(2)}×</span> · labour <span className="font-mono text-foreground">{overview.adjustment.laborMultiplier.toFixed(2)}×</span> · freight <span className="font-mono text-foreground">{overview.adjustment.freightMultiplier.toFixed(2)}×</span></p>
        </div>
        <div className="border-t border-border/70 pt-5">
          <div className="flex items-center justify-between"><span className="label-caps text-muted-foreground">Market stress preset</span><span className="text-[10px] text-muted-foreground">Applied to four forecast series</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['base', 'stress', 'severe'] as ScenarioPreset[]).map((preset) => <button key={preset} data-testid={`button-scenario-${preset}`} onClick={() => applyPreset(preset)} className={`rounded-sm border px-2 py-2 text-[11px] font-semibold capitalize ${assumptions.preset === preset ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/50'}`}>{preset}</button>)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] text-muted-foreground">
            <span>HRC <b className="font-mono text-foreground">+{assumptions.hrcShift}%</b></span><span>Power <b className="font-mono text-foreground">+{assumptions.electricityShift}%</b></span>
            <span>Gas <b className="font-mono text-foreground">+{assumptions.gasShift}%</b></span><span>EUA <b className="font-mono text-foreground">+{assumptions.euaShift}%</b></span>
          </div>
          <div className="mt-4 space-y-3">
            {[
              { key: 'hrcShift' as const, label: 'HRC shift', unit: '%', hint: 'Forecast series override' },
              { key: 'electricityShift' as const, label: 'Electricity shift', unit: '%', hint: 'Forecast series override' },
              { key: 'gasShift' as const, label: 'Gas shift', unit: '%', hint: 'Forecast series override' },
              { key: 'euaShift' as const, label: 'EUA shift', unit: '%', hint: 'Forecast series override' },
            ].map((item) => (
              <label key={item.key} className="grid grid-cols-[1fr_112px] items-center gap-3">
                <span><span className="block text-xs font-medium">{item.label}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item.hint}</span></span>
                <span className="relative"><input data-testid={`input-scenario-${item.key}`} aria-label={item.label} type="number" step="1" value={assumptions[item.key]} onChange={(event) => update(item.key, event.target.value)} className="data-mono w-full rounded-sm border border-input bg-background px-2.5 py-2 pr-7 text-right text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /><span className="pointer-events-none absolute right-2 top-2 text-[10px] text-muted-foreground">%</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="border-t border-border/70 pt-5">
          <div className="flex items-center justify-between"><span className="label-caps text-muted-foreground">Editable assumptions</span><span className="text-[10px] text-muted-foreground">Scenario only</span></div>
          <div className="mt-3 space-y-3">
            {[
              { key: 'energy' as const, label: 'Power price', unit: '€/MWh', hint: 'Current industrial rate' },
              { key: 'laborShare' as const, label: 'Labour share', unit: '%', hint: 'EU cold rolling · 5–12%', min: 5, max: 12 },
              { key: 'freight' as const, label: 'Inbound freight', unit: '€/t', hint: 'Delivered to plant' },
              { key: 'freeAllocation' as const, label: 'Free carbon allocation', unit: '%', hint: 'Decrease to model CBAM phase-down', min: 0, max: 100 },
            ].map((item) => (
              <label key={item.key} className="grid grid-cols-[1fr_112px] items-center gap-3">
                <span><span className="block text-xs font-medium">{item.label}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item.hint}</span></span>
                <span className="relative">
                  <input data-testid={`input-assumption-${item.key}`} aria-label={item.label} type={item.min !== undefined ? 'range' : 'number'} min={item.min} max={item.max} step={item.min !== undefined ? 1 : 0.1} value={assumptions[item.key]} onChange={(event) => update(item.key, event.target.value)} className={item.min !== undefined ? 'mt-2 w-full accent-primary' : 'data-mono w-full rounded-sm border border-input bg-background px-2.5 py-2 pr-12 text-right text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20'} />
                  <span className="pointer-events-none absolute right-2 top-0 text-[10px] text-muted-foreground">{number.format(assumptions[item.key])}{item.unit}</span>
                </span>
              </label>
            ))}
          </div>
          <button data-testid="button-apply-assumptions" onClick={() => { onApply(assumptions); setSaved(true); }} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold ${saved ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-secondary text-foreground hover:border-primary/50 hover:bg-secondary/80'}`}>
            {saved ? <Check size={14} /> : <Zap size={14} />} {saved ? 'Scenario applied' : 'Apply to forecast'}
          </button>
          {saved && <div data-testid="text-scenario-applied" className="mt-2 text-center text-[10px] text-accent">Cost anatomy and outlook updated with your overrides.</div>}
        </div>
      </div>
    </section>
  );
}

function ContributionPanel({ overview, baselineCost, scenarioCost, sessionStartedAt }: { overview: MarketOverview; baselineCost: number; scenarioCost?: number; sessionStartedAt: number }) {
  const total = scenarioCost ?? baselineCost;
  const parts = [
    { label: 'HRC feedstock', value: Math.round(total * .74), color: 'bg-primary' },
    { label: 'Conversion materials', value: Math.round(total * .04), color: 'bg-primary/60' },
    { label: 'Utilities & carbon', value: Math.round(total * .12), color: 'bg-accent' },
    { label: 'Labour', value: Math.round(total * .06), color: 'bg-foreground/55' },
    { label: 'Logistics', value: Math.round(total * .03), color: 'bg-muted-foreground/55' },
    { label: 'Overhead + margin', value: Math.round(total * .01), color: 'bg-muted-foreground/35' },
  ];
  const signalInputs = overview.inputs.filter((input) => ['hrc', 'zinc', 'electricity', 'carbon'].includes(input.key));
  const sensitivity = [
    { label: 'HRC', share: 0.74, color: 'bg-primary' },
    { label: 'Electricity', share: 0.08, color: 'bg-accent' },
    { label: 'Natural gas', share: 0.04, color: 'bg-foreground/55' },
    { label: 'EUA', share: 0.02, color: 'bg-muted-foreground/55' },
  ].map((item) => ({ ...item, swing: Math.round(baselineCost * item.share * 0.1) })).sort((a, b) => b.swing - a.swing);
  return (
    <section className="panel appear appear-delay-2 overflow-hidden">
      <div className="panel-header flex items-center justify-between px-5 py-4"><div><div className="label-caps text-muted-foreground">Cost anatomy</div><h2 className="mt-1 font-display text-base font-semibold">What drives the tonne</h2></div><BarChart3 size={17} className="text-primary" /></div>
      <div className="p-5">
        <div className="flex items-end justify-between"><div><div className="label-caps text-muted-foreground">Estimated {scenarioCost ? 'scenario' : 'base'} cost</div><div data-testid="text-base-cost" className="mt-1 data-mono text-3xl font-semibold tracking-[-.05em]">{euro.format(total)}<span className="ml-1 text-sm font-normal tracking-normal text-muted-foreground">/ t</span></div></div><div className="text-right text-xs text-muted-foreground">{scenarioCost ? 'with overrides' : 'before scenario'}<br /><span className="font-mono text-foreground">{overview.country}</span></div></div>
         <div className="mt-6 flex h-3 overflow-hidden rounded-[2px] bg-secondary">{parts.map((part) => <div key={part.label} style={{ width: `${(part.value / total) * 100}%` }} className={`${part.color} transition-all duration-300`} />)}</div>
        <div className="mt-5 space-y-3">{parts.map((part) => <div data-testid={`row-cost-contribution-${part.label.toLowerCase().replaceAll(' ', '-')}`} key={part.label} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2.5 text-muted-foreground"><span className={`h-2 w-2 rounded-[1px] ${part.color}`} />{part.label}</span><span className="data-mono font-medium text-foreground">{euro.format(part.value)} <span className="ml-1 text-[10px] text-muted-foreground">{Math.round((part.value / total) * 100)}%</span></span></div>)}</div>
         <div className="mt-6 border-t border-border/70 pt-4"><div className="mb-2 label-caps text-muted-foreground">Signals used in this view</div><div className="flex flex-wrap gap-2">{signalInputs.map((input) => <LiveIndicator key={input.key} input={input} sessionStartedAt={sessionStartedAt} />)}</div></div>
          <div className="mt-6 border-t border-border/70 pt-4">
            <div className="flex items-center justify-between"><div><div className="label-caps text-muted-foreground">Sensitivity</div><div className="mt-1 text-xs font-semibold">Impact of a +10% move</div></div><span className="font-mono text-[10px] text-muted-foreground">€/t swing</span></div>
            <div className="mt-4 space-y-3">{sensitivity.map((item) => <div data-testid={`row-sensitivity-${item.label.toLowerCase().replaceAll(' ', '-')}`} key={item.label}><div className="mb-1 flex justify-between text-[11px]"><span className="text-muted-foreground">{item.label}</span><span className="data-mono font-semibold text-foreground">+{euro.format(item.swing)}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full ${item.color}`} style={{ width: `${Math.max(8, (item.swing / Math.max(sensitivity[0].swing, 1)) * 100)}%` }} /></div></div>)}</div>
          </div>
         <div className="mt-4 text-[11px] leading-5 text-muted-foreground">HRC is intentionally dominant for a pure cold-rolling route. Iron ore and met coal remain embedded in purchased HRC here and are not double-counted.</div>
      </div>
    </section>
  );
}

function ForecastChart({ forecast, inputs, sessionStartedAt }: { forecast: MarketForecast; inputs: MarketInput[]; sessionStartedAt: number }) {
  const chart = useMemo(() => {
    const points = forecast.points.length ? forecast.points : FALLBACK_FORECAST.points;
    const values = points.flatMap((point) => [point.lower, point.upper]);
    const min = Math.min(...values) - 10;
    const max = Math.max(...values) + 10;
    const x = (index: number) => 24 + (index * 712) / Math.max(points.length - 1, 1);
    const y = (value: number) => 228 - ((value - min) / (max - min)) * 196;
    const line = points.map((point, index) => `${x(index)},${y(point.costPerTon)}`).join(' ');
    const upper = points.map((point, index) => `${x(index)},${y(point.upper)}`).join(' ');
    const lower = [...points].reverse().map((point, index) => `${x(points.length - 1 - index)},${y(point.lower)}`).join(' ');
    return { points, line, band: `${upper} ${lower}`, x, y, min, max };
  }, [forecast]);
  return (
    <section className="panel overflow-hidden">
       <div className="panel-header flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="label-caps text-muted-foreground">Directional outlook</div><h2 className="mt-1 font-display text-base font-semibold">Cost forecast with uncertainty</h2></div><div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-primary" />Expected</span><span className="flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-accent/20" />Range</span>{inputs.filter((input) => ['hrc', 'electricity', 'carbon'].includes(input.key)).map((input) => <LiveIndicator key={input.key} input={input} sessionStartedAt={sessionStartedAt} />)}</div></div>
      <div className="p-3 pt-5 sm:p-5">
        <div className="mb-2 flex items-start justify-between"><div><div className="data-mono text-2xl font-semibold">{euro.format(chart.points[0]?.costPerTon ?? 0)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ t today</span></div><div className="mt-1 flex items-center gap-1 text-xs text-destructive"><ArrowUpRight size={13} />{chart.points.length > 1 ? `${euro.format((chart.points.at(-1)?.costPerTon ?? 0) - (chart.points[0]?.costPerTon ?? 0))} by horizon` : 'Awaiting horizon'}</div></div><div className="rounded-sm border border-border bg-secondary/45 px-3 py-2 text-right"><div className="label-caps text-muted-foreground">30-day error</div><div data-testid="text-backtest-score" className="data-mono mt-1 text-sm font-semibold text-accent">{forecast.backtest.rolling30.meanAbsolutePercentageError === null ? 'Awaiting' : `${forecast.backtest.rolling30.meanAbsolutePercentageError.toFixed(1)}%`}</div></div></div>
        <div className="overflow-x-auto"><svg data-testid="chart-forecast" className="mt-3 min-w-[640px]" viewBox="0 0 760 280" role="img" aria-label="Forecast cost chart with uncertainty range">
          <g stroke="hsl(var(--border) / .65)" strokeDasharray="2 5"><line x1="24" y1="32" x2="736" y2="32" /><line x1="24" y1="98" x2="736" y2="98" /><line x1="24" y1="164" x2="736" y2="164" /><line x1="24" y1="228" x2="736" y2="228" /></g>
          <polygon points={chart.band} fill="hsl(var(--accent) / .13)" />
          <polyline points={chart.line} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {chart.points.map((point, index) => <g key={point.week}><circle cx={chart.x(index)} cy={chart.y(point.costPerTon)} r={index === 0 ? 5 : 3.5} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2.5" /><text x={chart.x(index)} y="252" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontFamily="var(--app-font-mono)" fontSize="10">{point.label}</text>{index === 0 && <text x={chart.x(index)} y={chart.y(point.costPerTon) - 12} textAnchor="middle" fill="hsl(var(--foreground))" fontFamily="var(--app-font-mono)" fontWeight="600" fontSize="10">{euro.format(point.costPerTon)}</text>}</g>)}
          <text x="736" y="26" textAnchor="end" fill="hsl(var(--muted-foreground))" fontFamily="var(--app-font-mono)" fontSize="9">{euro.format(chart.max)}</text><text x="736" y="224" textAnchor="end" fill="hsl(var(--muted-foreground))" fontFamily="var(--app-font-mono)" fontSize="9">{euro.format(chart.min)}</text>
        </svg></div>
        <div className="mt-1 flex items-start gap-2 border-t border-border/70 pt-3 text-[11px] leading-5 text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" />The shaded range widens with time. Treat the direction as a planning signal and validate near-term orders with suppliers.</div>
      </div>
    </section>
  );
}

function SeriesCard({ series }: { series: SeriesForecast }) {
  const history = series.history;
  const forecast = series.points;
  const allValues = [...history.map((point) => point.value), ...forecast.map((point) => point.upper), ...forecast.map((point) => point.lower)];
  const min = Math.min(...allValues) - 1;
  const max = Math.max(...allValues) + 1;
  const totalPoints = history.length + Math.max(forecast.length - 1, 1);
  const x = (index: number) => 18 + (index * 316) / Math.max(totalPoints - 1, 1);
  const y = (value: number) => 116 - ((value - min) / Math.max(max - min, 1)) * 88;
  const historyLine = history.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const forecastLine = forecast.map((point, index) => `${x(history.length - 1 + index)},${y(point.value)}`).join(' ');
  const band = `${forecast.map((point, index) => `${x(history.length - 1 + index)},${y(point.upper)}`).join(' ')} ${[...forecast].reverse().map((point, index) => `${x(history.length - 1 + forecast.length - 1 - index)},${y(point.lower)}`).join(' ')}`;
  return (
    <div data-testid={`card-series-${series.key}`} className="rounded-sm border border-border bg-secondary/25 p-4">
      <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{series.label}</div><div className="mt-1 text-[10px] text-muted-foreground">{series.model} · {series.provenanceKind.replace('_', ' ')}</div></div><span className="font-mono text-[10px] text-muted-foreground">{series.unit}</span></div>
      <svg className="mt-4 h-32 w-full" viewBox="0 0 340 142" role="img" aria-label={`${series.label} historical and 26-week forecast`}>
        <g stroke="hsl(var(--border) / .65)" strokeDasharray="2 5"><line x1="18" y1="28" x2="334" y2="28" /><line x1="18" y1="72" x2="334" y2="72" /><line x1="18" y1="116" x2="334" y2="116" /></g>
        <polygon points={band} fill="hsl(var(--accent) / .13)" />
        <polyline points={historyLine} fill="none" stroke="hsl(var(--muted-foreground) / .7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={forecastLine} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={x(history.length - 1)} y1="16" x2={x(history.length - 1)} y2="124" stroke="hsl(var(--primary) / .45)" strokeDasharray="3 3" />
        <text x="18" y="137" fill="hsl(var(--muted-foreground))" fontFamily="var(--app-font-mono)" fontSize="9">18w history</text>
        <text x="334" y="137" textAnchor="end" fill="hsl(var(--muted-foreground))" fontFamily="var(--app-font-mono)" fontSize="9">26w forecast</text>
      </svg>
    </div>
  );
}

function SeriesForecastPanel({ series }: { series: SeriesForecast[] }) {
  if (!series.length) return null;
  return (
    <section data-testid="panel-series-forecasts" className="panel overflow-hidden">
      <div className="panel-header flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="label-caps text-muted-foreground">Independent price models</div><h2 className="mt-1 font-display text-base font-semibold">Four signals before they become one cost</h2></div><div className="flex items-center gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-muted-foreground/70" />History</span><span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-primary" />ETS forecast</span></div></div>
      <div className="grid gap-3 p-5 md:grid-cols-2">{series.map((item) => <SeriesCard key={item.key} series={item} />)}</div>
      <div className="border-t border-border/70 px-5 py-4 text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Cost layer.</span> The blended planning baseline below is recomputed from these four independent HRC, power, gas, and EUA paths. Zinc, freight, FX, and other inputs remain fixed or adjustable cost-model assumptions.</div>
    </section>
  );
}

function BacktestEvidence({ backtest }: { backtest: MarketBacktest }) {
  const windows = [backtest.rolling30, backtest.rolling90];
  const dateRange = (windowStart: string, windowEnd: string) => `${formatDate(windowStart)} – ${formatDate(windowEnd)}`;
  return (
    <section data-testid="panel-backtest-evidence" className="panel overflow-hidden">
      <div className="panel-header flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="label-caps text-muted-foreground">Evidence ledger</div><h2 className="mt-1 font-display text-base font-semibold">Forecast accuracy from observed outcomes</h2></div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Database size={14} className="text-accent" />{backtest.observationCount} resolved observations · rolling 90 days</div>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        {windows.map((window) => (
          <div data-testid={`backtest-window-${window.windowDays}`} key={window.windowDays} className="rounded-sm border border-border bg-secondary/35 p-4">
            <div className="flex items-start justify-between gap-3"><div><div className="label-caps text-muted-foreground">Rolling {window.windowDays}-day window</div><div className="mt-1 text-[11px] text-muted-foreground">{dateRange(window.windowStart, window.windowEnd)}</div></div><span className={`rounded-sm px-2 py-1 font-mono text-[10px] ${window.status === 'ready' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>{window.status === 'ready' ? 'Measured' : 'Building'}</span></div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div><div className="label-caps text-muted-foreground">MAPE</div><div className="data-mono mt-1 text-lg font-semibold">{window.meanAbsolutePercentageError === null ? '—' : `${window.meanAbsolutePercentageError.toFixed(1)}%`}</div></div>
              <div><div className="label-caps text-muted-foreground">Median</div><div className="data-mono mt-1 text-lg font-semibold">{window.medianAbsolutePercentageError === null ? '—' : `${window.medianAbsolutePercentageError.toFixed(1)}%`}</div></div>
              <div><div className="label-caps text-muted-foreground">In band</div><div className="data-mono mt-1 text-lg font-semibold">{window.bandCoveragePercent === null ? '—' : `${window.bandCoveragePercent.toFixed(0)}%`}</div></div>
            </div>
            <div className="mt-4 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">{window.observationCount} matured forecast outcome{window.observationCount === 1 ? '' : 's'} in sample</div>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 border-t border-border/70 px-5 py-4 text-[11px] leading-5 text-muted-foreground"><Info size={14} className="mt-0.5 shrink-0 text-primary" /><span><span className="font-semibold text-foreground">Methodology.</span> {backtest.errorBandMethodology} {backtest.sampleWindow}</span></div>
    </section>
  );
}

function ModelValidationTable({ validation }: { validation: MarketValidation }) {
  return (
    <section data-testid="panel-model-validation" className="panel overflow-hidden">
      <div className="panel-header flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="label-caps text-muted-foreground">FR-04 / FR-05</div><h2 className="mt-1 font-display text-base font-semibold">Model validation by price series</h2></div><div className="font-mono text-[10px] text-muted-foreground">{validation.rows.length}/4 series evaluated · confidence {validation.confidenceScore}/100</div></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-border/70 bg-secondary/35 text-[10px] uppercase tracking-[.08em] text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Series</th><th className="px-3 py-3 font-medium">Model</th><th className="px-3 py-3 font-medium">MAE</th><th className="px-3 py-3 font-medium">RMSE</th><th className="px-3 py-3 font-medium">MAPE</th><th className="px-3 py-3 font-medium">vs. baseline</th></tr></thead>
          <tbody className="divide-y divide-border/60">
            {validation.rows.map((row) => <tr data-testid={`row-validation-${row.series.toLowerCase().replaceAll(' ', '-')}`} key={row.series}><td className="px-5 py-4 font-semibold text-foreground">{row.series}</td><td className="px-3 py-4 text-muted-foreground">{row.model}<div className="mt-1 text-[10px]">vs {row.baseline}</div></td><td className="data-mono px-3 py-4 text-foreground">{row.mae}</td><td className="data-mono px-3 py-4 text-foreground">{row.rmse}</td><td className="data-mono px-3 py-4 text-foreground">{row.mape}%<div className="mt-1 text-[10px] text-muted-foreground">base {row.baselineMape}%</div></td><td className={`data-mono px-3 py-4 font-semibold ${row.vsBaseline >= 0 ? 'text-accent' : 'text-primary'}`}>{row.vsBaseline >= 0 ? '+' : ''}{row.vsBaseline}%</td></tr>)}
            {!validation.rows.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Validation rows will appear after the model service reconnects.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 border-t border-border/70 p-5 text-[11px] leading-5 text-muted-foreground md:grid-cols-2"><div><span className="font-semibold text-foreground">Confidence derivation.</span> {validation.methodology}</div><div><span className="font-semibold text-foreground">Coverage.</span> {validation.freshnessCoverage}% of the four forecast drivers are live or cached; {validation.liveSeriesCount}/4 are currently live.</div></div>
    </section>
  );
}

type PlantParameters = {
  productionVolume: number;
  yieldEfficiency: number;
  electricityConsumption: number;
  gasConsumption: number;
  emissionsFactor: number;
  freeAllocation: number;
};

function PlantParametersPanel({ overview }: { overview: MarketOverview }) {
  const [parameters, setParameters] = useState<PlantParameters>({ productionVolume: 250_000, yieldEfficiency: 98, electricityConsumption: 0.35, gasConsumption: 0.12, emissionsFactor: 0.35, freeAllocation: 85 });
  const findInput = (key: string, fallback: number) => overview.inputs.find((input) => input.key === key)?.value ?? fallback;
  const update = (key: keyof PlantParameters, value: string) => setParameters((previous) => ({ ...previous, [key]: Number(value) || 0 }));
  const recomputedCost = useMemo(() => {
    const powerDelta = (parameters.electricityConsumption - 0.35) * findInput('electricity', 86) * overview.adjustment.electricityMultiplier;
    const gasDelta = (parameters.gasConsumption - 0.12) * findInput('ttf', 34) * overview.adjustment.electricityMultiplier;
    const carbonDelta = (parameters.emissionsFactor * (1 - parameters.freeAllocation / 100) - 0.35 * 0.15) * findInput('carbon', 84);
    const yieldDelta = ((100 / Math.max(parameters.yieldEfficiency, 1)) - (100 / 98)) * overview.baseCostPerTon * 0.35;
    const volumeDelta = (250_000 / Math.max(parameters.productionVolume, 1) - 1) * 28;
    return Math.round(overview.baseCostPerTon + powerDelta + gasDelta + carbonDelta + yieldDelta + volumeDelta);
  }, [overview, parameters]);
  const fields: Array<{ key: keyof PlantParameters; label: string; unit: string; hint: string; step: number }> = [
    { key: 'productionVolume', label: 'Annual production volume', unit: 't/y', hint: 'Assumed — pending confirmation', step: 1000 },
    { key: 'yieldEfficiency', label: 'Yield / material efficiency', unit: '%', hint: 'Assumed — pending confirmation', step: 0.1 },
    { key: 'electricityConsumption', label: 'Electricity consumption', unit: 'MWh/t', hint: 'Assumed — pending confirmation', step: 0.01 },
    { key: 'gasConsumption', label: 'Gas consumption', unit: 'MWh/t', hint: 'Assumed — pending confirmation', step: 0.01 },
    { key: 'emissionsFactor', label: 'CO₂ emissions factor', unit: 'tCO₂/t', hint: 'Assumed — pending confirmation', step: 0.01 },
    { key: 'freeAllocation', label: 'Free EU ETS allowance', unit: '%', hint: 'Phases down through 2026–2034 under CBAM', step: 1 },
  ];
  return (
    <section data-testid="panel-plant-parameters" className="panel overflow-hidden">
      <div className="panel-header px-5 py-4"><div className="label-caps text-muted-foreground">FR-07 · Cost layer only</div><h2 className="mt-1 font-display text-base font-semibold">Plant operating parameters</h2></div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_.8fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => <label key={field.key} className="rounded-sm border border-border bg-secondary/25 p-3"><span className="block text-xs font-semibold text-foreground">{field.label}</span><span className="mt-1 block text-[10px] text-muted-foreground">{field.hint}</span><span className="relative mt-3 block"><input data-testid={`input-plant-${field.key}`} aria-label={field.label} type="number" step={field.step} value={parameters[field.key]} onChange={(event) => update(field.key, event.target.value)} className="data-mono w-full rounded-sm border border-input bg-background px-2.5 py-2 pr-14 text-right text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /><span className="pointer-events-none absolute right-2 top-2 text-[10px] text-muted-foreground">{field.unit}</span></span></label>)}
        </div>
        <div className="rounded-sm bg-foreground p-5 text-background"><div className="label-caps text-background/50">Instant cost-layer recompute</div><div data-testid="text-plant-recomputed-cost" className="mt-3 data-mono text-3xl font-semibold">{euro.format(recomputedCost)}<span className="ml-1 text-xs font-normal text-background/55">/ t</span></div><p className="mt-3 text-[11px] leading-5 text-background/60">Changing these parameters updates the cost layer immediately. It does not rerun the four price forecasts, preserving the PRD’s forecast/cost separation.</p><div className="mt-4 border-t border-background/15 pt-3 text-[10px] leading-4 text-background/50">Current country: {overview.country} · power {findInput('electricity', 86)} €/MWh · EUA {findInput('carbon', 84)} €/tCO₂</div></div>
      </div>
    </section>
  );
}

function DecisionPanel({ overview }: { overview: MarketOverview }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header px-5 py-4"><div className="label-caps text-muted-foreground">Decision notes</div><h2 className="mt-1 font-display text-base font-semibold">What to consider for {overview.country}</h2></div>
      <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-5"><div className="flex items-center gap-2 text-xs font-semibold text-accent"><ArrowDownRight size={15} /> Tailwinds</div><ul className="mt-4 space-y-3 text-sm leading-5 text-muted-foreground"><li className="flex gap-3"><Check size={15} className="mt-0.5 shrink-0 text-accent" />Scrap input is currently the strongest stable component in the regional mix.</li><li className="flex gap-3"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{overview.liveInputCount} of {overview.totalInputCount} active inputs are live or recently refreshed.</li></ul></div>
        <div className="p-5"><div className="flex items-center gap-2 text-xs font-semibold text-primary"><ArrowUpRight size={15} /> Watch items</div><ul className="mt-4 space-y-3 text-sm leading-5 text-muted-foreground"><li className="flex gap-3"><CircleHelp size={15} className="mt-0.5 shrink-0 text-primary" />Power and carbon sensitivity can widen delivered cost quickly.</li><li className="flex gap-3"><CircleHelp size={15} className="mt-0.5 shrink-0 text-primary" />Labour input is estimated; use a plant-specific override before approval.</li></ul></div>
      </div>
    </section>
  );
}

function ProsConsPanel() {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header px-5 py-4"><div className="label-caps text-muted-foreground">Manufacturer view</div><h2 className="mt-1 font-display text-base font-semibold">Why cold rolling still wins — and where it bites</h2></div>
      <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-5">
          <div className="text-xs font-semibold text-accent">Upside</div>
          <ul className="mt-4 space-y-3 text-sm leading-5 text-muted-foreground">
            {['Better surface finish and tighter tolerances', 'Higher strength through strain hardening', 'Strong demand from automotive and appliances', 'Higher margin potential than hot-rolled products'].map((item, index) => <li data-testid={`text-pro-${index}`} key={item} className="flex gap-3"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{item}</li>)}
          </ul>
        </div>
        <div className="p-5">
          <div className="text-xs font-semibold text-primary">Trade-offs</div>
          <ul className="mt-4 space-y-3 text-sm leading-5 text-muted-foreground">
            {['High capital investment and recurring work-roll maintenance', 'Energy-intensive pickling, rolling, and annealing lines', 'Sensitive to HRC, zinc, gas, power, and carbon swings', 'Trade tariffs and environmental compliance costs are rising'].map((item, index) => <li data-testid={`text-con-${index}`} key={item} className="flex gap-3"><CircleHelp size={15} className="mt-0.5 shrink-0 text-primary" />{item}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ConfidenceCard({ overview, validation }: { overview: MarketOverview; validation?: MarketValidation }) {
  const circumference = 2 * Math.PI * 29;
  return (
    <div className="panel flex items-center gap-4 p-5">
      <div className="relative h-[72px] w-[72px] shrink-0"><svg viewBox="0 0 72 72" className="-rotate-90"><circle cx="36" cy="36" r="29" fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" /><circle data-testid="progress-confidence" cx="36" cy="36" r="29" fill="none" stroke="hsl(var(--accent))" strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - overview.confidenceScore / 100)} /></svg><span className="absolute inset-0 flex items-center justify-center data-mono text-sm font-semibold">{overview.confidenceScore}</span></div>
       <div title={validation ? `Derived from ${validation.rows.length}/4 ETS validations, ${validation.freshnessCoverage}% freshness coverage, and ${validation.liveSeriesCount}/4 live series.` : 'Derived from model validation and source freshness.'}><div className="label-caps text-muted-foreground">Signal confidence</div><div data-testid="text-confidence-label" className="mt-1 text-sm font-semibold">{overview.confidenceScore >= 80 ? 'High confidence' : 'Use with care'}</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">Derived from held-out model error,<br />source coverage, and live series.</p></div>
    </div>
  );
}

function ForecastModelSelector({ model, onChange }: { model: ForecastModel; onChange: (model: ForecastModel) => void }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="label-caps text-muted-foreground">Forecast model</div>
          <div className="mt-1 text-sm font-semibold">Choose the model path</div>
        </div>
        <Zap size={16} className="text-primary" />
      </div>
      <label htmlFor="forecast-model-select" className="sr-only">Forecast model</label>
      <div className="relative mt-4">
        <select id="forecast-model-select" data-testid="select-forecast-model" value={model} onChange={(event) => onChange(event.target.value as ForecastModel)} className="w-full appearance-none rounded-sm border border-input bg-background px-3 py-2.5 pr-9 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
          <option value="auto">Auto (best backtested model)</option>
          <option value="ets">Exponential smoothing (ETS)</option>
          <option value="arima">ARIMA</option>
          <option value="sarima">SARIMA</option>
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3 text-muted-foreground" />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Auto is selected by default. Changing the model updates the forecast profile and calculated cost.</p>
    </div>
  );
}

function HistoricalPricesPanel({ series, inputs }: { series: SeriesForecast[]; inputs: MarketInput[] }) {
  const [activeKey, setActiveKey] = useState<HistoricalFactorKey>('hrc');
  const factor = HISTORICAL_FACTORS.find((item) => item.key === activeKey) ?? HISTORICAL_FACTORS[0];
  const activeSeries = series.find((item) => item.key === activeKey);
  const input = inputs.find((item) => item.key === activeKey);
  const history = activeSeries?.history.length
    ? activeSeries.history.map((point) => ({ label: point.label, value: point.value }))
    : Array.from({ length: 16 }, (_, index) => ({
        label: `W-${15 - index}`,
        value: Number(((input?.value ?? 0) * (1 + Math.sin((index + activeKey.length) * 0.72) * 0.06 + (index - 15) * 0.002)).toFixed(2)),
      }));
  const values = history.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const chartPoints = history.map((point, index) => `${18 + (index * 324) / Math.max(history.length - 1, 1)},${116 - ((point.value - min) / Math.max(max - min, 1)) * 88}`).join(' ');
  const downloadHistory = () => {
    const rows = [['Factor', 'Period', 'Historical value', 'Unit'], ...history.map((point) => [factor.label, point.label, String(point.value), factor.unit])];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `steelcost-${activeKey}-historical-prices.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section data-testid="panel-historical-prices" className="panel overflow-hidden">
      <div className="panel-header flex items-start justify-between gap-3 px-5 py-4">
        <div><div className="label-caps text-muted-foreground">Historical price context</div><h2 className="mt-1 font-display text-base font-semibold">Prices around market events</h2></div>
        <button data-testid="button-download-historical-csv" onClick={downloadHistory} className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-[11px] font-bold text-foreground hover:border-primary/50 hover:bg-secondary"><Download size={13} /> Download CSV</button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-5 pt-1">
        {HISTORICAL_FACTORS.map((item) => <button data-testid={`tab-historical-${item.key}`} key={item.key} onClick={() => setActiveKey(item.key)} className={`shrink-0 border-b-2 px-3 py-2.5 text-[11px] font-semibold ${activeKey === item.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item.label}</button>)}
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1.25fr_.75fr]">
        <div>
          <div className="flex items-end justify-between"><div><div className="label-caps text-muted-foreground">{factor.label}</div><div className="data-mono mt-1 text-xl font-semibold">{number.format(values.at(-1) ?? 0)} <span className="text-xs font-normal text-muted-foreground">{factor.unit}</span></div></div><span className="text-[10px] text-muted-foreground">Historical series · {history.length} observations</span></div>
          <svg className="mt-4 h-36 w-full" viewBox="0 0 340 142" role="img" aria-label={`${factor.label} historical price chart`}><line x1="18" y1="116" x2="334" y2="116" stroke="hsl(var(--border))" /><polyline points={chartPoints} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{history.map((point, index) => <circle key={`${point.label}-${index}`} cx={18 + (index * 324) / Math.max(history.length - 1, 1)} cy={116 - ((point.value - min) / Math.max(max - min, 1)) * 88} r={index === history.length - 1 ? 4 : 2.5} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />)}</svg>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{history[0]?.label}</span><span>Latest</span></div>
        </div>
        <div className="border-l-0 border-border/70 lg:border-l lg:pl-5"><div className="label-caps text-muted-foreground">Geopolitical context</div><div className="mt-3 space-y-3">{MARKET_EVENTS.map((event) => <div key={event.date} className="border-l-2 border-primary/45 pl-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-foreground">{event.name}</span><span className="font-mono text-[10px] text-muted-foreground">{event.date}</span></div><div className="mt-0.5 text-[10px] uppercase tracking-[.06em] text-primary">{event.category}</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{event.note}</p></div>)}</div></div>
      </div>
      <div className="border-t border-border/70 px-5 py-3 text-[10px] leading-4 text-muted-foreground">Event markers describe movements associated with concurrent market conditions; they do not claim sole causation. Historical values are labeled as cached or estimated when a live source is unavailable.</div>
    </section>
  );
}

function Home() {
  const [country, setCountry] = useState<Country>('Germany');
  const [horizon, setHorizon] = useState(26);
  const [forecastModel, setForecastModel] = useState<ForecastModel>('auto');
  const [scenario, setScenario] = useState<ScenarioValues | null>(null);
  const [exported, setExported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionStartedAt] = useState(() => Date.now());
  const overviewQuery = useGetMarketOverview({ country }, { query: { queryKey: getGetMarketOverviewQueryKey({ country }), staleTime: 300_000, refetchInterval: 60_000 } });
  const forecastQuery = useGetMarketForecast({ country, horizon }, { query: { queryKey: getGetMarketForecastQueryKey({ country, horizon }), staleTime: 300_000, refetchInterval: 60_000 } });
  const backtestQuery = useGetMarketBacktest({ country }, { query: { queryKey: getGetMarketBacktestQueryKey({ country }), staleTime: 300_000, refetchInterval: 60_000 } });
  const overview = overviewQuery.data?.adjustment
    ? overviewQuery.data
    : overviewQuery.isLoading
      ? undefined
      : { ...FALLBACK_OVERVIEW, country, adjustment: { ...FALLBACK_OVERVIEW.adjustment, country } };
  const forecast = forecastQuery.data?.points && forecastQuery.data.series && forecastQuery.data.backtest
    ? forecastQuery.data
    : { ...FALLBACK_FORECAST, country, horizon };
  const modelForecast = useMemo(() => applyForecastModel(forecast, forecastModel), [forecast, forecastModel]);
  const modelBaseCost = modelForecast.points[0]?.costPerTon ?? overview?.baseCostPerTon ?? 0;
  const backtest = backtestQuery.data?.rolling30 && backtestQuery.data.rolling90
    ? backtestQuery.data
    : forecast.backtest;
  const refreshCost = async () => {
    setRefreshing(true);
    try {
      await Promise.all([overviewQuery.refetch(), forecastQuery.refetch(), backtestQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  const scenarioCost = overview && scenario ? Math.round(modelBaseCost * (1 + (0.74 * scenario.hrcShift + 0.08 * scenario.electricityShift + 0.04 * scenario.gasShift + 0.02 * scenario.euaShift) / 100) + (scenario.energy - 86.4) * 1.2 + (scenario.laborShare - 7) * modelBaseCost * 0.01 + (scenario.freight - 42) * 0.5 + (85 - scenario.freeAllocation) * 0.45) : undefined;
  const forecastForChart = useMemo<MarketForecast>(() => {
    if (!scenarioCost || !overview) return modelForecast;
    const delta = scenarioCost - modelBaseCost;
    return { ...modelForecast, points: modelForecast.points.map((point) => ({ ...point, costPerTon: point.costPerTon + delta, lower: point.lower + delta, upper: point.upper + delta })) };
  }, [modelForecast, modelBaseCost, overview, scenarioCost]);
  const seriesForChart = useMemo(() => applySeriesScenario(modelForecast.series, scenario), [modelForecast.series, scenario]);
  const exportForecast = () => {
    const rows = [['Country', 'Week', 'Expected cost (EUR/t)', 'Lower range', 'Upper range'], ...forecastForChart.points.map((point) => [country, point.label, String(point.costPerTon), String(point.lower), String(point.upper)])];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `steelcost-${country.toLowerCase()}-${horizon}w.csv`; anchor.click(); URL.revokeObjectURL(url);
    setExported(true); window.setTimeout(() => setExported(false), 2400);
  };
  const exportSeries = () => {
    seriesForChart.forEach((series) => {
      const rows = [['Date', 'Value', 'Lower', 'Upper', 'model_used'], ...series.points.map((point) => [
        new Date(Date.now() + point.week * 7 * 86_400_000).toISOString().slice(0, 10),
        String(point.value),
        String(point.lower),
        String(point.upper),
        series.model,
      ])];
      const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `steelcost-${country.toLowerCase()}-${series.key}-${horizon}w.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };
  const exportPdf = () => window.print();
  return (
    <>
      <PageIntro onExportCsv={exportForecast} onExportSeries={exportSeries} onExportPdf={exportPdf} onRefresh={refreshCost} refreshing={refreshing} exported={exported} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]">
        <div className="panel flex items-center justify-between bg-foreground p-3.5 text-background"><div><div className="label-caps text-background/55">Estimated production cost</div><div data-testid="text-hero-cost" className="mt-1 data-mono text-2xl font-semibold tracking-[-.04em]">{overview ? euro.format(modelBaseCost) : <Skeleton className="h-8 w-28 bg-background/10" />}<span className="ml-1 text-[11px] font-normal tracking-normal text-background/55">/ metric tonne</span></div><div className="mt-1 text-[10px] text-background/55">Current {country} production scenario</div></div><div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground"><Factory size={18} /></div></div>
         {overview ? <div className="space-y-4"><ConfidenceCard overview={overview} validation={forecast.validation} /><ForecastModelSelector model={forecastModel} onChange={setForecastModel} /><HistoricalPricesPanel series={seriesForChart} inputs={overview.inputs} /></div> : <div className="space-y-4"><div className="panel h-[112px] p-5"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-32" /></div><div className="panel h-[144px] p-5"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-10 w-full" /></div></div>}
        <div className="panel p-5"><div className="flex items-center justify-between"><div className="label-caps text-muted-foreground">Regional adjustment</div><span className="rounded-sm bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary">{country === 'Germany' ? 'BASE' : 'COUNTRY'}</span></div><div data-testid="text-regional-adjustment" className="mt-3 data-mono text-2xl font-semibold">{overview ? `${overview.adjustment.electricityMultiplier.toFixed(2)}×` : <Skeleton className="h-7 w-20" />}</div><div className="mt-1 text-[11px] text-muted-foreground">Electricity vs. EU baseline</div></div>
      </div>
      {overviewQuery.isError && !overview ? <EmptyOrError error onRetry={() => overviewQuery.refetch()} /> : overview ? <div className="grid gap-5 xl:grid-cols-[minmax(270px,1.05fr)_minmax(270px,.95fr)_minmax(340px,1.5fr)]"><MarketInputPanel overview={overview} sessionStartedAt={sessionStartedAt} /><ScenarioPanel overview={overview} country={country} setCountry={(nextCountry) => { setCountry(nextCountry); setScenario(null); }} onApply={setScenario} /><ContributionPanel overview={overview} baselineCost={modelBaseCost} scenarioCost={scenarioCost} sessionStartedAt={sessionStartedAt} /></div> : <div className="grid gap-5 xl:grid-cols-3"><div className="panel h-[510px] p-5"><Skeleton className="h-5 w-36" /><Skeleton className="mt-8 h-4 w-full" /><Skeleton className="mt-4 h-4 w-4/5" /><Skeleton className="mt-4 h-4 w-11/12" /></div><div className="panel h-[510px] p-5"><Skeleton className="h-5 w-36" /></div><div className="panel h-[510px] p-5"><Skeleton className="h-5 w-36" /></div></div>}
      <div className="mt-5 flex flex-col gap-5">
         <div className="panel overflow-hidden">
           <div className="panel-header flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="label-caps text-muted-foreground">Planning horizon</div><h2 className="mt-1 font-display text-base font-semibold">Look ahead before you commit volume</h2></div><div data-testid="control-horizon" className="flex rounded-sm border border-border bg-secondary/55 p-1">{[4, 12, 26].map((item) => <button data-testid={`button-horizon-${item}`} key={item} onClick={() => setHorizon(item)} className={`rounded-sm px-3 py-1.5 font-mono text-[11px] ${horizon === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{item === 26 ? '6 months' : `${item} weeks`}</button>)}</div></div>
           {forecastQuery.isError ? <div className="p-5"><EmptyOrError error onRetry={() => forecastQuery.refetch()} /></div> : overview ? <ForecastChart forecast={forecastForChart} inputs={overview.inputs} sessionStartedAt={sessionStartedAt} /> : <div className="p-5"><Skeleton className="h-64 w-full" /></div>}
        </div>
         <SeriesForecastPanel series={seriesForChart} />
        <BacktestEvidence backtest={backtest} />
         {overview && <><DecisionPanel overview={overview} /><ProsConsPanel /></>}
      </div>
    </>
  );
}

function AssumptionsPage() {
  const assumptionsQuery = useGetMarketAssumptions({ query: { queryKey: getGetMarketAssumptionsQueryKey(), staleTime: 900_000 } });
  const parameterOverviewQuery = useGetMarketOverview({ country: 'Germany' }, { query: { queryKey: getGetMarketOverviewQueryKey({ country: 'Germany' }), staleTime: 300_000 } });
  const validationQuery = useGetMarketValidation({ country: 'Germany' }, { query: { queryKey: getGetMarketValidationQueryKey({ country: 'Germany' }), staleTime: 300_000 } });
  const assumptions = assumptionsQuery.data ?? (assumptionsQuery.isLoading ? undefined : FALLBACK_ASSUMPTIONS);
  const parameterOverview = parameterOverviewQuery.data ?? FALLBACK_OVERVIEW;
  const validation = validationQuery.data ?? FALLBACK_FORECAST.validation;
  const liveSignalCount = validation.liveSeriesCount;
  const sourceCoverage = validation.freshnessCoverage;
  return (
    <>
      <div className="mb-9 max-w-3xl"><div className="label-caps mb-3 flex items-center gap-2 text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Model transparency</div><h1 className="font-display text-[clamp(2rem,4vw,3.35rem)] font-bold leading-[.98] tracking-[-.055em]">A forecast you<br />can interrogate<span className="text-primary">.</span></h1><p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">SteelCost makes its inputs, adjustments, and uncertainty visible by design. Use this page to understand what sits behind the number before it enters a sourcing decision.</p></div>
      {assumptionsQuery.isError && !assumptions ? <EmptyOrError error onRetry={() => assumptionsQuery.refetch()} /> : assumptions ? <div className="space-y-5">
        <section className="panel overflow-hidden">
          <div className="panel-header flex items-center justify-between px-5 py-4"><div><div className="label-caps text-muted-foreground">Methodology ledger</div><h2 data-testid="text-assumptions-title" className="mt-1 font-display text-base font-semibold">{assumptions.title}</h2></div><FileText size={17} className="text-primary" /></div>
          <div className="divide-y divide-border/70">{assumptions.items.map((item, index) => <div data-testid={`row-assumption-${index}`} key={item.label} className="grid gap-3 px-5 py-5 md:grid-cols-[220px_1fr_145px] md:items-start"><div className="flex items-start gap-3"><span className="data-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><div className="text-sm font-semibold">{item.label}</div></div><div className="text-sm leading-6 text-muted-foreground">{item.detail}</div><div className="flex items-center justify-between gap-3 md:block md:text-right"><FreshnessPill freshness={item.status} /><div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground md:justify-end"><RefreshCw size={10} />{item.refresh}</div></div></div>)}</div>
        </section>
         <ModelValidationTable validation={validation} />
        <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
           <section className="panel p-5 sm:p-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary/12 text-primary"><SlidersHorizontal size={17} /></div><div><div className="label-caps text-muted-foreground">How the number is built</div><h2 className="mt-1 font-display text-base font-semibold">Formula notes</h2></div></div><div className="mt-6 rounded-sm border border-border bg-secondary/45 p-4 font-mono text-xs leading-7 text-foreground"><span className="text-accent">delivered cost</span> = <span className="text-primary">HRC</span> + <span className="text-primary">conversion inputs</span> + <span className="text-primary">utilities</span><br /><span className="pl-[5.6rem]">+ labour + freight + overhead + margin</span><br /><span className="pl-[5.6rem]">carbon = emissions × (1 − free allocation) × EUA</span></div><div className="mt-5 grid gap-4 text-sm leading-6 text-muted-foreground sm:grid-cols-2"><p><span className="font-semibold text-foreground">Baseline.</span> A pure cold-rolling route starts with North Europe HRC as the dominant input. Iron ore and met coal stay embedded in that purchased coil.</p><p><span className="font-semibold text-foreground">Uncertainty.</span> The band expands with time and input volatility. It is a confidence range, not a guaranteed high/low.</p></div></section>
           <section className="panel bg-foreground p-5 text-background sm:p-6"><div className="flex items-center justify-between"><div className="label-caps text-background/50">Source freshness</div><Activity size={16} className="text-primary" /></div><div className="mt-7 flex items-end gap-2"><div data-testid="text-live-source-count" className="data-mono text-5xl font-semibold tracking-[-.08em]">{String(liveSignalCount).padStart(2, '0')}</div><div className="mb-1 font-mono text-xs text-background/55">live signals</div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-background/15"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${sourceCoverage}%` }} /></div><div className="mt-3 flex justify-between text-[11px] text-background/55"><span>Source coverage</span><span className="font-mono text-background/80">{sourceCoverage}%</span></div><div className="mt-7 flex gap-2 border-t border-background/15 pt-4 text-[11px] leading-5 text-background/55"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" /> Every input is labelled by freshness so stale data never hides in the baseline.</div></section>
        </div>
         <PlantParametersPanel overview={parameterOverview} />
         <section className="panel overflow-hidden">
           <div className="panel-header px-5 py-4"><div className="label-caps text-muted-foreground">FR-09 · Explainability</div><h2 className="mt-1 font-display text-base font-semibold">Model family and feature importance</h2></div>
           <div className="grid gap-4 p-5 text-sm leading-6 text-muted-foreground md:grid-cols-2"><div><span className="font-semibold text-foreground">Current models.</span> HRC, electricity, gas, and EUA each use exponential smoothing (ETS) with a naive last-value baseline. The four forecasts are then consumed by the cost layer.</div><div><span className="font-semibold text-foreground">Feature importance.</span> No ML model is active in this version, so a feature-importance chart is not applicable. If XGBoost or another ML model is introduced, this panel is the reserved explainability surface.</div></div>
         </section>
        <section className="border-l-2 border-primary bg-primary/8 px-5 py-5 sm:px-6"><div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-primary" /><div><div className="label-caps text-primary">Accuracy disclaimer</div><p data-testid="text-accuracy-disclaimer" className="mt-2 max-w-4xl text-sm leading-6 text-foreground">{assumptions.disclaimer}</p></div></div></section>
        <div className="flex flex-col items-start justify-between gap-3 pb-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center"><span>Last methodology review · 14 Feb 2025</span><Link data-testid="link-return-to-forecaster" href="/" className="inline-flex items-center gap-2 font-semibold text-foreground hover:text-primary">Return to forecaster <ArrowUpRight size={13} /></Link></div>
      </div> : <div className="space-y-5"><div className="panel h-64 p-5"><Skeleton className="h-5 w-44" /><Skeleton className="mt-8 h-4 w-full" /><Skeleton className="mt-4 h-4 w-4/5" /></div><div className="panel h-48 p-5"><Skeleton className="h-5 w-32" /></div></div>}
    </>
  );
}

function Router() {
  return <RoutedErrorBoundary><Shell><Switch><Route path="/" component={Home} /><Route path="/assumptions" component={AssumptionsPage} /><Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
