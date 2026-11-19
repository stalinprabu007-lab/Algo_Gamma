import json
import math
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

INDEX_CONFIG = {
    "NIFTY": {"yahoo": "^NSEI", "label": "NIFTY 50", "step": 50, "lot_size": 75, "exchange": "NFO"},
    "SENSEX": {"yahoo": "^BSESN", "label": "SENSEX", "step": 100, "lot_size": 20, "exchange": "BFO"},
    "INDIAVIX": {"yahoo": "^INDIAVIX", "label": "INDIA VIX", "step": 1, "lot_size": 1, "exchange": "NSE"},
}

_CACHE: dict[str, tuple[float, object]] = {}


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def black_scholes(
    spot: float,
    strike: float,
    t_years: float,
    rate: float,
    iv: float,
    option_type: str,
) -> dict:
    """
    Computes European option price and Greeks using Black-Scholes.
    """
    if spot <= 0 or strike <= 0:
        return {"price": 0.05, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    t = max(t_years, 1.0 / (365.0 * 24.0))
    sigma = max(iv, 0.05)
    sqrt_t = math.sqrt(t)
    d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    disc = math.exp(-rate * t)
    pdf_d1 = _norm_pdf(d1)

    opt = option_type.upper()
    if opt == "CE":
        price = spot * _norm_cdf(d1) - strike * disc * _norm_cdf(d2)
        delta = _norm_cdf(d1)
        theta_annual = -(spot * pdf_d1 * sigma) / (2.0 * sqrt_t) - rate * strike * disc * _norm_cdf(d2)
    else:
        price = strike * disc * _norm_cdf(-d2) - spot * _norm_cdf(-d1)
        delta = _norm_cdf(d1) - 1.0
        theta_annual = -(spot * pdf_d1 * sigma) / (2.0 * sqrt_t) + rate * strike * disc * _norm_cdf(-d2)

    gamma = pdf_d1 / (spot * sigma * sqrt_t)
    vega = (spot * pdf_d1 * sqrt_t) / 100.0
    theta_daily = theta_annual / 365.0
    return {
        "price": round(max(0.05, price), 2),
        "delta": round(delta, 4),
        "gamma": round(gamma, 6),
        "theta": round(theta_daily, 2),
        "vega": round(vega, 2),
    }


def next_weekly_expiry(index_symbol: str, ref_dt: datetime | None = None) -> tuple[datetime, str]:
    now = ref_dt or datetime.now(IST)
    # NIFTY weekly expiry: Thursday (weekday=3); SENSEX weekly expiry: Tuesday/Friday -> use Thursday/Friday
    target_weekday = 3 if index_symbol.upper() == "NIFTY" else 4
    days_ahead = (target_weekday - now.weekday()) % 7
    if days_ahead == 0 and (now.hour > 15 or (now.hour == 15 and now.minute >= 30)):
        days_ahead = 7
    exp_date = (now + timedelta(days=days_ahead)).replace(hour=15, minute=30, second=0, microsecond=0)
    return exp_date, exp_date.strftime("%d %b %Y")


def time_to_expiry_years(index_symbol: str, ref_dt: datetime | None = None) -> float:
    now = ref_dt or datetime.now(IST)
    exp_dt, _ = next_weekly_expiry(index_symbol, now)
    seconds = max(3600.0, (exp_dt - now).total_seconds())
    return seconds / (365.0 * 24.0 * 3600.0)


def fetch_yahoo_chart(symbol: str, interval: str = "5m", range_str: str = "1d", ttl_seconds: int = 12) -> dict:
    cache_key = f"{symbol}:{interval}:{range_str}"
    now_ts = time.time()
    cached = _CACHE.get(cache_key)
    if cached and (now_ts - cached[0]) < ttl_seconds:
        return cached[1]  # type: ignore

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?interval={interval}&range={range_str}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Accept": "application/json",
        },
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=8) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    latency_ms = int((time.perf_counter() - t0) * 1000)

    result = raw["chart"]["result"][0]
    meta = result["meta"]
    timestamps = result.get("timestamp") or []
    quote = result["indicators"]["quote"][0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    candles = []
    for i, ts in enumerate(timestamps):
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        if o is None or h is None or l is None or c is None:
            continue
        dt_ist = datetime.fromtimestamp(ts, tz=IST)
        candles.append(
            {
                "ts": ts,
                "time": dt_ist.strftime("%H:%M") if range_str == "1d" else dt_ist.strftime("%Y-%m-%d %H:%M"),
                "date": dt_ist.strftime("%Y-%m-%d"),
                "open": round(float(o), 2),
                "high": round(float(h), 2),
                "low": round(float(l), 2),
                "close": round(float(c), 2),
                "volume": int(volumes[i] or 0),
            }
        )

    price = float(meta.get("regularMarketPrice") or (candles[-1]["close"] if candles else 0.0))
    prev_close = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
    change_abs = round(price - prev_close, 2)
    change_pct = round(((price - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0

    payload = {
        "symbol": symbol,
        "price": round(price, 2),
        "prev_close": round(prev_close, 2),
        "change": change_abs,
        "change_pct": change_pct,
        "candles": candles,
        "latency_ms": latency_ms,
        "fetched_at": datetime.now(IST).isoformat(),
    }
    _CACHE[cache_key] = (now_ts, payload)
    return payload


def is_indian_market_open(now_dt: datetime | None = None) -> tuple[bool, str]:
    now = now_dt or datetime.now(IST)
    if now.weekday() >= 5:
        return False, "Weekend · Next session Mon 09:15 IST"
    minutes = now.hour * 60 + now.minute
    if 9 * 60 + 15 <= minutes <= 15 * 60 + 30:
        expiry_note = "NIFTY expiry today" if now.weekday() == 3 else ("SENSEX expiry today" if now.weekday() == 4 else "NSE/BSE F&O live")
        return True, f"Market open · {expiry_note}"
    if minutes < 9 * 60 + 15:
        return False, "Pre-open · Market opens 09:15 IST"
    return False, "Post-close · Last session data live"


def get_live_market_snapshot() -> dict:
    nifty = fetch_yahoo_chart("^NSEI", interval="5m", range_str="1d", ttl_seconds=12)
    sensex = fetch_yahoo_chart("^BSESN", interval="5m", range_str="1d", ttl_seconds=12)
    vix = fetch_yahoo_chart("^INDIAVIX", interval="5m", range_str="1d", ttl_seconds=15)
    market_open, market_label = is_indian_market_open()
    return {
        "market_open": market_open,
        "market_status": market_label,
        "ist_time": datetime.now(IST).strftime("%A, %d %b %Y · %H:%M:%S IST"),
        "latency_ms": max(nifty["latency_ms"], sensex["latency_ms"]),
        "tickers": {
            "NIFTY": {
                "label": "NIFTY 50",
                "price": nifty["price"],
                "prev_close": nifty["prev_close"],
                "change": nifty["change"],
                "change_pct": nifty["change_pct"],
            },
            "SENSEX": {
                "label": "SENSEX",
                "price": sensex["price"],
                "prev_close": sensex["prev_close"],
                "change": sensex["change"],
                "change_pct": sensex["change_pct"],
            },
            "INDIAVIX": {
                "label": "INDIA VIX",
                "price": vix["price"],
                "prev_close": vix["prev_close"],
                "change": vix["change"],
                "change_pct": vix["change_pct"],
            },
        },
    }


def get_atm_strike(spot: float, index_symbol: str) -> int:
    step = INDEX_CONFIG[index_symbol.upper()]["step"]
    return int(round(spot / step) * step)


def format_contract_symbol(index_symbol: str, strike: int, option_type: str) -> str:
    return f"{index_symbol.upper()} {strike} {option_type.upper()}"


def get_live_option_chain(index_symbol: str = "NIFTY", strikes_around: int = 5) -> dict:
    idx = index_symbol.upper()
    if idx not in ("NIFTY", "SENSEX"):
        idx = "NIFTY"
    cfg = INDEX_CONFIG[idx]
    spot_data = fetch_yahoo_chart(cfg["yahoo"], interval="5m", range_str="1d", ttl_seconds=12)
    vix_data = fetch_yahoo_chart("^INDIAVIX", interval="5m", range_str="1d", ttl_seconds=15)

    spot = spot_data["price"]
    iv = max(0.09, vix_data["price"] / 100.0)
    atm = get_atm_strike(spot, idx)
    t_years = time_to_expiry_years(idx)
    _, expiry_label = next_weekly_expiry(idx)

    rows = []
    for offset in range(-strikes_around, strikes_around + 1):
        strike = atm + offset * cfg["step"]
        ce = black_scholes(spot, strike, t_years, 0.065, iv, "CE")
        pe = black_scholes(spot, strike, t_years, 0.065, iv, "PE")
        rows.append(
            {
                "strike": strike,
                "is_atm": strike == atm,
                "ce_symbol": format_contract_symbol(idx, strike, "CE"),
                "pe_symbol": format_contract_symbol(idx, strike, "PE"),
                "ce": ce,
                "pe": pe,
            }
        )
    return {
        "index_symbol": idx,
        "spot": spot,
        "atm_strike": atm,
        "lot_size": cfg["lot_size"],
        "step": cfg["step"],
        "vix": vix_data["price"],
        "expiry": expiry_label,
        "rows": rows,
    }


def get_option_ohlc_candles(
    index_symbol: str,
    strike: int | None = None,
    option_type: str = "CE",
    interval: str = "5m",
    range_str: str = "1d",
) -> dict:
    idx = index_symbol.upper()
    if idx not in ("NIFTY", "SENSEX"):
        idx = "NIFTY"
    cfg = INDEX_CONFIG[idx]
    spot_data = fetch_yahoo_chart(cfg["yahoo"], interval=interval, range_str=range_str, ttl_seconds=15)
    vix_data = fetch_yahoo_chart("^INDIAVIX", interval="5m", range_str="1d", ttl_seconds=15)

    spot = spot_data["price"]
    iv = max(0.09, vix_data["price"] / 100.0)
    resolved_strike = strike if strike else get_atm_strike(spot, idx)
    t_base = time_to_expiry_years(idx)

    spot_candles = spot_data["candles"]
    option_candles = []
    total = max(1, len(spot_candles))
    for i, c in enumerate(spot_candles):
        # Slightly higher time value earlier in the session
        t_step = t_base + ((total - 1 - i) * (5.0 / (365.0 * 24.0 * 60.0)))
        o_p = black_scholes(c["open"], resolved_strike, t_step, 0.065, iv, option_type)["price"]
        c_p = black_scholes(c["close"], resolved_strike, t_step, 0.065, iv, option_type)["price"]
        h_s = c["high"] if option_type.upper() == "CE" else c["low"]
        l_s = c["low"] if option_type.upper() == "CE" else c["high"]
        h_p = max(o_p, c_p, black_scholes(h_s, resolved_strike, t_step, 0.065, iv, option_type)["price"])
        l_p = min(o_p, c_p, black_scholes(l_s, resolved_strike, t_step, 0.065, iv, option_type)["price"])
        # Derive deterministic volume metric when Yahoo index volume is 0
        vol = c["volume"] if c["volume"] > 0 else int(abs(c["high"] - c["low"]) * 180 + 400)
        option_candles.append(
            {
                "ts": c["ts"],
                "time": c["time"],
                "date": c["date"],
                "open": round(o_p, 2),
                "high": round(h_p, 2),
                "low": round(l_p, 2),
                "close": round(c_p, 2),
                "volume": vol,
                "spot_close": c["close"],
            }
        )

    return {
        "index_symbol": idx,
        "contract_symbol": format_contract_symbol(idx, resolved_strike, option_type),
        "strike": resolved_strike,
        "option_type": option_type.upper(),
        "spot": spot,
        "vix": vix_data["price"],
        "candles": option_candles,
    }


def calculate_charges(
    entry_price: float,
    exit_price: float,
    qty: int,
    brokerage_per_order: float = 20.0,
) -> dict:
    """
    Calculates realistic Indian F&O option trading statutory charges.
    """
    buy_val = max(0.0, entry_price * qty)
    sell_val = max(0.0, exit_price * qty)
    turnover = buy_val + sell_val
    brokerage = brokerage_per_order * 2.0
    stt = round(sell_val * 0.001, 2)
    exchange_txn = round(turnover * 0.0003503, 2)
    sebi = round(turnover * 0.000001, 2)
    stamp = round(buy_val * 0.00003, 2)
    gst = round((brokerage + exchange_txn + sebi) * 0.18, 2)
    total = round(brokerage + stt + exchange_txn + sebi + stamp + gst, 2)
    return {
        "brokerage": round(brokerage, 2),
        "stt": stt,
        "exchange_txn": exchange_txn,
        "sebi": sebi,
        "stamp": stamp,
        "gst": gst,
        "total": total,
    }


def evaluate_strategy_on_candles(
    slug: str,
    candles: list[dict],
    idx_in_session: int,
    vix: float,
) -> str | None:
    """
    Deterministic signal evaluator on real spot OHLC candles.
    Returns 'CE', 'PE', or None.
    """
    if idx_in_session < 3 or len(candles) < 4:
        return None
    last = candles[-1]
    prev = candles[-2]

    if slug == "orb_breakout":
        orb_high = max(c["high"] for c in candles[:3])
        orb_low = min(c["low"] for c in candles[:3])
        if last["close"] > orb_high and prev["close"] <= orb_high:
            return "CE"
        if last["close"] < orb_low and prev["close"] >= orb_low:
            return "PE"
        return None

    if slug == "vwap_reversal":
        typical_avg = sum((c["high"] + c["low"] + c["close"]) / 3.0 for c in candles) / len(candles)
        dev = (last["close"] - typical_avg) / typical_avg if typical_avg else 0.0
        if dev > 0.0035 and last["close"] < last["open"]:
            return "PE"
        if dev < -0.0035 and last["close"] > last["open"]:
            return "CE"
        return None

    if slug == "ema_cross":
        if len(candles) < 22:
            return None
        closes = [c["close"] for c in candles]
        ema9 = sum(closes[-9:]) / 9.0
        ema21 = sum(closes[-21:]) / 21.0
        prev_ema9 = sum(closes[-10:-1]) / 9.0
        prev_ema21 = sum(closes[-22:-1]) / 21.0
        if ema9 > ema21 and prev_ema9 <= prev_ema21:
            return "CE"
        if ema9 < ema21 and prev_ema9 >= prev_ema21:
            return "PE"
        return None

    if slug == "expiry_gamma":
        if len(candles) < 8:
            return None
        avg_rng = sum(c["high"] - c["low"] for c in candles[-8:-1]) / 7.0
        cur_rng = last["high"] - last["low"]
        if avg_rng > 0 and cur_rng > avg_rng * 1.65:
            return "CE" if last["close"] > last["open"] else "PE"
        return None

    # Default / supertrend_momo / custom uploaded .py
    if len(candles) < 10:
        return None
    atr = sum(c["high"] - c["low"] for c in candles[-10:]) / 10.0
    hl2 = (last["high"] + last["low"]) / 2.0
    if last["close"] > hl2 + atr * 0.55 and prev["close"] <= (prev["high"] + prev["low"]) / 2.0 + atr * 0.55:
        return "CE"
    if last["close"] < hl2 - atr * 0.55 and prev["close"] >= (prev["high"] + prev["low"]) / 2.0 - atr * 0.55:
        return "PE"
    return None


def run_backtest(
    strategy_slug: str,
    index_symbol: str,
    period: str = "3M",
    target_pct: float = 30.0,
    sl_pct: float = 15.0,
    lots: int = 2,
    slippage_pts: float = 0.5,
    brokerage_per_order: float = 20.0,
) -> dict:
    """
    Runs a deterministic backtest over REAL historical NSE/BSE & India VIX candles.
    """
    idx = index_symbol.upper()
    if idx not in ("NIFTY", "SENSEX"):
        idx = "NIFTY"
    cfg = INDEX_CONFIG[idx]
    qty = max(1, lots) * cfg["lot_size"]

    period_map = {
        "1M": ("1mo", "15m"),
        "3M": ("3mo", "1h"),
        "6M": ("6mo", "1h"),
        "1Y": ("1y", "1d"),
    }
    range_str, interval = period_map.get(period.upper(), ("3mo", "1h"))
    spot_hist = fetch_yahoo_chart(cfg["yahoo"], interval=interval, range_str=range_str, ttl_seconds=60)
    vix_hist = fetch_yahoo_chart("^INDIAVIX", interval="1d", range_str=range_str, ttl_seconds=60)
    vix_by_date = {c["date"]: c["close"] for c in vix_hist["candles"]}
    default_vix = vix_hist["price"] or 14.5

    candles = spot_hist["candles"]
    # Group candles by trading date for session-level ORB/VWAP evaluation
    sessions: dict[str, list[dict]] = {}
    for c in candles:
        sessions.setdefault(c["date"], []).append(c)

    trades = []
    equity_curve = []
    monthly_map: dict[str, float] = {}
    cumulative_net = 0.0
    peak_equity = 0.0
    max_drawdown = 0.0
    total_gross = 0.0
    total_charges = 0.0

    # For 1Y daily interval, treat sliding 5-day windows; for intraday intervals, step per session
    if interval == "1d":
        for i in range(5, len(candles) - 1):
            c_prev = candles[i - 1]
            c_cur = candles[i]
            c_next = candles[i + 1]
            vix_val = vix_by_date.get(c_cur["date"], default_vix)
            iv = max(0.09, vix_val / 100.0)
            # Breakout / Trend trigger on daily bars
            opt_type = "CE" if c_cur["close"] > c_prev["high"] else ("PE" if c_cur["close"] < c_prev["low"] else None)
            if not opt_type:
                continue
            strike = get_atm_strike(c_cur["close"], idx)
            entry_opt = black_scholes(c_cur["close"], strike, 4.0 / 365.0, 0.065, iv, opt_type)["price"] + slippage_pts
            tgt_price = round(entry_opt * (1.0 + target_pct / 100.0), 2)
            sl_price = round(max(0.05, entry_opt * (1.0 - sl_pct / 100.0)), 2)

            high_spot = c_next["high"] if opt_type == "CE" else c_next["low"]
            low_spot = c_next["low"] if opt_type == "CE" else c_next["high"]
            hi_opt = black_scholes(high_spot, strike, 3.0 / 365.0, 0.065, iv, opt_type)["price"]
            lo_opt = black_scholes(low_spot, strike, 3.0 / 365.0, 0.065, iv, opt_type)["price"]
            cl_opt = black_scholes(c_next["close"], strike, 3.0 / 365.0, 0.065, iv, opt_type)["price"]

            if lo_opt <= sl_price:
                exit_opt = sl_price
                reason = "SL"
            elif hi_opt >= tgt_price:
                exit_opt = tgt_price
                reason = "TARGET"
            else:
                exit_opt = max(0.05, cl_opt - slippage_pts)
                reason = "TIME"

            gross = round((exit_opt - entry_opt) * qty, 2)
            chg = calculate_charges(entry_opt, exit_opt, qty, brokerage_per_order)["total"]
            net = round(gross - chg, 2)
            cumulative_net = round(cumulative_net + net, 2)
            total_gross += gross
            total_charges += chg
            peak_equity = max(peak_equity, cumulative_net)
            dd = round(cumulative_net - peak_equity, 2)
            max_drawdown = min(max_drawdown, dd)

            month_key = c_cur["date"][:7]
            monthly_map[month_key] = round(monthly_map.get(month_key, 0.0) + net, 2)
            equity_curve.append({"date": c_cur["date"], "equity": cumulative_net, "drawdown": dd})
            trades.append(
                {
                    "id": len(trades) + 1,
                    "date": c_cur["date"],
                    "contract": format_contract_symbol(idx, strike, opt_type),
                    "entry": round(entry_opt, 2),
                    "entry_time": "09:30",
                    "target": tgt_price,
                    "sl": sl_price,
                    "exit": round(exit_opt, 2),
                    "exit_time": "15:15",
                    "qty": qty,
                    "reason": reason,
                    "gross_pnl": gross,
                    "charges": chg,
                    "pnl": net,
                }
            )
    else:
        for sess_date, sess_candles in sessions.items():
            if len(sess_candles) < 5:
                continue
            vix_val = vix_by_date.get(sess_date, default_vix)
            iv = max(0.09, vix_val / 100.0)
            in_trade = False
            for idx_bar in range(3, len(sess_candles) - 1):
                if in_trade:
                    continue
                window = sess_candles[: idx_bar + 1]
                sig = evaluate_strategy_on_candles(strategy_slug, window, idx_bar, vix_val)
                if not sig:
                    continue
                in_trade = True
                entry_bar = sess_candles[idx_bar]
                strike = get_atm_strike(entry_bar["close"], idx)
                entry_opt = round(
                    black_scholes(entry_bar["close"], strike, 3.0 / 365.0, 0.065, iv, sig)["price"] + slippage_pts,
                    2,
                )
                tgt_price = round(entry_opt * (1.0 + target_pct / 100.0), 2)
                sl_price = round(max(0.05, entry_opt * (1.0 - sl_pct / 100.0)), 2)

                exit_opt = entry_opt
                exit_time = sess_candles[-1]["time"].split(" ")[-1]
                reason = "TIME"
                for fwd in sess_candles[idx_bar + 1 :]:
                    h_spot = fwd["high"] if sig == "CE" else fwd["low"]
                    l_spot = fwd["low"] if sig == "CE" else fwd["high"]
                    hi_opt = black_scholes(h_spot, strike, 3.0 / 365.0, 0.065, iv, sig)["price"]
                    lo_opt = black_scholes(l_spot, strike, 3.0 / 365.0, 0.065, iv, sig)["price"]
                    if lo_opt <= sl_price:
                        exit_opt = sl_price
                        exit_time = fwd["time"].split(" ")[-1]
                        reason = "SL"
                        break
                    if hi_opt >= tgt_price:
                        exit_opt = tgt_price
                        exit_time = fwd["time"].split(" ")[-1]
                        reason = "TARGET"
                        break
                else:
                    last_c = sess_candles[-1]
                    exit_opt = max(
                        0.05,
                        round(black_scholes(last_c["close"], strike, 3.0 / 365.0, 0.065, iv, sig)["price"] - slippage_pts, 2),
                    )

                gross = round((exit_opt - entry_opt) * qty, 2)
                chg = calculate_charges(entry_opt, exit_opt, qty, brokerage_per_order)["total"]
                net = round(gross - chg, 2)
                cumulative_net = round(cumulative_net + net, 2)
                total_gross += gross
                total_charges += chg
                peak_equity = max(peak_equity, cumulative_net)
                dd = round(cumulative_net - peak_equity, 2)
                max_drawdown = min(max_drawdown, dd)

                month_key = sess_date[:7]
                monthly_map[month_key] = round(monthly_map.get(month_key, 0.0) + net, 2)
                equity_curve.append({"date": sess_date, "equity": cumulative_net, "drawdown": dd})
                trades.append(
                    {
                        "id": len(trades) + 1,
                        "date": sess_date,
                        "contract": format_contract_symbol(idx, strike, sig),
                        "entry": entry_opt,
                        "entry_time": entry_bar["time"].split(" ")[-1],
                        "target": tgt_price,
                        "sl": sl_price,
                        "exit": exit_opt,
                        "exit_time": exit_time,
                        "qty": qty,
                        "reason": reason,
                        "gross_pnl": gross,
                        "charges": chg,
                        "pnl": net,
                    }
                )

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    win_rate = round((len(wins) / len(trades)) * 100.0, 1) if trades else 0.0
    gross_wins = sum(t["pnl"] for t in wins)
    gross_losses = abs(sum(t["pnl"] for t in losses))
    profit_factor = round(gross_wins / gross_losses, 2) if gross_losses > 0 else (round(gross_wins, 2) if gross_wins > 0 else 0.0)

    # Sharpe approximation from trade returns
    if len(trades) > 1:
        pnls = [t["pnl"] for t in trades]
        mean_p = sum(pnls) / len(pnls)
        var_p = sum((p - mean_p) ** 2 for p in pnls) / (len(pnls) - 1)
        std_p = math.sqrt(var_p)
        sharpe = round((mean_p / std_p) * math.sqrt(len(pnls)), 2) if std_p > 0 else 0.0
    else:
        sharpe = 0.0

    best_trade = round(max((t["pnl"] for t in trades), default=0.0), 2)
    worst_trade = round(min((t["pnl"] for t in trades), default=0.0), 2)

    replay_date = trades[-1]["date"] if trades else (candles[-1]["date"] if candles else "")
    replay_opt = get_option_ohlc_candles(idx, None, "CE", interval="5m", range_str="1d")

    return {
        "strategy_slug": strategy_slug,
        "index_symbol": idx,
        "period": period.upper(),
        "net_pnl": round(cumulative_net, 2),
        "gross_pnl": round(total_gross, 2),
        "total_charges": round(total_charges, 2),
        "win_rate": win_rate,
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "sessions_count": len(sessions),
        "profit_factor": profit_factor,
        "sharpe": sharpe,
        "max_drawdown": round(max_drawdown, 2),
        "best_trade": best_trade,
        "worst_trade": worst_trade,
        "equity_curve": equity_curve,
        "monthly_returns": [{"month": k, "pnl": v} for k, v in sorted(monthly_map.items())],
        "trades": trades[-50:][::-1],
        "replay_date": replay_date,
        "replay_candles": replay_opt["candles"],
        "replay_contract": replay_opt["contract_symbol"],
    }
