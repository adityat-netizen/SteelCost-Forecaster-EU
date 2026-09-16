import { useState } from 'react';
import { Check, Clock3 } from 'lucide-react';
import type { MarketInput } from '@workspace/api-client-react';

type GroupedSignalsIndicatorProps = {
  inputs: Array<MarketInput | undefined | null>;
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

export function GroupedSignalsIndicator({ inputs, sessionStartedAt }: GroupedSignalsIndicatorProps) {
  const validInputs = inputs.filter((item): item is MarketInput => Boolean(item));
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const tiers = ['live', 'cached', 'estimated'] as const;
  const groups = tiers
    .map((tier) => {
      const items = validInputs.filter((input) => input.freshness === tier);
      return {
        tier,
        label: tier === 'live' ? 'Live' : tier === 'cached' ? 'Cached' : 'Estimated',
        items,
        count: items.length,
      };
    })
    .filter((g) => g.count > 0);

  if (!groups.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((group) => {
        const hasFreshened = group.items.some((item) => {
          const fetchedAt = new Date(item.lastFetchedAt).getTime();
          return Number.isFinite(fetchedAt) && fetchedAt > sessionStartedAt;
        });

        const pillText = group.count > 1 ? `${group.label} × ${group.count}` : group.label;
        const signalNames = group.items.map((item) => item.label).join(', ');
        const tooltipText = group.count > 1 ? `Signals (${group.count}): ${signalNames}` : `Signal: ${signalNames}`;
        const isOpen = activeGroup === group.tier;

        return (
          <div key={group.tier} className="relative">
            <button
              type="button"
              data-testid={`button-grouped-signals-${group.tier}`}
              aria-label={`${group.label} signals status`}
              aria-expanded={isOpen}
              onClick={() => setActiveGroup((current) => (current === group.tier ? null : group.tier))}
              title={`${tooltipText} — click for signal breakdown`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all duration-200 cursor-pointer ${
                group.tier === 'live' && hasFreshened
                  ? 'border-accent/35 bg-accent/12 text-accent shadow-[0_0_0_3px_hsl(var(--accent)/.06)]'
                  : group.tier === 'cached'
                    ? 'border-border bg-secondary/70 text-foreground/80 hover:bg-secondary'
                    : 'border-border bg-secondary/55 text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {group.tier === 'live' && hasFreshened ? <Check size={10} /> : <Clock3 size={10} />}
              <span>{pillText}</span>
            </button>
            {isOpen && (
              <div
                data-testid={`popover-grouped-details-${group.tier}`}
                className="absolute left-0 top-8 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-card p-3 text-left text-[10px] leading-relaxed text-muted-foreground shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-border/60 pb-1.5 font-semibold text-foreground">
                  <span>{group.label} signals ({group.count})</span>
                  <button
                    type="button"
                    onClick={() => setActiveGroup(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Close details"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 divide-y divide-border/40 max-h-56 overflow-y-auto pr-1">
                  {group.items.map((item) => (
                    <div key={item.key} className="py-2 first:pt-0 last:pb-0">
                      <div className="font-medium text-foreground">{item.label}</div>
                      <div className="mt-0.5 text-[9.5px]">Source: {item.source}</div>
                      <div className="text-[9.5px]">Last updated: {formatDateTime(item.lastFetchedAt)}</div>
                      <div className="text-[9.5px] text-foreground/75">{item.statusMessage}</div>
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[.06em] text-muted-foreground/70">
                        {item.provenanceKind.replace('_', ' ')} · {item.sourceRefreshInterval} cadence
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
