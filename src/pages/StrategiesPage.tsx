import React, { useEffect, useState } from 'react';
import { Upload, Play, Pause, FlaskConical, Code2, X } from 'lucide-react';
import { apiRequest } from '../api/client';
import { StrategyRecord } from '../types/trading';
import { formatSignedINR } from '../utils/formatting';

interface StrategiesPageProps {
  onOpenBacktest: (strategySlug: string) => void;
  onRefreshParent: () => void;
}

export const StrategiesPage: React.FC<StrategiesPageProps> = ({
  onOpenBacktest,
  onRefreshParent,
}) => {
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StrategyRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Import state
  const [impFilename, setImpFilename] = useState('');
  const [impName, setImpName] = useState('');
  const [impIndex, setImpIndex] = useState<'NIFTY' | 'SENSEX'>('NIFTY');
  const [impCode, setImpCode] = useState(
    `def evaluate_signal(candles, spot, vix, params):\n    if len(candles) < 3:\n        return None\n    if candles[-1]["close"] > candles[-2]["high"]:\n        return {"side": "BUY", "option_type": "CE", "reason": "Breakout"}\n    return None\n`
  );

  const loadStrategies = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ strategies: StrategyRecord[] }>('/api/strategies');
      setStrategies(res.strategies);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  const handleModeChange = async (st: StrategyRecord, nextMode: 'LIVE' | 'PAPER' | 'PAUSED') => {
    setFeedback(null);
    try {
      await apiRequest(`/api/strategies/${st.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ mode: nextMode }),
      });
      await loadStrategies();
      onRefreshParent();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Failed to update mode' });
    }
  };

  const handleRunScan = async (st: StrategyRecord, forceExecute: boolean) => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ triggered: boolean; signal?: string; message?: string }>(
        `/api/strategies/${st.slug}/scan`,
        { method: 'POST', body: JSON.stringify({ force_execute: forceExecute }) }
      );
      setFeedback({
        type: 'ok',
        text: res.triggered
          ? `${st.name} executed ${st.mode} BUY ${res.signal} on live ${st.index_symbol} feed.`
          : res.message || `${st.name}: No entry signal on current 5m bar.`,
      });
      await loadStrategies();
      onRefreshParent();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Signal scan failed' });
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await apiRequest(`/api/strategies/${editing.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          mode: editing.mode,
          lots: editing.lots,
          target_pct: editing.target_pct,
          sl_pct: editing.sl_pct,
          index_symbol: editing.index_symbol,
          code_text: editing.code_text,
        }),
      });
      setEditing(null);
      setFeedback({ type: 'ok', text: `Updated ${editing.name} configuration.` });
      await loadStrategies();
      onRefreshParent();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/strategies/import', {
        method: 'POST',
        body: JSON.stringify({
          filename: impFilename.trim(),
          name: impName.trim(),
          index_symbol: impIndex,
          code_text: impCode,
        }),
      });
      setImportOpen(false);
      setImpFilename('');
      setImpName('');
      setFeedback({ type: 'ok', text: `Imported Python strategy ${impFilename}.` });
      await loadStrategies();
      onRefreshParent();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Import failed' });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpFilename(file.name);
    if (!impName) {
      setImpName(file.name.replace(/\.py$/i, '').replace(/_/g, ' '));
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImpCode(reader.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Strategies</h1>
          <p className="mt-1 text-xs text-slate-400">
            Each Python strategy runs in isolation with dedicated lot sizing, target/SL brackets, and Paper or Live routing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-[#090B0E] transition-colors hover:bg-amber-300"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Import .py</span>
        </button>
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

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl border border-[#1E232B] bg-[#111418]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {strategies.map((st) => {
            const net = st.net_pnl || 0;
            const today = st.today_pnl || 0;
            return (
              <div key={st.slug} className="rounded-xl border border-[#1E232B] bg-[#111418] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">{st.name}</h2>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-slate-400">
                      <span>{st.filename}</span>
                      <span>·</span>
                      <span className="text-amber-300">{st.index_symbol}</span>
                      <span>·</span>
                      <span>{st.lots} lot(s)</span>
                    </div>
                  </div>

                  {/* Mode Switcher */}
                  <div className="flex items-center gap-1 rounded-lg border border-[#222730] bg-[#0B0D11] p-1">
                    {(['LIVE', 'PAPER', 'PAUSED'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleModeChange(st, m)}
                        className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                          st.mode === m
                            ? m === 'LIVE'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : m === 'PAPER'
                              ? 'bg-sky-500/20 text-sky-300'
                              : 'bg-slate-700/50 text-slate-200'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-400">{st.description}</p>

                <div className="mt-4 grid grid-cols-4 gap-3 border-t border-[#1E232B] pt-4 font-mono tabular-nums">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Realized</div>
                    <div className={`mt-1 text-sm font-semibold ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-white'}`}>
                      {formatSignedINR(net)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Today</div>
                    <div className={`mt-1 text-sm font-semibold ${today > 0 ? 'text-emerald-400' : today < 0 ? 'text-rose-400' : 'text-white'}`}>
                      {formatSignedINR(today)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Win %</div>
                    <div className="mt-1 text-sm font-semibold text-white">{(st.win_rate || 0).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">PF / Trades</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {(st.profit_factor || 0).toFixed(2)} · {st.trades_count || 0}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#1E232B] pt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleModeChange(st, st.mode === 'PAUSED' ? 'PAPER' : 'PAUSED')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#242A34] bg-[#161A22] px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white"
                    >
                      {st.mode === 'PAUSED' ? <Play className="h-3 w-3 text-emerald-400" /> : <Pause className="h-3 w-3 text-amber-400" />}
                      <span>{st.mode === 'PAUSED' ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunScan(st, false)}
                      className="rounded-lg border border-[#242A34] px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-[#343C4A] hover:text-white"
                    >
                      Scan Live Bar
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenBacktest(st.slug)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-amber-400"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      <span>Backtest</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditing({ ...st })}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white"
                  >
                    <Code2 className="h-3.5 w-3.5 text-amber-400" />
                    <span>Params & Code →</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Drop / Import card */}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex min-h-[210px] flex-col items-center justify-center rounded-xl border border-dashed border-[#2A313D] bg-[#0D1014] p-6 text-center transition-colors hover:border-amber-400/50 hover:bg-[#11151C]"
          >
            <Upload className="h-6 w-6 text-slate-400" />
            <div className="mt-2 text-sm font-medium text-slate-200">Import a strategy</div>
            <div className="mt-1 font-mono text-xs text-slate-500">Upload or paste a Python .py file</div>
          </button>
        </div>
      )}

      {/* Edit Strategy Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[#242A34] bg-[#111419] p-5 text-[#E6E9EF]">
            <div className="flex items-center justify-between border-b border-[#1E232B] pb-3">
              <div>
                <h3 className="text-base font-semibold text-white">{editing.name}</h3>
                <p className="font-mono text-xs text-slate-400">{editing.filename}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close strategy editor"
                className="rounded-md p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Index</label>
                  <select
                    value={editing.index_symbol}
                    onChange={(e) => setEditing({ ...editing, index_symbol: e.target.value as 'NIFTY' | 'SENSEX' })}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 text-xs text-white"
                  >
                    <option value="NIFTY">NIFTY</option>
                    <option value="SENSEX">SENSEX</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Lots</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editing.lots}
                    onChange={(e) => setEditing({ ...editing, lots: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Target %</label>
                  <input
                    type="number"
                    min={1}
                    value={editing.target_pct}
                    onChange={(e) => setEditing({ ...editing, target_pct: Number(e.target.value) || 30 })}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-emerald-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Stop-Loss %</label>
                  <input
                    type="number"
                    min={1}
                    value={editing.sl_pct}
                    onChange={(e) => setEditing({ ...editing, sl_pct: Number(e.target.value) || 15 })}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-2.5 py-2 font-mono text-xs text-rose-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Python Strategy Source</label>
                <textarea
                  rows={12}
                  value={editing.code_text}
                  onChange={(e) => setEditing({ ...editing, code_text: e.target.value })}
                  className="w-full rounded-lg border border-[#242A34] bg-[#090B0E] p-3 font-mono text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-[#1E232B] pt-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-[#242A34] px-4 py-2 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300"
                >
                  Save Strategy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import .py Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[#242A34] bg-[#111419] p-5 text-[#E6E9EF]">
            <div className="flex items-center justify-between border-b border-[#1E232B] pb-3">
              <h3 className="text-base font-semibold text-white">Import Python (.py) Strategy</h3>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                aria-label="Close import modal"
                className="rounded-md p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleImportSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-slate-300">Load from local .py file (optional)</label>
                <input
                  type="file"
                  accept=".py"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-[#1E242E] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Filename (.py)</label>
                  <input
                    type="text"
                    value={impFilename}
                    onChange={(e) => setImpFilename(e.target.value)}
                    placeholder="my_gamma.py"
                    required
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Display Name</label>
                  <input
                    type="text"
                    value={impName}
                    onChange={(e) => setImpName(e.target.value)}
                    placeholder="My Gamma Scalp"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Index</label>
                  <select
                    value={impIndex}
                    onChange={(e) => setImpIndex(e.target.value as 'NIFTY' | 'SENSEX')}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs text-white"
                  >
                    <option value="NIFTY">NIFTY</option>
                    <option value="SENSEX">SENSEX</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Python Strategy Code</label>
                <textarea
                  rows={8}
                  value={impCode}
                  onChange={(e) => setImpCode(e.target.value)}
                  className="w-full rounded-lg border border-[#242A34] bg-[#090B0E] p-3 font-mono text-xs text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-[#1E232B] pt-3">
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="rounded-lg border border-[#242A34] px-4 py-2 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300"
                >
                  Import in PAPER Mode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
