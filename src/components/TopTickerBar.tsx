import React from 'react';
import { Menu, Power, Plus, RefreshCw, Activity } from 'lucide-react';
import { MarketSnapshot } from '../types/trading';
import { formatNumber } from '../utils/formatting';

interface TopTickerBarProps {
  market: MarketSnapshot | null;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenOrderTicket: () => void;
  onOpenKillSwitch: () => void;
  onOpenMobileNav: () => void;
}

export const TopTickerBar: React.FC<TopTickerBarProps> = ({
  market,
  onRefresh,
  refreshing,
  onOpenOrderTicket,
  onOpenKillSwitch,
  onOpenMobileNav,
}) => {
  const nifty = market?.tickers.NIFTY;
  const sensex = market?.tickers.SENSEX;
  const vix = market?.tickers.INDIAVIX;

  const renderTicker = (label: string, price?: number, pct?: number) => {
    const isUp = (pct ?? 0) >= 0;
    return (
      <div className="flex items-baseline gap-2 whitespace-nowrap shrink-0">
        <span className="text-[11px] font-medium tracking-wider text-slate-400">{label}</span>
        <span className="font-mono text-sm font-semibold text-white tabular-nums">
          {price !== undefined ? formatNumber(price, 2) : '—'}
        </span>
        {pct !== undefined && (
          <span
            className={`font-mono text-[11px] font-medium tabular-nums ${
              isUp ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {isUp ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    );
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#1E232B] bg-[#0B0D11] px-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5 overflow-x-auto">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-[#171B22] hover:text-white lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {renderTicker('NIFTY 50', nifty?.price, nifty?.change_pct)}
        <span className="hidden h-3.5 w-px bg-[#222730] sm:inline-block" />
        <div className="hidden sm:block">{renderTicker('SENSEX', sensex?.price, sensex?.change_pct)}</div>
        <span className="hidden h-3.5 w-px bg-[#222730] md:inline-block" />
        <div className="hidden md:block">{renderTicker('INDIA VIX', vix?.price, vix?.change_pct)}</div>

        <div className="hidden items-center gap-2 text-xs text-slate-400 xl:flex whitespace-nowrap shrink-0">
          <Activity className={`h-3.5 w-3.5 ${market?.market_open ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span>{market?.market_status || 'Syncing live market feed…'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh live quotes"
          title="Refresh live market quotes"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#242A34] bg-[#12161D] text-slate-300 transition-colors hover:border-[#343C4A] hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onOpenOrderTicket}
          className="flex items-center gap-1.5 rounded-md bg-amber-400 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-[#090B0E] transition-colors hover:bg-amber-300 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span><span className="hidden sm:inline">New </span>Order</span>
        </button>

        <button
          type="button"
          onClick={onOpenKillSwitch}
          aria-label="Kill switch"
          className="flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20 whitespace-nowrap shrink-0"
        >
          <Power className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Kill switch</span>
        </button>
      </div>
    </header>
  );
};
