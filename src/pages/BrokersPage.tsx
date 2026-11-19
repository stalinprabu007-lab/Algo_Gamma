import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, Unplug, KeyRound } from 'lucide-react';
import { apiRequest } from '../api/client';
import { BrokerConnection } from '../types/trading';
import { formatINR } from '../utils/formatting';

interface BrokersPageProps {
  paperCapital: number;
  onRefreshParent: () => void;
}

interface BrokerSyncResponse {
  brokers: BrokerConnection[];
  live_positions: Array<{
    broker: string;
    symbol: string;
    exchange: string;
    qty: number;
    avg_price: number;
    ltp: number;
    pnl: number;
    product: string;
  }>;
  live_holdings: Array<Record<string, unknown>>;
  live_orders: Array<Record<string, unknown>>;
}

export const BrokersPage: React.FC<BrokersPageProps> = ({ paperCapital, onRefreshParent }) => {
  const [data, setData] = useState<BrokerSyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'holdings' | 'orders' | 'paper'>('positions');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Zerodha form
  const [zApiKey, setZApiKey] = useState('');
  const [zApiSecret, setZApiSecret] = useState('');
  const [zRequestToken, setZRequestToken] = useState('');
  const [zAccessToken, setZAccessToken] = useState('');

  // Dhan form
  const [dClientId, setDClientId] = useState('');
  const [dAccessToken, setDAccessToken] = useState('');

  // Angel One form
  const [aApiKey, setAApiKey] = useState('');
  const [aClientCode, setAClientCode] = useState('');
  const [aPin, setAPin] = useState('');
  const [aTotpSecret, setATotpSecret] = useState('');
  const [aJwtToken, setAJwtToken] = useState('');

  // Paper capital reset
  const [paperAmount, setPaperAmount] = useState(String(paperCapital || 1000000));
  const [busyBroker, setBusyBroker] = useState<string | null>(null);

  const loadBrokers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<BrokerSyncResponse>('/api/brokers');
      setData(res);
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to load brokers' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBrokers();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setStatusMsg(null);
    try {
      const res = await apiRequest<BrokerSyncResponse>('/api/brokers/sync', { method: 'POST', body: '{}' });
      setData(res);
      setStatusMsg({ type: 'ok', text: 'Synchronized live margins, positions, holdings, and orders from connected brokers.' });
      onRefreshParent();
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleConnect = async (code: 'zerodha' | 'dhan' | 'angelone', payload: Record<string, string>) => {
    setBusyBroker(code);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ margin_available: number; latency_ms: number }>(`/api/brokers/${code}/connect`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatusMsg({
        type: 'ok',
        text: `${code.toUpperCase()} verified live · Available Margin ${formatINR(res.margin_available, true)} · RTT ${res.latency_ms}ms`,
      });
      await loadBrokers();
      onRefreshParent();
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : `${code} connection failed` });
      await loadBrokers();
    } finally {
      setBusyBroker(null);
    }
  };

  const handleDisconnect = async (code: 'zerodha' | 'dhan' | 'angelone') => {
    setBusyBroker(code);
    try {
      await apiRequest(`/api/brokers/${code}/disconnect`, { method: 'POST', body: '{}' });
      await loadBrokers();
      onRefreshParent();
    } finally {
      setBusyBroker(null);
    }
  };

  const handleSetPrimary = async (code: 'zerodha' | 'dhan' | 'angelone') => {
    await apiRequest(`/api/brokers/${code}/primary`, { method: 'POST', body: '{}' });
    await loadBrokers();
    onRefreshParent();
  };

  const handleOpenZerodhaOAuth = async () => {
    if (!zApiKey.trim()) {
      setStatusMsg({ type: 'err', text: 'Enter your Zerodha API Key first to generate the Kite Connect login URL.' });
      return;
    }
    try {
      const res = await apiRequest<{ url: string }>(`/api/brokers/zerodha/login-url?api_key=${encodeURIComponent(zApiKey.trim())}`);
      await navigator.clipboard?.writeText(res.url).catch(() => {});
      setStatusMsg({ type: 'ok', text: `Kite Login URL copied & ready: ${res.url}` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to generate URL' });
    }
  };

  const handleSavePaperCapital = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      await apiRequest('/api/paper/reset', {
        method: 'POST',
        body: JSON.stringify({ capital: Number(paperAmount) }),
      });
      setStatusMsg({ type: 'ok', text: `Paper trading wallet updated to ${formatINR(Number(paperAmount), true)}` });
      onRefreshParent();
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to update paper wallet' });
    }
  };

  const brokerByCode = (code: 'zerodha' | 'dhan' | 'angelone') =>
    data?.brokers.find((b) => b.broker_code === code);

  const renderStatusHeader = (b: BrokerConnection | undefined, fallbackTitle: string, subtitle: string) => {
    const isConnected = b?.status === 'CONNECTED';
    const isError = b?.status === 'ERROR';
    return (
      <div className="mb-4 flex items-start justify-between gap-2 border-b border-[#1E232B] pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{b?.display_name || fallbackTitle}</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          {isConnected ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> CONNECTED
            </span>
          ) : isError ? (
            <span className="inline-flex items-center gap-1 text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" /> ERROR
            </span>
          ) : (
            <span className="text-slate-500">DISCONNECTED</span>
          )}
        </div>
      </div>
    );
  };

  const zBroker = brokerByCode('zerodha');
  const dBroker = brokerByCode('dhan');
  const aBroker = brokerByCode('angelone');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Brokers & Live API</h1>
          <p className="mt-1 text-xs text-slate-400">
            Connect Zerodha Kite Connect v3, Dhan HQ v2, and Angel One SmartAPI for live order routing and cross-broker portfolio tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || loading}
          className="flex items-center gap-2 rounded-lg border border-[#242A34] bg-[#111419] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-[#343C4A] hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin text-amber-400' : ''}`} />
          <span>Sync Live Portfolio</span>
        </button>
      </div>

      {statusMsg && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-2.5 text-xs ${
            statusMsg.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* 3 Broker Integration Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ZERODHA KITE */}
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4 flex flex-col justify-between">
          <div>
            {renderStatusHeader(zBroker, 'Zerodha Kite', 'api.kite.trade · Kite Connect v3')}
            {zBroker?.status === 'CONNECTED' && (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-xs tabular-nums">
                <div className="flex justify-between text-slate-300">
                  <span>Available Margin</span>
                  <span className="font-semibold text-emerald-400">{formatINR(zBroker.margin_available, true)}</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-400 text-[11px]">
                  <span>User {zBroker.client_id || 'Verified'}</span>
                  <span>RTT {zBroker.feed_latency_ms}ms</span>
                </div>
              </div>
            )}
            {zBroker?.last_error && (
              <div className="mb-3 rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                {zBroker.last_error}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">API Key</label>
                <input
                  type="text"
                  value={zApiKey}
                  onChange={(e) => setZApiKey(e.target.value)}
                  placeholder={zBroker?.api_key_masked || 'Kite API Key'}
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">API Secret</label>
                  <input
                    type="password"
                    value={zApiSecret}
                    onChange={(e) => setZApiSecret(e.target.value)}
                    placeholder="For token exchange"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Request Token</label>
                  <input
                    type="text"
                    value={zRequestToken}
                    onChange={(e) => setZRequestToken(e.target.value)}
                    placeholder="Optional if Access Token set"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Access Token (Direct)</label>
                <input
                  type="password"
                  value={zAccessToken}
                  onChange={(e) => setZAccessToken(e.target.value)}
                  placeholder="Active Kite access_token"
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1E232B] pt-3">
            <button
              type="button"
              onClick={() =>
                handleConnect('zerodha', {
                  api_key: zApiKey,
                  api_secret: zApiSecret,
                  request_token: zRequestToken,
                  access_token: zAccessToken,
                })
              }
              disabled={busyBroker === 'zerodha'}
              className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300 disabled:opacity-50"
            >
              {busyBroker === 'zerodha' ? 'Verifying…' : 'Connect Zerodha'}
            </button>
            <button
              type="button"
              onClick={handleOpenZerodhaOAuth}
              title="Generate Kite Login URL"
              className="rounded-lg border border-[#242A34] bg-[#161A22] p-2 text-slate-300 hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            {zBroker?.status === 'CONNECTED' && (
              <>
                {!zBroker.is_primary && (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary('zerodha')}
                    className="rounded-lg border border-[#242A34] px-2.5 py-2 text-[11px] text-slate-300 hover:text-white"
                  >
                    Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDisconnect('zerodha')}
                  title="Disconnect"
                  className="rounded-lg border border-rose-500/30 p-2 text-rose-400 hover:bg-rose-500/10"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* DHAN HQ v2 */}
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4 flex flex-col justify-between">
          <div>
            {renderStatusHeader(dBroker, 'Dhan HQ v2', 'api.dhan.co/v2 · Options & Equity')}
            {dBroker?.status === 'CONNECTED' && (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-xs tabular-nums">
                <div className="flex justify-between text-slate-300">
                  <span>Available Balance</span>
                  <span className="font-semibold text-emerald-400">{formatINR(dBroker.margin_available, true)}</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-400 text-[11px]">
                  <span>Client {dBroker.client_id}</span>
                  <span>RTT {dBroker.feed_latency_ms}ms</span>
                </div>
              </div>
            )}
            {dBroker?.last_error && (
              <div className="mb-3 rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                {dBroker.last_error}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Dhan Client ID</label>
                <input
                  type="text"
                  value={dClientId}
                  onChange={(e) => setDClientId(e.target.value)}
                  placeholder={dBroker?.client_id || 'e.g. 1100458921'}
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Dhan Access Token (JWT)</label>
                <textarea
                  rows={4}
                  value={dAccessToken}
                  onChange={(e) => setDAccessToken(e.target.value)}
                  placeholder="Paste JWT token from web.dhan.co -> My Profile -> DhanHQ Trading APIs"
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1E232B] pt-3">
            <button
              type="button"
              onClick={() => handleConnect('dhan', { client_id: dClientId, access_token: dAccessToken })}
              disabled={busyBroker === 'dhan'}
              className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300 disabled:opacity-50"
            >
              {busyBroker === 'dhan' ? 'Verifying…' : 'Connect Dhan HQ'}
            </button>
            {dBroker?.status === 'CONNECTED' && (
              <>
                {!dBroker.is_primary && (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary('dhan')}
                    className="rounded-lg border border-[#242A34] px-2.5 py-2 text-[11px] text-slate-300 hover:text-white"
                  >
                    Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDisconnect('dhan')}
                  title="Disconnect"
                  className="rounded-lg border border-rose-500/30 p-2 text-rose-400 hover:bg-rose-500/10"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ANGEL ONE SMARTAPI */}
        <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4 flex flex-col justify-between">
          <div>
            {renderStatusHeader(aBroker, 'Angel One SmartAPI', 'apiconnect.angelone.in · Auto TOTP')}
            {aBroker?.status === 'CONNECTED' && (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-xs tabular-nums">
                <div className="flex justify-between text-slate-300">
                  <span>Available Cash</span>
                  <span className="font-semibold text-emerald-400">{formatINR(aBroker.margin_available, true)}</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-400 text-[11px]">
                  <span>Client {aBroker.client_id}</span>
                  <span>RTT {aBroker.feed_latency_ms}ms</span>
                </div>
              </div>
            )}
            {aBroker?.last_error && (
              <div className="mb-3 rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                {aBroker.last_error}
              </div>
            )}

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">SmartAPI Key</label>
                  <input
                    type="text"
                    value={aApiKey}
                    onChange={(e) => setAApiKey(e.target.value)}
                    placeholder={aBroker?.api_key_masked || 'X-PrivateKey'}
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Client Code</label>
                  <input
                    type="text"
                    value={aClientCode}
                    onChange={(e) => setAClientCode(e.target.value)}
                    placeholder="e.g. A123456"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Trading PIN</label>
                  <input
                    type="password"
                    value={aPin}
                    onChange={(e) => setAPin(e.target.value)}
                    placeholder="4-digit PIN"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">TOTP Secret / 6-digit</label>
                  <input
                    type="password"
                    value={aTotpSecret}
                    onChange={(e) => setATotpSecret(e.target.value)}
                    placeholder="Base32 TOTP key"
                    className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Or Direct JWT Token</label>
                <input
                  type="password"
                  value={aJwtToken}
                  onChange={(e) => setAJwtToken(e.target.value)}
                  placeholder="Optional if PIN + TOTP provided"
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1E232B] pt-3">
            <button
              type="button"
              onClick={() =>
                handleConnect('angelone', {
                  api_key: aApiKey,
                  client_id: aClientCode,
                  password_pin: aPin,
                  totp_secret: aTotpSecret,
                  access_token: aJwtToken,
                })
              }
              disabled={busyBroker === 'angelone'}
              className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300 disabled:opacity-50"
            >
              {busyBroker === 'angelone' ? 'Verifying…' : 'Connect Angel One'}
            </button>
            {aBroker?.status === 'CONNECTED' && (
              <>
                {!aBroker.is_primary && (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary('angelone')}
                    className="rounded-lg border border-[#242A34] px-2.5 py-2 text-[11px] text-slate-300 hover:text-white"
                  >
                    Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDisconnect('angelone')}
                  title="Disconnect"
                  className="rounded-lg border border-rose-500/30 p-2 text-rose-400 hover:bg-rose-500/10"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cross-Broker Portfolio & Paper Wallet */}
      <div className="rounded-xl border border-[#1E232B] bg-[#111418] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1E232B] pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'positions', label: `Live Broker Positions (${data?.live_positions.length || 0})` },
                { id: 'holdings', label: `Live Holdings (${data?.live_holdings.length || 0})` },
                { id: 'orders', label: `Live Order Book (${data?.live_orders.length || 0})` },
                { id: 'paper', label: 'Paper Trading Wallet' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-[#1C222B] text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'positions' && (
          <div>
            {!data || data.live_positions.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No open live broker positions fetched. Connect Zerodha, Dhan, or Angel One above and click{' '}
                <span className="text-slate-200 font-medium">Sync Live Portfolio</span>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E232B] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3">Broker</th>
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3">Exchange</th>
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3 text-right">Net Qty</th>
                      <th className="py-2 pr-3 text-right">Avg Price</th>
                      <th className="py-2 pr-3 text-right">LTP</th>
                      <th className="py-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181C24]">
                    {data.live_positions.map((p, i) => (
                      <tr key={i} className="hover:bg-[#151921]">
                        <td className="py-2.5 pr-3 uppercase text-amber-300">{p.broker}</td>
                        <td className="py-2.5 pr-3 font-semibold text-white">{p.symbol}</td>
                        <td className="py-2.5 pr-3 text-slate-400">{p.exchange}</td>
                        <td className="py-2.5 pr-3 text-slate-400">{p.product}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-200">{p.qty}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-300">{p.avg_price.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-200">{p.ltp.toFixed(2)}</td>
                        <td className={`py-2.5 text-right font-semibold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatINR(p.pnl, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'holdings' && (
          <div className="py-6 text-center text-xs text-slate-400">
            {data?.live_holdings.length ? (
              <pre className="max-h-64 overflow-auto text-left font-mono text-[11px] text-slate-300">
                {JSON.stringify(data.live_holdings, null, 2)}
              </pre>
            ) : (
              'No live demat holdings fetched. Connect a broker API above to stream live holdings.'
            )}
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="py-6 text-center text-xs text-slate-400">
            {data?.live_orders.length ? (
              <pre className="max-h-64 overflow-auto text-left font-mono text-[11px] text-slate-300">
                {JSON.stringify(data.live_orders, null, 2)}
              </pre>
            ) : (
              'No live broker orders found for the current session.'
            )}
          </div>
        )}

        {activeTab === 'paper' && (
          <form onSubmit={handleSavePaperCapital} className="flex flex-wrap items-end gap-4 py-2">
            <div>
              <label htmlFor="paper-cap-input" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                Paper Trading Capital (INR)
              </label>
              <input
                id="paper-cap-input"
                type="number"
                min={10000}
                step={10000}
                value={paperAmount}
                onChange={(e) => setPaperAmount(e.target.value)}
                className="w-60 rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-2 font-mono text-sm text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-[#090B0E] hover:bg-amber-300"
            >
              Update Paper Capital
            </button>
            <p className="text-xs text-slate-400">
              Paper orders fill against live NIFTY / SENSEX & INDIA VIX option pricing with full NSE/BSE statutory charges.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
