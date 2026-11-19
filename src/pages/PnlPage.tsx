import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { PnlAnalyticsResponse } from '../types/trading';
import { formatINR, formatSignedINR } from '../utils/formatting';

export const PnlPage: React.FC = () => {
  const [data, setData] = useState<PnlAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<PnlAnalyticsResponse>('/api/analytics/pnl')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-[#181C24]" />
        <div className="grid grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-[#1E232B] bg-[#111418]" />
          ))}
        </div>
      </div>
    );
  }

  const s = data?.summary;
  const maxStratAbs = Math.max(1, ...(data?.by_strategy.map((x) => Math.abs(x.pnl)) || [1]));
  const daily = data?.daily || [];
  const maxDailyAbs = Math.max(100, ...daily.map((d) => Math.abs(d.pnl)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Profit & Loss</h1>
        <p className="mt-1 text-xs text-slate-400">
          Consolidated performance book computed across all executed live and paper trades.
        </p>
      </div>

      {/* 5 Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Today (Live)</div>
          <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${(s?.today_live || 0) > 0 ? 'text-emerald-400' : (s?.today_live || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
            {formatSignedINR(s?.today_live || 0)}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Today (Paper)</div>
          <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${(s?.today_paper || 0) > 0 ? 'text-emerald-400' : (s?.today_paper || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
            {formatSignedINR(s?.today_paper || 0)}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">This Week</div>
          <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${(s?.this_week || 0) > 0 ? 'text-emerald-400' : (s?.this_week || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
            {formatSignedINR(s?.this_week || 0)}
          </div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Gross P&L</div>
          <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${(s?.gross_pnl || 0) > 0 ? 'text-emerald-400' : (s?.gross_pnl || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
            {formatSignedINR(s?.gross_pnl || 0)}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-mono">{s?.total_trades || 0} trades</div>
        </div>

        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Net After Charges</div>
          <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${(s?.net_after_charges || 0) > 0 ? 'text-emerald-400' : (s?.net_after_charges || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
            {formatSignedINR(s?.net_after_charges || 0)}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-mono">Charges {formatINR(s?.total_charges || 0, true)}</div>
        </div>
      </div>

      {/* Main Analytics Grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
        {/* Daily P&L Bar Chart */}
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-5">
          <div className="mb-4 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Daily P&L Performance
          </div>

          {daily.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-xs text-slate-500">
              No daily P&L records yet. Execute trades in Paper or Live mode to track session-by-session returns.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {daily.map((d) => (
                  <div
                    key={d.date}
                    className={`rounded-md border px-2.5 py-1.5 font-mono text-xs tabular-nums ${
                      d.pnl >= 0
                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    <div className="text-[10px] text-slate-400">{d.date}</div>
                    <div className="font-semibold">{formatSignedINR(d.pnl)}</div>
                  </div>
                ))}
              </div>

              <svg viewBox="0 0 640 220" className="w-full">
                <line x1={40} x2={620} y1={110} y2={110} stroke="#262C36" strokeWidth={1} />
                {daily.map((d, i) => {
                  const slot = 560 / Math.max(1, daily.length);
                  const barW = Math.min(34, Math.max(8, slot * 0.65));
                  const barH = (Math.abs(d.pnl) / maxDailyAbs) * 90;
                  const x = 50 + i * slot;
                  const y = d.pnl >= 0 ? 110 - barH : 110;
                  return (
                    <g key={d.date}>
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={Math.max(3, barH)}
                        fill={d.pnl >= 0 ? '#22C55E' : '#EF4444'}
                        rx={2}
                      />
                      <text
                        x={x + barW / 2}
                        y={210}
                        textAnchor="middle"
                        fill="#6E7787"
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {d.date.slice(5)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Right Breakdown Column */}
        <div className="space-y-4">
          {/* By Strategy */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-5">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              By Strategy
            </div>
            <div className="space-y-3">
              {data?.by_strategy.map((st) => {
                const widthPct = Math.max(4, Math.round((Math.abs(st.pnl) / maxStratAbs) * 100));
                return (
                  <div key={st.slug}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200">
                        {st.name} <span className="font-mono text-[11px] text-amber-300">· {st.index_symbol}</span>
                      </span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          st.pnl > 0 ? 'text-emerald-400' : st.pnl < 0 ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {formatSignedINR(st.pnl)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1C212A]">
                      <div
                        className={`h-full rounded-full ${st.pnl >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                        style={{ width: `${st.pnl === 0 ? 0 : widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Index & CE/PE Splits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">NIFTY</div>
              <div className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${(data?.by_index.NIFTY || 0) > 0 ? 'text-emerald-400' : (data?.by_index.NIFTY || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
                {formatSignedINR(data?.by_index.NIFTY || 0)}
              </div>
            </div>
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">SENSEX</div>
              <div className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${(data?.by_index.SENSEX || 0) > 0 ? 'text-emerald-400' : (data?.by_index.SENSEX || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
                {formatSignedINR(data?.by_index.SENSEX || 0)}
              </div>
            </div>
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Calls (CE)</div>
              <div className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${(data?.by_type.CE || 0) > 0 ? 'text-emerald-400' : (data?.by_type.CE || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
                {formatSignedINR(data?.by_type.CE || 0)}
              </div>
            </div>
            <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Puts (PE)</div>
              <div className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${(data?.by_type.PE || 0) > 0 ? 'text-emerald-400' : (data?.by_type.PE || 0) < 0 ? 'text-rose-400' : 'text-white'}`}>
                {formatSignedINR(data?.by_type.PE || 0)}
              </div>
            </div>
          </div>

          {/* Statutory Charges */}
          <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-5">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Charges · Statutory Ledger
            </div>
            <div className="space-y-2 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-slate-300">
                <span className="font-sans text-slate-400">Brokerage</span>
                <span>{formatINR(data?.charges_breakdown.brokerage || 0, true)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans text-slate-400">STT (sell side)</span>
                <span>{formatINR(data?.charges_breakdown.stt || 0, true)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans text-slate-400">Exchange txn</span>
                <span>{formatINR(data?.charges_breakdown.exchange_txn || 0, true)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans text-slate-400">GST 18%</span>
                <span>{formatINR(data?.charges_breakdown.gst || 0, true)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans text-slate-400">SEBI + stamp</span>
                <span>{formatINR(data?.charges_breakdown.sebi_stamp || 0, true)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
