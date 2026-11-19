import React from 'react';
import {
  LayoutGrid,
  Cpu,
  FlaskConical,
  TrendingUp,
  ScrollText,
  PlugZap,
  Zap,
  LogOut,
  X,
} from 'lucide-react';
import { NavRoute, UserProfile } from '../types/trading';
import { formatCompactINR } from '../utils/formatting';

interface SidebarProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  user: UserProfile;
  onLogout: () => void;
  primaryBroker: {
    broker_code: string;
    display_name: string;
    status: string;
    client_id: string;
    feed_latency_ms: number;
    margin_available: number;
    margin_used: number;
  } | null;
  feedLatencyMs: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: NavRoute; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'brokers', label: 'Brokers & API', icon: PlugZap },
  { id: 'strategies', label: 'Strategies', icon: Cpu },
  { id: 'backtest', label: 'Backtest', icon: FlaskConical },
  { id: 'pnl', label: 'P&L', icon: TrendingUp },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeRoute,
  onNavigate,
  user,
  onLogout,
  primaryBroker,
  feedLatencyMs,
  mobileOpen,
  onCloseMobile,
}) => {
  const isConnected = primaryBroker?.status === 'CONNECTED';
  const totalMargin = (primaryBroker?.margin_available || 0) + (primaryBroker?.margin_used || 0);
  const marginPct =
    isConnected && totalMargin > 0
      ? Math.min(100, Math.round(((primaryBroker?.margin_used || 0) / totalMargin) * 100))
      : 0;

  const content = (
    <aside className="flex h-full w-60 flex-col border-r border-[#1E232B] bg-[#0B0D11]">
      {/* Brand */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400 text-[#090B0E]">
            <Zap className="h-4.5 w-4.5 fill-current" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-white whitespace-nowrap">GammaDesk</div>
            <div className="text-[11px] text-slate-400 whitespace-nowrap">NIFTY · SENSEX options</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="rounded-md p-1.5 text-slate-400 hover:bg-[#171B22] hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 space-y-1 px-2.5 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                onCloseMobile();
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-[#171C24] text-white'
                  : 'text-slate-400 hover:bg-[#12161D] hover:text-slate-200'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Broker + Profile */}
      <div className="space-y-3 border-t border-[#1E232B] p-3">
        <button
          type="button"
          onClick={() => {
            onNavigate('brokers');
            onCloseMobile();
          }}
          className="w-full rounded-lg border border-[#202630] bg-[#111419] p-3 text-left transition-colors hover:border-[#2E3644]"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="truncate text-xs font-semibold text-slate-100">
                {isConnected ? primaryBroker?.display_name : 'Paper + Live Feed'}
              </span>
            </div>
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
            {isConnected
              ? `${primaryBroker?.client_id || 'LIVE'} · rtt ${primaryBroker?.feed_latency_ms || feedLatencyMs}ms`
              : `Paper ${formatCompactINR(user.paper_capital)} · ${feedLatencyMs}ms`}
          </div>
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{isConnected ? 'Margin used' : 'Paper balance'}</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {isConnected ? `${marginPct}%` : formatCompactINR(user.paper_capital)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1C212A]">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${isConnected ? Math.max(4, marginPct) : 100}%` }}
              />
            </div>
          </div>
        </button>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#1B2028] bg-[#0E1116] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-slate-200">{user.full_name}</div>
            <div className="truncate text-[11px] text-slate-500">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-[#1A2029] hover:text-rose-400"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden h-screen shrink-0 lg:block">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
};
