import React, { useEffect, useState } from 'react';
import { Play, XCircle, ArrowRight } from 'lucide-react';
import { apiRequest } from '../api/client';
import { DashboardResponse, NavRoute, OhlcCandle } from '../types/trading';
import { formatCompactINR, formatINR, formatSignedINR } from '../utils/formatting';
import { CandlestickChart } from '../components/CandlestickChart';
import { EquityCurveChart } from '../components/EquityCurveChart';

interface DashboardPageProps {
  data: DashboardResponse;
  onRefresh: () => void;
  onNavigate: (route: NavRoute) => void;
  onOpenOrderTicket: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  data,
  onRefresh,
  onNavigate,
  onOpenOrderTicket,
}) => {
  const [selectedSlug, setSelectedSlug] = useState<string>(data.strategies[0]?.slug || 'orb_breakout');
  const [candles, setCandles] = useState<OhlcCandle[]>([]);
  const [contractSymbol, setContractSymbol] = useState<string>('NIFTY ATM CE');
  const [closingId, setClosingId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selectedStrategy = data.strategies.find((s) => s.slug === selectedSlug) || data.strategies[0];

  useEffect(() => {
    const idx = selectedStrategy?.index_symbol || 'NIFTY';
    const openPos = data.positions.find((p) => p.strategy_slug === selectedSlug && p.status === 'OPEN') ||
      data.positions.find((p) => p.strategy_slug === selectedSlug);
    const strikeParam = openPos ? `&strike=${openPos.strike}&option_type=${openPos.option_type}` : '&option_type=CE';

    apiRequest<{ contract_symbol: string; candles: OhlcCandle[] }>(
      `/api/market/candles?index=${idx}${strikeParam}&interval=5m&range=1d`
    )
      .then((res) => {
        setCandles(res.candles);
        setContractSymbol(res.contract_symbol);
      })
      .catch(() => {
        // silent fallback to empty candles if transient
      });
  }, [selectedSlug, selectedStrategy?.index_symbol, data.positions.length]);

  const handleClosePosition = async (posId: number) => {
    setClosingId(posId);
    setFeedback(null);
    try {
      await apiRequest(`/api/positions/${posId}/close`, { method: 'POST', body: '{}' });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Failed to close position' });
    } finally {
      setClosingId(null);
    }
  };

  const handleRunScan = async (forceExecute: boolean) => {
    if (!selectedStrategy) return;
    setScanning(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ triggered: boolean; signal?: string; message?: string }>(
        `/api/strategies/${selectedStrategy.slug}/scan`,
        { method: 'POST', body: JSON.stringify({ force_execute: forceExecute }) }
      );
      if (res.triggered) {
        setFeedback({ type: 'ok', text: `${selectedStrategy.name} triggered BUY ${res.signal} on live ${selectedStrategy.index_symbol} feed.` });
      } else {
        setFeedback({ type: 'ok', text: res.message || 'No trigger on current 5m bar.' });
      }
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      setScanning(false);
    }
  };

  const strategyTrades = data.positions.filter((p) => p.strategy_slug === selectedSlug);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Today’s session</h1>
          <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">{data.market.ist_time}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleRunScan(false)}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg border border-[#242A34] bg-[#111419] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-[#343C4A] hover:text-white disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 text-amber-400" />
            <span>{scanning ? 'Scanning…' : 'Scan Live Signal'}</span>
          </button>
          <button
            type="button"
            onClick={() => handleRunScan(true)}
            disabled={scanning}
            className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
          >
            Test Paper Entry Now
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Live P&L</div>
          <div
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              data.kpis.live_pnl > 0 ? 'text-emerald-400' : data.kpis.live_pnl < 0 ? 'text-rose-400' : 'text-white'
            }`}
          >
            {formatSignedINR(data.kpis.live_pnl)}
          </div>
          <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            Realized {formatSignedINR(data.kpis.live_realized)}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Paper P&L</div>
          <div
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              data.kpis.paper_pnl > 0 ? 'text-emerald-400' : data.kpis.paper_pnl < 0 ? 'text-rose-400' : 'text-white'
            }`}
          >
            {formatSignedINR(data.kpis.paper_pnl)}
          </div>
          <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            Wallet {formatCompactINR(data.user.paper_capital)}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Trades</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {data.kpis.trades_total}
          </div>
          <div className="mt-1.5 font-mono text-xs tabular-nums">
            <span className="text-emerald-400">{data.kpis.wins}W</span>
            <span className="mx-1.5 text-slate-600">·</span>
            <span className="text-rose-400">{data.kpis.losses}L</span>
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Open Positions</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {data.kpis.open_count}
          </div>
          <div className="mt-1.5 truncate text-xs text-slate-400 font-mono">
            {data.kpis.open_contracts.length > 0 ? data.kpis.open_contracts.join(', ') : 'Flat book · 0 open'}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Capital Deployed</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {formatCompactINR(data.kpis.capital_deployed)}
          </div>
          <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            {data.kpis.running_strategies} of {data.kpis.total_strategies} strategies active
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        {/* Left Main Column */}
        <div className="space-y-5 min-w-0">
          {/* Chart + Strategy Trades Panel */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#1E232B] pb-3">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {data.strategies.slice(0, 5).map((st) => (
                  <button
                    key={st.slug}
                    type="button"
                    onClick={() => setSelectedSlug(st.slug)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedSlug === st.slug
                        ? 'border border-amber-400/50 bg-amber-400/15 text-amber-300'
                        : 'text-slate-400 hover:bg-[#181C24] hover:text-slate-200'
                    }`}
                  >
                    {st.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onOpenOrderTicket}
                className="text-xs font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
              >
                + Place Order
              </button>
            </div>

            <CandlestickChart
              contractSymbol={contractSymbol}
              candles={candles}
              positions={strategyTrades}
            />

            {/* Selected Strategy Trades Table */}
            <div className="mt-4 overflow-x-auto border-t border-[#1E232B] pt-3">
              {strategyTrades.length === 0 ? (
                <div className="flex items-center justify-between py-3 text-xs text-slate-400">
                  <span>No trades executed yet for {selectedStrategy?.name}.</span>
                  <button
                    type="button"
                    onClick={() => handleRunScan(true)}
                    className="font-medium text-amber-400 hover:text-amber-300"
                  >
                    Run paper execution on live spot →
                  </button>
                </div>
              ) : (
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E232B] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">Contract</th>
                      <th className="py-2 pr-3 font-medium">Entry</th>
                      <th className="py-2 pr-3 font-medium">Target</th>
                      <th className="py-2 pr-3 font-medium">SL</th>
                      <th className="py-2 pr-3 font-medium">Exit / LTP</th>
                      <th className="py-2 pr-3 font-medium text-right">Qty</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181C24]">
                    {strategyTrades.slice(0, 6).map((t, idx) => (
                      <tr key={t.id} className="hover:bg-[#151921]">
                        <td className="py-2.5 pr-3 text-slate-500">{String(idx + 1).padStart(2, '0')}</td>
                        <td className="py-2.5 pr-3 font-semibold text-emerald-400">{t.contract_symbol}</td>
                        <td className="py-2.5 pr-3 text-sky-400">
                          {t.entry_price.toFixed(2)} <span className="text-slate-500">{t.entry_time}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-emerald-400">{t.target_price.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-rose-400">{t.sl_price.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-slate-200">
                          {(t.status === 'OPEN' ? t.ltp : t.exit_price).toFixed(2)}{' '}
                          <span className="text-slate-500">{t.status === 'OPEN' ? 'LTP' : t.exit_time}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-slate-200">{t.qty}</td>
                        <td className="py-2.5 pr-3 text-slate-300">
                          {t.status === 'OPEN' ? (
                            <button
                              type="button"
                              onClick={() => handleClosePosition(t.id)}
                              disabled={closingId === t.id}
                              className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-400/20"
                            >
                              <XCircle className="h-3 w-3" />
                              {closingId === t.id ? 'Exiting…' : 'Square Off'}
                            </button>
                          ) : (
                            <span>{t.exit_reason || 'CLOSED'}</span>
                          )}
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSignedINR(t.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Portfolio Equity Summary */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-3">
                <span className="text-xs font-medium text-slate-400">Portfolio realized equity</span>
                <span
                  className={`font-mono text-sm font-semibold tabular-nums ${
                    data.equity_total > 0 ? 'text-emerald-400' : data.equity_total < 0 ? 'text-rose-400' : 'text-white'
                  }`}
                >
                  {formatSignedINR(data.equity_total)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('pnl')}
                className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-amber-400"
              >
                <span>Full P&L</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <EquityCurveChart points={data.equity_curve} height={150} />
          </div>

          {/* All Trades Ledger */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">All trades & open positions</h2>
              <span className="text-xs text-slate-400 font-mono tabular-nums">{data.positions.length} total</span>
            </div>

            {data.positions.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No trades executed in this profile yet. Click <span className="text-amber-400 font-medium">New Order</span> or{' '}
                <span className="text-amber-400 font-medium">Test Paper Entry Now</span> to execute against live market quotes.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E232B] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3 font-medium">Route</th>
                      <th className="py-2 pr-3 font-medium">Strategy</th>
                      <th className="py-2 pr-3 font-medium">Contract</th>
                      <th className="py-2 pr-3 font-medium">Entry</th>
                      <th className="py-2 pr-3 font-medium">Exit / LTP</th>
                      <th className="py-2 pr-3 font-medium text-right">Qty</th>
                      <th className="py-2 pr-3 font-medium">State</th>
                      <th className="py-2 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181C24]">
                    {data.positions.slice(0, 20).map((pos) => (
                      <tr key={pos.id} className="hover:bg-[#151921]">
                        <td className="py-2.5 pr-3 text-slate-300">
                          {pos.mode} · {pos.broker_code.toUpperCase()}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300 font-sans">{pos.strategy_slug}</td>
                        <td className="py-2.5 pr-3 font-semibold text-emerald-400">{pos.contract_symbol}</td>
                        <td className="py-2.5 pr-3 text-sky-400">
                          {pos.entry_price.toFixed(2)} <span className="text-slate-500">{pos.entry_time}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-200">
                          {(pos.status === 'OPEN' ? pos.ltp : pos.exit_price).toFixed(2)}{' '}
                          <span className="text-slate-500">{pos.status === 'OPEN' ? 'LTP' : pos.exit_time}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-slate-200">{pos.qty}</td>
                        <td className="py-2.5 pr-3">
                          {pos.status === 'OPEN' ? (
                            <button
                              type="button"
                              onClick={() => handleClosePosition(pos.id)}
                              disabled={closingId === pos.id}
                              className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-400/20"
                            >
                              {closingId === pos.id ? 'Closing…' : 'Square Off'}
                            </button>
                          ) : (
                            <span className="text-slate-400">{pos.exit_reason}</span>
                          )}
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            pos.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSignedINR(pos.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Column */}
        <div className="space-y-5">
          {/* Strategies Today */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Strategies today</h2>
              <button
                type="button"
                onClick={() => onNavigate('strategies')}
                className="text-xs font-medium text-slate-400 hover:text-amber-400"
              >
                Manage
              </button>
            </div>
            <div className="divide-y divide-[#181C24]">
              {data.strategies.map((st) => {
                const pnl = st.today_pnl || 0;
                return (
                  <button
                    key={st.slug}
                    type="button"
                    onClick={() => setSelectedSlug(st.slug)}
                    className="block w-full py-3 text-left transition-colors hover:bg-[#151921] px-1 rounded"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-100">{st.name}</span>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {formatSignedINR(pnl)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-400">
                      <span className="text-amber-300">{st.index_symbol}</span>
                      <span>·</span>
                      <span
                        className={
                          st.mode === 'LIVE'
                            ? 'text-emerald-400'
                            : st.mode === 'PAPER'
                            ? 'text-sky-400'
                            : 'text-slate-500'
                        }
                      >
                        {st.mode.toLowerCase()}
                      </span>
                      <span>·</span>
                      <span>{st.lots} lot(s)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Log Feed */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Live log</h2>
              <button
                type="button"
                onClick={() => onNavigate('logs')}
                className="text-xs font-medium text-slate-400 hover:text-amber-400"
              >
                Open console
              </button>
            </div>
            <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1 font-mono text-[11px]">
              {data.logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="shrink-0 text-slate-500 tabular-nums">{log.timestamp_ist}</span>
                  <span
                    className={`w-11 shrink-0 font-semibold ${
                      log.level === 'EXIT'
                        ? 'text-emerald-400'
                        : log.level === 'ORDER'
                        ? 'text-amber-400'
                        : log.level === 'SIGNAL'
                        ? 'text-sky-400'
                        : log.level === 'ERROR'
                        ? 'text-rose-400'
                        : log.level === 'WARN'
                        ? 'text-orange-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-slate-300 break-words">
                    <span className="text-slate-500">[{log.source}]</span> {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
