import React, { useEffect, useState } from 'react';
import { Play, Download } from 'lucide-react';
import { apiRequest } from '../api/client';
import { BacktestResult, StrategyRecord } from '../types/trading';
import { formatINR, formatSignedINR } from '../utils/formatting';
import { EquityCurveChart } from '../components/EquityCurveChart';
import { CandlestickChart } from '../components/CandlestickChart';

interface BacktestPageProps {
  strategies: StrategyRecord[];
  initialSlug?: string;
}

export const BacktestPage: React.FC<BacktestPageProps> = ({ strategies, initialSlug }) => {
  const [selectedSlug, setSelectedSlug] = useState(initialSlug || strategies[0]?.slug || 'orb_breakout');
  const [period, setPeriod] = useState<'1M' | '3M' | '6M' | '1Y'>('3M');
  const [targetPct, setTargetPct] = useState(30);
  const [slPct, setSlPct] = useState(15);
  const [lots, setLots] = useState(2);
  const [slipPts, setSlipPts] = useState(0.5);
  const [brokerage, setBrokerage] = useState(20);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const activeStrategy = strategies.find((s) => s.slug === selectedSlug) || strategies[0];

  useEffect(() => {
    if (initialSlug) {
      setSelectedSlug(initialSlug);
    }
  }, [initialSlug]);

  const executeBacktest = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await apiRequest<BacktestResult>('/api/backtest', {
        method: 'POST',
        body: JSON.stringify({
          strategy_slug: selectedSlug,
          index_symbol: activeStrategy?.index_symbol || 'NIFTY',
          period,
          target_pct: targetPct,
          sl_pct: slPct,
          lots,
          slippage_pts: slipPts,
          brokerage_per_order: brokerage,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest execution failed');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    executeBacktest();
  }, [selectedSlug]);

  const handleExportCsv = () => {
    if (!result) return;
    const header = 'ID,Date,Contract,Entry,EntryTime,Target,SL,Exit,ExitTime,Qty,Reason,GrossPnL,Charges,NetPnL\n';
    const rows = result.trades
      .map(
        (t) =>
          `${t.id},${t.date},${t.contract},${t.entry},${t.entry_time},${t.target},${t.sl},${t.exit},${t.exit_time},${t.qty},${t.reason},${t.gross_pnl},${t.charges},${t.pnl}`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSlug}_${period}_backtest.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Backtest</h1>
          <p className="mt-1 text-xs text-slate-400">
            Replay strategies over real historical NSE/BSE market candles & India VIX option pricing with statutory costs.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!result || result.trades.length === 0}
          className="flex items-center gap-2 rounded-lg border border-[#242A34] bg-[#111419] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-[#343C4A] hover:text-white disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr]">
        {/* Left Control Panel */}
        <div className="h-fit rounded-xl border border-[#1E232B] bg-[#111418] p-4 space-y-4">
          <div>
            <label htmlFor="bt-strategy" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Strategy
            </label>
            <select
              id="bt-strategy"
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-white focus:border-amber-400 focus:outline-none"
            >
              {strategies.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
            {activeStrategy && (
              <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-slate-400">
                <span className="text-amber-300">{activeStrategy.index_symbol}</span>
                <span>·</span>
                <span>{activeStrategy.filename}</span>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">Period</div>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#1E232B] bg-[#0B0D11] p-1">
              {(['1M', '3M', '6M', '1Y'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md py-1.5 font-mono text-xs font-semibold transition-colors ${
                    period === p ? 'bg-amber-400 text-[#090B0E]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
              <span className="uppercase tracking-wider text-slate-400 font-sans">Target</span>
              <span className="font-semibold text-emerald-400">{targetPct}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={targetPct}
              onChange={(e) => setTargetPct(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
              <span className="uppercase tracking-wider text-slate-400 font-sans">Stop-Loss</span>
              <span className="font-semibold text-rose-400">{slPct}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              value={slPct}
              onChange={(e) => setSlPct(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Lots</label>
              <input
                type="number"
                min={1}
                max={50}
                value={lots}
                onChange={(e) => setLots(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Slip Pts</label>
              <input
                type="number"
                step="0.1"
                min={0}
                value={slipPts}
                onChange={(e) => setSlipPts(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">₹/Order</label>
              <input
                type="number"
                min={0}
                value={brokerage}
                onChange={(e) => setBrokerage(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-white"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={executeBacktest}
            disabled={running}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 py-2.5 text-xs font-semibold text-[#090B0E] transition-colors hover:bg-amber-300 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{running ? 'Running Backtest…' : 'Run backtest'}</span>
          </button>
        </div>

        {/* Right Analytics Panel */}
        <div className="space-y-5 min-w-0">
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Net P&L</div>
              <div
                className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                  (result?.net_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {result ? formatSignedINR(result.net_pnl) : '—'}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                {result ? `Gross ${formatSignedINR(result.gross_pnl)} · Chg ${formatINR(result.total_charges)}` : 'Calculating…'}
              </div>
            </div>

            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Win Rate</div>
              <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                {result ? `${result.win_rate.toFixed(1)}%` : '—'}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                {result ? `${result.total_trades} trades · ${result.sessions_count} sessions` : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Profit Factor</div>
              <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                {result ? result.profit_factor.toFixed(2) : '—'}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                {result ? `Sharpe ${result.sharpe.toFixed(2)} · ${result.wins}W/${result.losses}L` : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Max Drawdown</div>
              <div className="mt-2 font-mono text-2xl font-bold text-rose-400 tabular-nums">
                {result ? formatSignedINR(result.max_drawdown) : '—'}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                {result ? `Best ${formatSignedINR(result.best_trade)} · Worst ${formatSignedINR(result.worst_trade)}` : '—'}
              </div>
            </div>
          </div>

          {/* Equity Curve & Drawdown */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
            <div className="mb-3 flex items-center justify-between text-xs font-mono uppercase tracking-wider text-slate-400">
              <span>Equity Curve & Drawdown · {activeStrategy?.name} · {period}</span>
              <span>Real Historical NSE/BSE Feed</span>
            </div>
            <EquityCurveChart
              points={result?.equity_curve || []}
              height={240}
              showDrawdown={true}
            />
          </div>

          {/* Monthly Returns */}
          {result && result.monthly_returns.length > 0 && (
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Monthly Returns
              </div>
              <div className="flex flex-wrap gap-2.5 font-mono tabular-nums">
                {result.monthly_returns.map((m) => (
                  <div
                    key={m.month}
                    className={`rounded-lg border px-3.5 py-2.5 ${
                      m.pnl >= 0
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : 'border-rose-500/30 bg-rose-500/10'
                    }`}
                  >
                    <div className="text-[10px] text-slate-400">{m.month}</div>
                    <div
                      className={`mt-0.5 text-sm font-semibold ${
                        m.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatSignedINR(m.pnl)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trade Replay Chart */}
          {result && result.replay_candles.length > 0 && (
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Latest Session Option Replay</span>
                <span className="font-mono text-xs text-slate-400">{result.replay_date}</span>
              </div>
              <CandlestickChart
                contractSymbol={result.replay_contract}
                candles={result.replay_candles}
                height={280}
              />
            </div>
          )}

          {/* Simulated Trades Table */}
          {result && result.trades.length > 0 && (
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="mb-3 text-sm font-semibold text-white">Simulated Trades (Most Recent 50)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E232B] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Contract</th>
                      <th className="py-2 pr-3">Entry</th>
                      <th className="py-2 pr-3">Exit</th>
                      <th className="py-2 pr-3">Reason</th>
                      <th className="py-2 pr-3 text-right">Charges</th>
                      <th className="py-2 text-right">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181C24]">
                    {result.trades.slice(0, 20).map((t) => (
                      <tr key={t.id} className="hover:bg-[#151921]">
                        <td className="py-2 pr-3 text-slate-400">{t.date}</td>
                        <td className="py-2 pr-3 text-emerald-400">{t.contract}</td>
                        <td className="py-2 pr-3 text-sky-400">
                          {t.entry.toFixed(2)} <span className="text-slate-500">{t.entry_time}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-200">
                          {t.exit.toFixed(2)} <span className="text-slate-500">{t.exit_time}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-300">{t.reason}</td>
                        <td className="py-2 pr-3 text-right text-slate-400">{formatINR(t.charges, true)}</td>
                        <td
                          className={`py-2 text-right font-semibold ${
                            t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSignedINR(t.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
