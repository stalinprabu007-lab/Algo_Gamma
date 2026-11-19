import test from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, formatSignedINR, formatCompactINR, computePriceBounds } from './formatting';

test('formatINR formats Indian numbering system cleanly', () => {
  assert.equal(formatINR(129004), '₹1,29,004');
  assert.equal(formatINR(-5236), '−₹5,236');
});

test('formatSignedINR includes explicit plus and minus signs', () => {
  assert.equal(formatSignedINR(27802), '+₹27,802');
  assert.equal(formatSignedINR(-6840), '−₹6,840');
  assert.equal(formatSignedINR(0), '₹0');
});

test('formatCompactINR renders lakhs and crores accurately', () => {
  assert.equal(formatCompactINR(570000), '₹5.70L');
  assert.equal(formatCompactINR(12500000), '₹1.25Cr');
});

test('computePriceBounds includes candles and extra bracket levels with padding', () => {
  const bounds = computePriceBounds(
    [
      { high: 150, low: 100 },
      { high: 180, low: 120 },
    ],
    [200, 90]
  );
  assert.ok(bounds.min < 90);
  assert.ok(bounds.max > 200);
});
