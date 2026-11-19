import React, { useEffect, useState } from 'react';
import { X, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { apiRequest } from '../api/client';
import { BrokerConnection, OptionChainResponse } from '../types/trading';
import { formatINR } from '../utils/formatting';

interface OrderTicketModalProps {
  open: boolean;
  onClose: () => void;
  brokers: BrokerConnection[];
  paperCapital: number;
  onOrderSuccess: () => void;
}

export const OrderTicketModal: React.FC<OrderTicketModalProps> = ({
  open,
  onClose,
  brokers,
  paperCapital,
  onOrderSuccess,
}) => {
  const [mode, setMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [brokerCode, setBrokerCode] = useState<'zerodha' | 'dhan' | 'angelone'>('zerodha');
  const [indexSymbol, setIndexSymbol] = useState<'NIFTY' | 'SENSEX'>('NIFTY');
  const [optionType, setOptionType] = useState<'CE' | 'PE'>('CE');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL-M'>('MARKET');
  const [lots, setLots] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [targetPct, setTargetPct] = useState(30);
  const [slPct, setSlPct] = useState(15);
  const [securityId, setSecurityId] = useState('');
  const [symbolToken, setSymbolToken] = useState('');

  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number>(0);
  const [loadingChain, setLoadingChain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const connectedBrokers = brokers.filter((b) => b.status === 'CONNECTED');

  useEffect(() => {
    if (!open) return;
    setError('');
    setLoadingChain(true);
    apiRequest<OptionChainResponse>(`/api/market/option-chain?index=${indexSymbol}`)
      .then((res) => {
        setChain(res);
        setSelectedStrike(res.atm_strike);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load option chain'))
      .finally(() => setLoadingChain(false));
  }, [open, indexSymbol]);

  if (!open) return null;

  const selectedRow = chain?.rows.find((r) => r.strike === selectedStrike) || chain?.rows[Math.floor((chain?.rows.length || 0) / 2)];
  const activeOption = selectedRow ? (optionType === 'CE' ? selectedRow.ce : selectedRow.pe) : null;
  const lotSize = chain?.lot_size || (indexSymbol === 'NIFTY' ? 75 : 20);
  const qty = Math.max(1, lots) * lotSize;
  const effectivePrice = orderType === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : activeOption?.price || 0;
  const estValue = effectivePrice * qty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedStrike) {
      setError('Wait for live option chain strike to load.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          broker_code: mode === 'PAPER' ? 'paper' : brokerCode,
          index_symbol: indexSymbol,
          strike: selectedStrike,
          option_type: optionType,
          side,
          order_type: orderType,
          lots,
          price: orderType === 'LIMIT' ? Number(limitPrice) : effectivePrice,
          target_pct: targetPct,
          sl_pct: slPct,
          security_id: securityId.trim(),
          symbol_token: symbolToken.trim(),
        }),
      });
      onOrderSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order execution failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-ticket-title"
        className="w-full max-w-xl rounded-xl border border-[#242A34] bg-[#111419] text-[#E6E9EF]"
      >
        <div className="flex items-center justify-between border-b border-[#1E232B] px-5 py-4">
          <div>
            <h2 id="order-ticket-title" className="text-base font-semibold text-white">
              Order Execution Ticket
            </h2>
            <p className="text-xs text-slate-400">
              Live NSE/BSE option pricing · {chain ? `${chain.index_symbol} Spot ${chain.spot.toFixed(2)} · VIX ${chain.vix.toFixed(2)}` : 'Syncing live spot…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order ticket"
            className="rounded-md p-1.5 text-slate-400 hover:bg-[#1B2029] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Execution Route */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Execution Mode
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#1E232B] bg-[#0B0D11] p-1">
                <button
                  type="button"
                  onClick={() => setMode('PAPER')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    mode === 'PAPER' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Paper Engine
                </button>
                <button
                  type="button"
                  onClick={() => setMode('LIVE')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    mode === 'LIVE' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Live Broker
                </button>
              </div>
            </div>

            {mode === 'LIVE' ? (
              <div>
                <label htmlFor="order-broker" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Broker Route
                </label>
                <select
                  id="order-broker"
                  value={brokerCode}
                  onChange={(e) => setBrokerCode(e.target.value as 'zerodha' | 'dhan' | 'angelone')}
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="zerodha">Zerodha Kite {connectedBrokers.some((b) => b.broker_code === 'zerodha') ? '(Connected)' : '(Disconnected)'}</option>
                  <option value="dhan">Dhan HQ v2 {connectedBrokers.some((b) => b.broker_code === 'dhan') ? '(Connected)' : '(Disconnected)'}</option>
                  <option value="angelone">Angel One SmartAPI {connectedBrokers.some((b) => b.broker_code === 'angelone') ? '(Connected)' : '(Disconnected)'}</option>
                </select>
              </div>
            ) : (
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Paper Wallet Available
                </div>
                <div className="rounded-lg border border-[#1E232B] bg-[#0B0D11] px-3 py-2 font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                  {formatINR(paperCapital, true)}
                </div>
              </div>
            )}
          </div>

          {/* Index, Strike, CE/PE */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="order-index" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Index
              </label>
              <select
                id="order-index"
                value={indexSymbol}
                onChange={(e) => setIndexSymbol(e.target.value as 'NIFTY' | 'SENSEX')}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="NIFTY">NIFTY (Lot {75})</option>
                <option value="SENSEX">SENSEX (Lot {20})</option>
              </select>
            </div>

            <div>
              <label htmlFor="order-strike" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Strike ({chain?.expiry || 'Weekly'})
              </label>
              <select
                id="order-strike"
                value={selectedStrike}
                onChange={(e) => setSelectedStrike(Number(e.target.value))}
                disabled={loadingChain}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs font-medium text-white focus:border-amber-400 focus:outline-none"
              >
                {chain?.rows.map((r) => (
                  <option key={r.strike} value={r.strike}>
                    {r.strike} {r.is_atm ? '(ATM)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Option Type
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#1E232B] bg-[#0B0D11] p-1">
                <button
                  type="button"
                  onClick={() => setOptionType('CE')}
                  className={`rounded-md py-1.5 text-xs font-semibold ${
                    optionType === 'CE' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
                  }`}
                >
                  CE
                </button>
                <button
                  type="button"
                  onClick={() => setOptionType('PE')}
                  className={`rounded-md py-1.5 text-xs font-semibold ${
                    optionType === 'PE' ? 'bg-rose-500/20 text-rose-300' : 'text-slate-400'
                  }`}
                >
                  PE
                </button>
              </div>
            </div>
          </div>

          {/* Live Option Quote & Greeks Strip */}
          {activeOption && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1E232B] bg-[#0B0D11] px-3.5 py-2.5 text-xs font-mono tabular-nums">
              <div>
                <span className="text-slate-400">Live LTP </span>
                <span className="font-semibold text-amber-400">₹{activeOption.price.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span>Δ {activeOption.delta.toFixed(2)}</span>
                <span>Γ {activeOption.gamma.toFixed(4)}</span>
                <span>Θ {activeOption.theta.toFixed(1)}</span>
                <span>ν {activeOption.vega.toFixed(1)}</span>
              </div>
            </div>
          )}

          {/* Side, Order Type, Lots */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Side
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#1E232B] bg-[#0B0D11] p-1">
                <button
                  type="button"
                  onClick={() => setSide('BUY')}
                  className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${
                    side === 'BUY' ? 'bg-emerald-500 text-[#090B0E]' : 'text-slate-400'
                  }`}
                >
                  <ArrowUpRight className="h-3 w-3" /> BUY
                </button>
                <button
                  type="button"
                  onClick={() => setSide('SELL')}
                  className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${
                    side === 'SELL' ? 'bg-rose-500 text-white' : 'text-slate-400'
                  }`}
                >
                  <ArrowDownRight className="h-3 w-3" /> SELL
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="order-type" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Order Type
              </label>
              <select
                id="order-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT' | 'SL-M')}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="SL-M">SL-M</option>
              </select>
            </div>

            <div>
              <label htmlFor="order-lots" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Lots ({qty} qty)
              </label>
              <input
                id="order-lots"
                type="number"
                min={1}
                max={100}
                value={lots}
                onChange={(e) => setLots(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Bracket & Limit Price */}
          <div className="grid grid-cols-3 gap-3">
            {orderType === 'LIMIT' ? (
              <div>
                <label htmlFor="order-limit-price" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Limit Price
                </label>
                <input
                  id="order-limit-price"
                  type="number"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={activeOption ? String(activeOption.price) : '0.00'}
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Estimated Value
                </div>
                <div className="rounded-lg border border-[#1E232B] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-slate-200 tabular-nums">
                  {formatINR(estValue, true)}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="order-target-pct" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Target %
              </label>
              <input
                id="order-target-pct"
                type="number"
                min={1}
                max={500}
                value={targetPct}
                onChange={(e) => setTargetPct(Number(e.target.value) || 30)}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-emerald-400 focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="order-sl-pct" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Stop-Loss %
              </label>
              <input
                id="order-sl-pct"
                type="number"
                min={1}
                max={99}
                value={slPct}
                onChange={(e) => setSlPct(Number(e.target.value) || 15)}
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-rose-400 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {mode === 'LIVE' && brokerCode === 'dhan' && (
            <div>
              <label htmlFor="dhan-sec-id" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Dhan Exchange Security ID (Required for Dhan v2 Order API)
              </label>
              <input
                id="dhan-sec-id"
                type="text"
                value={securityId}
                onChange={(e) => setSecurityId(e.target.value)}
                placeholder="e.g. 52175"
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
          )}

          {mode === 'LIVE' && brokerCode === 'angelone' && (
            <div>
              <label htmlFor="angel-sym-token" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Angel One Symbol Token (Required for SmartAPI Order)
              </label>
              <input
                id="angel-sym-token"
                type="text"
                value={symbolToken}
                onChange={(e) => setSymbolToken(e.target.value)}
                placeholder="e.g. 43812"
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-[#1E232B] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#242A34] bg-[#161A22] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`rounded-lg px-5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                side === 'BUY'
                  ? 'bg-emerald-500 text-[#090B0E] hover:bg-emerald-400'
                  : 'bg-rose-500 text-white hover:bg-rose-400'
              }`}
            >
              {submitting
                ? 'Routing Order…'
                : `${side} ${qty} ${indexSymbol} ${selectedStrike || ''} ${optionType} (${mode})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
