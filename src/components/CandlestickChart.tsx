import React, { useMemo, useState } from 'react';
import { OhlcCandle, PositionRecord } from '../types/trading';
import { computePriceBounds } from '../utils/formatting';

interface CandlestickChartProps {
  contractSymbol: string;
  candles: OhlcCandle[];
  positions?: PositionRecord[];
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  contractSymbol,
  candles,
  positions = [],
  height = 350,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visibleCandles = useMemo(() => candles.slice(-72), [candles]);

  const activeBracket = useMemo(() => {
    const openPos = positions.find((p) => p.status === 'OPEN') || positions[0];
    if (!openPos) return null;
    return {
      entry: openPos.entry_price,
      target: openPos.target_price,
      sl: openPos.sl_price,
      entryTime: openPos.entry_time,
      exitTime: openPos.exit_time,
      exitPrice: openPos.exit_price,
      status: openPos.status,
      reason: openPos.exit_reason,
      optionType: openPos.option_type,
    };
  }, [positions]);

  const bounds = useMemo(() => {
    const extra: number[] = [];
    if (activeBracket) {
      if (activeBracket.entry > 0) extra.push(activeBracket.entry);
      if (activeBracket.target > 0) extra.push(activeBracket.target);
      if (activeBracket.sl > 0) extra.push(activeBracket.sl);
    }
    return computePriceBounds(visibleCandles, extra);
  }, [visibleCandles, activeBracket]);

  const width = 920;
  const padLeft = 16;
  const padRight = 68;
  const padTop = 24;
  const padBottom = 26;
  const volHeight = 46;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom - volHeight;

  const yOf = (price: number) => {
    const ratio = (price - bounds.min) / Math.max(0.01, bounds.max - bounds.min);
    return padTop + plotHeight * (1 - ratio);
  };

  const maxVol = useMemo(
    () => Math.max(1, ...visibleCandles.map((c) => c.volume || 1)),
    [visibleCandles]
  );

  const activeCandle =
    hoverIdx !== null && visibleCandles[hoverIdx]
      ? visibleCandles[hoverIdx]
      : visibleCandles[visibleCandles.length - 1];

  const yTicks = useMemo(() => {
    const steps = 5;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(bounds.min + ((bounds.max - bounds.min) * i) / steps);
    }
    return out;
  }, [bounds]);

  if (visibleCandles.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">
        Waiting for live candle data…
      </div>
    );
  }

  const slotW = plotWidth / visibleCandles.length;
  const candleW = Math.max(3, Math.min(10, slotW * 0.62));
  const lastCandle = visibleCandles[visibleCandles.length - 1];
  const ltpY = yOf(lastCandle.close);

  return (
    <div className="relative w-full select-none">
      {/* OHLC Top Readout */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
          <span className="font-semibold text-slate-100">{contractSymbol}</span>
          {activeCandle && (
            <>
              <span className="text-slate-400">{activeCandle.time}</span>
              <span className="text-slate-400">
                O <span className="text-slate-200">{activeCandle.open.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                H <span className="text-slate-200">{activeCandle.high.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                L <span className="text-slate-200">{activeCandle.low.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                C{' '}
                <span className={activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400'}>
                  {activeCandle.close.toFixed(2)}
                </span>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
            Entry
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            LTP
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Target
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
            Stop-loss
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal gridlines */}
        {yTicks.map((tick, idx) => {
          const y = yOf(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="#1E232B"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={width - padRight + 8}
                y={y + 3.5}
                fill="#7B8494"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {tick.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Active Bracket Zones */}
        {activeBracket && activeBracket.target > 0 && activeBracket.sl > 0 && (
          <g>
            <rect
              x={padLeft}
              y={yOf(activeBracket.target)}
              width={plotWidth}
              height={Math.max(1, yOf(activeBracket.entry) - yOf(activeBracket.target))}
              fill="rgba(34, 197, 94, 0.08)"
            />
            <rect
              x={padLeft}
              y={yOf(activeBracket.entry)}
              width={plotWidth}
              height={Math.max(1, yOf(activeBracket.sl) - yOf(activeBracket.entry))}
              fill="rgba(239, 68, 68, 0.08)"
            />
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yOf(activeBracket.target)}
              y2={yOf(activeBracket.target)}
              stroke="#22C55E"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yOf(activeBracket.entry)}
              y2={yOf(activeBracket.entry)}
              stroke="#38BDF8"
              strokeWidth={1}
            />
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yOf(activeBracket.sl)}
              y2={yOf(activeBracket.sl)}
              stroke="#EF4444"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          </g>
        )}

        {/* Candles + Volume bars */}
        {visibleCandles.map((c, i) => {
          const cx = padLeft + i * slotW + slotW / 2;
          const isUp = c.close >= c.open;
          const color = isUp ? '#22C55E' : '#EF4444';
          const yHigh = yOf(c.high);
          const yLow = yOf(c.low);
          const yOpen = yOf(c.open);
          const yClose = yOf(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(2, Math.abs(yClose - yOpen));

          const vH = ((c.volume || 1) / maxVol) * (volHeight - 8);
          const vY = height - padBottom - vH;

          return (
            <g
              key={c.ts + '-' + i}
              onMouseEnter={() => setHoverIdx(i)}
              className="cursor-crosshair"
            >
              {/* Invisible hover hit area */}
              <rect
                x={padLeft + i * slotW}
                y={padTop}
                width={slotW}
                height={plotHeight + volHeight}
                fill="transparent"
              />
              {/* Wick */}
              <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1.2} />
              {/* Body */}
              <rect
                x={cx - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                rx={1}
              />
              {/* Volume bar */}
              <rect
                x={cx - candleW / 2}
                y={vY}
                width={candleW}
                height={vH}
                fill={isUp ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}
                rx={1}
              />
              {/* X-axis labels every ~10 bars */}
              {i % Math.max(1, Math.floor(visibleCandles.length / 7)) === 0 && (
                <text
                  x={cx}
                  y={height - 6}
                  textAnchor="middle"
                  fill="#6E7787"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {c.time.slice(-5)}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover Crosshair */}
        {hoverIdx !== null && visibleCandles[hoverIdx] && (
          <line
            x1={padLeft + hoverIdx * slotW + slotW / 2}
            x2={padLeft + hoverIdx * slotW + slotW / 2}
            y1={padTop}
            y2={height - padBottom}
            stroke="#475569"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Right-Axis Price Tags */}
        {activeBracket && activeBracket.target > 0 && (
          <g transform={`translate(${width - padRight + 2}, ${yOf(activeBracket.target) - 9})`}>
            <rect width={62} height={18} rx={3} fill="#15803D" />
            <text x={31} y={12} textAnchor="middle" fill="#ECFDF5" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="600">
              TGT {activeBracket.target.toFixed(1)}
            </text>
          </g>
        )}

        {activeBracket && activeBracket.entry > 0 && (
          <g transform={`translate(${width - padRight + 2}, ${yOf(activeBracket.entry) - 9})`}>
            <rect width={62} height={18} rx={3} fill="#0369A1" />
            <text x={31} y={12} textAnchor="middle" fill="#F0F9FF" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="600">
              ENT {activeBracket.entry.toFixed(1)}
            </text>
          </g>
        )}

        {activeBracket && activeBracket.sl > 0 && (
          <g transform={`translate(${width - padRight + 2}, ${yOf(activeBracket.sl) - 9})`}>
            <rect width={62} height={18} rx={3} fill="#B91C1C" />
            <text x={31} y={12} textAnchor="middle" fill="#FEF2F2" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="600">
              SL {activeBracket.sl.toFixed(1)}
            </text>
          </g>
        )}

        {/* Current LTP marker */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={ltpY}
          y2={ltpY}
          stroke="#F59E0B"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <g transform={`translate(${width - padRight + 2}, ${ltpY - 9})`}>
          <rect width={62} height={18} rx={3} fill="#F59E0B" />
          <text x={31} y={12} textAnchor="middle" fill="#090B0E" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="700">
            LTP {lastCandle.close.toFixed(1)}
          </text>
        </g>
      </svg>
    </div>
  );
};
