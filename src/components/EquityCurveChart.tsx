import React, { useId } from 'react';
import { formatCompactINR } from '../utils/formatting';

interface EquityPoint {
  date?: string;
  label?: string;
  equity: number;
  drawdown?: number;
}

interface EquityCurveChartProps {
  points: EquityPoint[];
  height?: number;
  showDrawdown?: boolean;
  accentColor?: string;
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  points,
  height = 220,
  showDrawdown = false,
  accentColor = '#F59E0B',
}) => {
  const gradId = useId();

  if (points.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-xs text-slate-500">
        No closed trades recorded yet — execute a paper or live trade to build your equity curve.
      </div>
    );
  }

  const normalized = points.length === 1 ? [{ ...points[0], equity: 0, drawdown: 0 }, points[0]] : points;
  const width = 840;
  const padLeft = 58;
  const padRight = 14;
  const padTop = 14;
  const padBottom = showDrawdown ? 70 : 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const eqVals = normalized.map((p) => p.equity);
  const minEq = Math.min(0, ...eqVals);
  const maxEq = Math.max(100, ...eqVals);
  const eqSpan = Math.max(1, maxEq - minEq);

  const xOf = (i: number) => padLeft + (i / Math.max(1, normalized.length - 1)) * plotW;
  const yOfEq = (v: number) => padTop + plotH * (1 - (v - minEq) / eqSpan);

  const linePath = normalized
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOfEq(p.equity).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${xOf(normalized.length - 1).toFixed(1)} ${yOfEq(minEq).toFixed(1)} L ${xOf(0).toFixed(1)} ${yOfEq(minEq).toFixed(1)} Z`;

  const ddBaseTop = padTop + plotH + 14;
  const ddPlotH = 44;
  const minDd = Math.min(-100, ...normalized.map((p) => p.drawdown ?? 0));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accentColor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {[0, 0.5, 1].map((frac, idx) => {
        const val = minEq + eqSpan * frac;
        const y = yOfEq(val);
        return (
          <g key={idx}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#1E232B" strokeDasharray="2 3" />
            <text
              x={padLeft - 8}
              y={y + 3}
              textAnchor="end"
              fill="#6E7787"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatCompactINR(val)}
            </text>
          </g>
        );
      })}

      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />

      {showDrawdown && (
        <g>
          <line x1={padLeft} x2={width - padRight} y1={ddBaseTop} y2={ddBaseTop} stroke="#262C36" strokeWidth={1} />
          <text
            x={padLeft - 8}
            y={ddBaseTop + 10}
            textAnchor="end"
            fill="#6E7787"
            fontSize="9.5"
            fontFamily="JetBrains Mono, monospace"
          >
            DD
          </text>
          {normalized.map((p, i) => {
            const dd = p.drawdown ?? 0;
            const barH = Math.max(0, (Math.abs(dd) / Math.max(1, Math.abs(minDd))) * ddPlotH);
            const barW = Math.max(2, plotW / normalized.length - 1);
            return (
              <rect
                key={i}
                x={xOf(i) - barW / 2}
                y={ddBaseTop}
                width={barW}
                height={barH}
                fill="rgba(239, 68, 68, 0.35)"
                stroke="rgba(239, 68, 68, 0.65)"
                strokeWidth={0.5}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
};
