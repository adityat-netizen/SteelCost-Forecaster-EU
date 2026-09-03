import { useEffect, useState } from 'react';
import { Check, Clock3 } from 'lucide-react';
import type { MarketInput } from '@workspace/api-client-react';

type LiveIndicatorProps = {
  input: MarketInput;
  sessionStartedAt: number;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LiveIndicator({ input, sessionStartedAt }: LiveIndicatorProps) {
  const [hasFreshened, setHasFreshened] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const checkFreshness = () => {
      const fetchedAt = new Date(input.lastFetchedAt).getTime();
      setHasFreshened(Number.isFinite(fetchedAt) && fetchedAt > sessionStartedAt);
    };

    checkFreshness();
    const interval = window.setInterval(checkFreshness, 45_000);
    return () => window.clearInterval(interval);
  }, [input.lastFetchedAt, sessionStartedAt]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`button-live-indicator-${input.key}`}
        aria-label={`${input.label} live status`}
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        title={`Last updated: ${formatDateTime(input.lastFetchedAt)} · Source: ${input.source} · Next expected update: ${formatDateTime(input.nextExpectedUpdate)}`}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold transition-all duration-300 ${
          hasFreshened
            ? 'border-accent/35 bg-accent/12 text-accent shadow-[0_0_0_3px_hsl(var(--accent)/.06)]'
            : 'border-border bg-secondary/55 text-muted-foreground'
        }`}
      >
        {hasFreshened ? <Check size={10} /> : <Clock3 size={10} />}
        Live
      </button>
      {detailsOpen && (
        <div
          data-testid={`popover-live-details-${input.key}`}
          className="absolute right-0 top-8 z-30 w-64 rounded-sm border border-border bg-card p-3 text-left text-[10px] leading-5 text-muted-foreground shadow-xl"
        >
          <div className="font-semibold text-foreground">{input.label}</div>
          <div className="mt-1">Last updated: {formatDateTime(input.lastFetchedAt)}</div>
          <div>Source: {input.source}</div>
          <div>Next expected update: {formatDateTime(input.nextExpectedUpdate)}</div>
          <div className="mt-1 font-mono uppercase tracking-[.08em] text-muted-foreground/75">
            {input.freshness} · {input.sourceRefreshInterval} cadence
          </div>
        </div>
      )}
    </div>
  );
}