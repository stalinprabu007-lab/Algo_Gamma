export type NavRoute = 'dashboard' | 'brokers' | 'strategies' | 'backtest' | 'pnl' | 'logs';

export interface UserProfile {
  id: number;
  email: string;
  full_name: string;
  paper_capital: number;
  created_at: string;
}

export interface TickerQuote {
  label: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
}

export interface MarketSnapshot {
  market_open: boolean;
  market_status: string;
  ist_time: string;
  latency_ms: number;
  tickers: {
    NIFTY: TickerQuote;
    SENSEX: TickerQuote;
    INDIAVIX: TickerQuote;
  };
}

export interface OhlcCandle {
  ts: number;
  time: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spot_close?: number;
}

export interface OptionGreeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChainRow {
  strike: number;
  is_atm: boolean;
  ce_symbol: string;
  pe_symbol: string;
  ce: OptionGreeks;
  pe: OptionGreeks;
}

export interface OptionChainResponse {
  index_symbol: string;
  spot: number;
  atm_strike: number;
  lot_size: number;
  step: number;
  vix: number;
  expiry: string;
  rows: OptionChainRow[];
}

export interface PositionRecord {
  id: number;
  strategy_slug: string;
  broker_code: string;
  mode: 'LIVE' | 'PAPER';
  contract_symbol: string;
  index_symbol: string;
  strike: number;
  option_type: 'CE' | 'PE';
  qty: number;
  entry_price: number;
  target_price: number;
  sl_price: number;
  ltp: number;
  entry_time: string;
  status: 'OPEN' | 'CLOSED';
  exit_price: number;
  exit_time: string;
  exit_reason: string;
  realized_pnl: number;
  charges: number;
  session_date: string;
  pnl: number;
}

export interface StrategyRecord {
  id: number;
  slug: string;
  name: string;
  index_symbol: 'NIFTY' | 'SENSEX';
  filename: string;
  description: string;
  mode: 'LIVE' | 'PAPER' | 'PAUSED';
  lots: number;
  target_pct: number;
  sl_pct: number;
  timeframe: string;
  code_text: string;
  today_pnl?: number;
  net_pnl?: number;
  win_rate?: number;
  profit_factor?: number;
  trades_count?: number;
}

export interface BrokerConnection {
  broker_code: 'zerodha' | 'dhan' | 'angelone';
  display_name: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  client_id: string;
  api_key_masked: string;
  has_api_key: boolean;
  has_access_token: boolean;
  feed_latency_ms: number;
  margin_available: number;
  margin_used: number;
  is_primary: boolean;
  last_verified_at: string;
  last_error: string;
  sync_warning?: string;
}

export interface LogEntry {
  id: number;
  timestamp_ist: string;
  level: 'INFO' | 'SIGNAL' | 'ORDER' | 'EXIT' | 'WARN' | 'ERROR';
  source: string;
  message: string;
}

export interface DashboardResponse {
  user: UserProfile;
  market: MarketSnapshot;
  kpis: {
    live_pnl: number;
    live_realized: number;
    paper_pnl: number;
    trades_total: number;
    wins: number;
    losses: number;
    open_count: number;
    open_contracts: string[];
    capital_deployed: number;
    running_strategies: number;
    total_strategies: number;
  };
  positions: PositionRecord[];
  strategies: StrategyRecord[];
  logs: LogEntry[];
  equity_curve: Array<{ label: string; idx: number; equity: number }>;
  equity_total: number;
  primary_broker: {
    broker_code: string;
    display_name: string;
    status: string;
    client_id: string;
    feed_latency_ms: number;
    margin_available: number;
    margin_used: number;
  } | null;
}

export interface BacktestResult {
  strategy_slug: string;
  index_symbol: string;
  period: string;
  net_pnl: number;
  gross_pnl: number;
  total_charges: number;
  win_rate: number;
  total_trades: number;
  wins: number;
  losses: number;
  sessions_count: number;
  profit_factor: number;
  sharpe: number;
  max_drawdown: number;
  best_trade: number;
  worst_trade: number;
  equity_curve: Array<{ date: string; equity: number; drawdown: number }>;
  monthly_returns: Array<{ month: string; pnl: number }>;
  trades: Array<{
    id: number;
    date: string;
    contract: string;
    entry: number;
    entry_time: string;
    target: number;
    sl: number;
    exit: number;
    exit_time: string;
    qty: number;
    reason: string;
    gross_pnl: number;
    charges: number;
    pnl: number;
  }>;
  replay_date: string;
  replay_candles: OhlcCandle[];
  replay_contract: string;
}

export interface PnlAnalyticsResponse {
  summary: {
    today_live: number;
    today_paper: number;
    this_week: number;
    this_month: number;
    gross_pnl: number;
    net_after_charges: number;
    total_charges: number;
    total_trades: number;
  };
  daily: Array<{ date: string; pnl: number }>;
  by_strategy: Array<{ slug: string; name: string; index_symbol: string; pnl: number }>;
  by_index: Record<string, number>;
  by_type: Record<string, number>;
  charges_breakdown: {
    brokerage: number;
    stt: number;
    exchange_txn: number;
    gst: number;
    sebi_stamp: number;
  };
}
