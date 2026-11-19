export function formatINR(value: number, withDecimals = false): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(abs);
  return `${value < 0 ? '−' : ''}₹${formatted}`;
}

export function formatSignedINR(value: number, withDecimals = false): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(abs);
  if (value > 0) return `+₹${formatted}`;
  if (value < 0) return `−₹${formatted}`;
  return `₹${formatted}`;
}

export function formatCompactINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 10000000) {
    return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  }
  if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  }
  return formatINR(value);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function computePriceBounds(
  candles: Array<{ high: number; low: number }>,
  extraLevels: number[] = []
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  for (const lvl of extraLevels) {
    if (Number.isFinite(lvl) && lvl > 0) {
      if (lvl < min) min = lvl;
      if (lvl > max) max = lvl;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 100 };
  }
  const span = Math.max(1, max - min);
  const pad = span * 0.12;
  return {
    min: Math.max(0, Number((min - pad).toFixed(2))),
    max: Number((max + pad).toFixed(2)),
  };
}
