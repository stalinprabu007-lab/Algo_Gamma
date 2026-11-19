import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db
import market_data
import brokers


def _mask_secret(val: str) -> str:
    if not val:
        return ""
    if len(val) <= 6:
        return "*" * len(val)
    return val[:3] + "•" * (len(val) - 6) + val[-3:]


def _get_bearer_token(headers) -> str:
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return ""


def _mark_to_market_paper_positions(conn, user_id: int) -> None:
    """
    Updates LTP of all OPEN paper positions using real live spot + India VIX Black-Scholes pricing.
    Also auto-triggers TARGET or SL exits when live LTP crosses bracket levels.
    """
    open_rows = conn.execute(
        "SELECT * FROM positions WHERE user_id = ? AND status = 'OPEN' AND mode = 'PAPER'",
        (user_id,),
    ).fetchall()
    if not open_rows:
        return

    snap = market_data.get_live_market_snapshot()
    vix = max(9.0, float(snap["tickers"]["INDIAVIX"]["price"]))
    iv = vix / 100.0
    now_time_str = db.now_ist().strftime("%H:%M")

    for row in open_rows:
        idx = row["index_symbol"]
        spot = float(snap["tickers"][idx]["price"])
        t_years = market_data.time_to_expiry_years(idx)
        bs = market_data.black_scholes(spot, float(row["strike"]), t_years, 0.065, iv, row["option_type"])
        live_ltp = bs["price"]

        target_p = float(row["target_price"])
        sl_p = float(row["sl_price"])
        hit_reason = ""
        exit_p = live_ltp

        if target_p > 0 and live_ltp >= target_p:
            hit_reason = "TARGET"
            exit_p = target_p
        elif sl_p > 0 and live_ltp <= sl_p:
            hit_reason = "SL"
            exit_p = sl_p

        if hit_reason:
            chg = market_data.calculate_charges(float(row["entry_price"]), exit_p, int(row["qty"]))["total"]
            gross = (exit_p - float(row["entry_price"])) * int(row["qty"])
            net = round(gross - chg, 2)
            conn.execute(
                """
                UPDATE positions
                SET ltp = ?, status = 'CLOSED', exit_price = ?, exit_time = ?, exit_reason = ?, realized_pnl = ?, charges = ?
                WHERE id = ?
                """,
                (exit_p, exit_p, now_time_str, hit_reason, net, chg, row["id"]),
            )
            conn.execute(
                "UPDATE users SET paper_capital = paper_capital + ? WHERE id = ?",
                (round((exit_p * int(row["qty"])) - chg, 2), user_id),
            )
            db.add_log(
                conn,
                user_id,
                "EXIT",
                row["strategy_slug"],
                f"{'Target' if hit_reason == 'TARGET' else 'Stop-loss'} hit @ {exit_p:.2f} · {row['contract_symbol']} · Net P&L {'+' if net >= 0 else ''}₹{net:,.2f}",
            )
        else:
            conn.execute("UPDATE positions SET ltp = ? WHERE id = ?", (live_ltp, row["id"]))


def _fetch_live_broker_data(conn, user_id: int) -> dict:
    rows = conn.execute(
        "SELECT * FROM broker_connections WHERE user_id = ? ORDER BY is_primary DESC, id ASC",
        (user_id,),
    ).fetchall()
    broker_list = []
    live_positions = []
    live_holdings = []
    live_orders = []

    for r in rows:
        item = {
            "broker_code": r["broker_code"],
            "display_name": r["display_name"],
            "status": r["status"],
            "client_id": r["client_id"],
            "api_key_masked": _mask_secret(r["api_key"]),
            "has_api_key": bool(r["api_key"]),
            "has_access_token": bool(r["access_token"]),
            "feed_latency_ms": r["feed_latency_ms"],
            "margin_available": r["margin_available"],
            "margin_used": r["margin_used"],
            "is_primary": bool(r["is_primary"]),
            "last_verified_at": r["last_verified_at"],
            "last_error": r["last_error"],
        }
        broker_list.append(item)
        if r["status"] == "CONNECTED" and r["access_token"]:
            try:
                if r["broker_code"] == "zerodha":
                    client = brokers.ZerodhaKiteClient(r["api_key"], r["access_token"])
                elif r["broker_code"] == "dhan":
                    client = brokers.DhanHQClient(r["client_id"], r["access_token"])
                else:
                    client = brokers.AngelOneClient(r["api_key"], r["access_token"])
                live_positions.extend(client.get_positions())
                live_holdings.extend(client.get_holdings())
                live_orders.extend(client.get_orders())
            except Exception as exc:
                item["sync_warning"] = str(exc)

    return {
        "brokers": broker_list,
        "live_positions": live_positions,
        "live_holdings": live_holdings,
        "live_orders": live_orders,
    }


def _place_order_core(conn, user_id: int, body: dict) -> dict:
    mode = str(body.get("mode", "PAPER")).upper()
    if mode not in ("PAPER", "LIVE"):
        raise ValueError("Mode must be PAPER or LIVE")

    index_symbol = str(body.get("index_symbol", "NIFTY")).upper()
    if index_symbol not in ("NIFTY", "SENSEX"):
        raise ValueError("Index must be NIFTY or SENSEX")

    option_type = str(body.get("option_type", "CE")).upper()
    if option_type not in ("CE", "PE"):
        raise ValueError("Option type must be CE or PE")

    side = str(body.get("side", "BUY")).upper()
    if side not in ("BUY", "SELL"):
        raise ValueError("Side must be BUY or SELL")

    order_type = str(body.get("order_type", "MARKET")).upper()
    if order_type not in ("MARKET", "LIMIT", "SL-M"):
        raise ValueError("Order type must be MARKET, LIMIT, or SL-M")

    lots = int(body.get("lots", 1))
    if lots <= 0 or lots > 100:
        raise ValueError("Lots must be between 1 and 100")

    lot_size = market_data.INDEX_CONFIG[index_symbol]["lot_size"]
    qty = lots * lot_size
    strategy_slug = str(body.get("strategy_slug", "manual"))
    broker_code = str(body.get("broker_code", "paper" if mode == "PAPER" else "zerodha")).lower()

    snap = market_data.get_live_market_snapshot()
    spot = float(snap["tickers"][index_symbol]["price"])
    vix = max(9.0, float(snap["tickers"]["INDIAVIX"]["price"]))
    strike = int(body.get("strike") or market_data.get_atm_strike(spot, index_symbol))
    contract_symbol = market_data.format_contract_symbol(index_symbol, strike, option_type)

    t_years = market_data.time_to_expiry_years(index_symbol)
    live_opt = market_data.black_scholes(spot, strike, t_years, 0.065, vix / 100.0, option_type)["price"]
    exec_price = float(body.get("price") or 0.0) if order_type == "LIMIT" else live_opt
    if exec_price <= 0:
        exec_price = live_opt

    target_pct = float(body.get("target_pct", 30.0))
    sl_pct = float(body.get("sl_pct", 15.0))
    target_price = float(body.get("target_price") or round(exec_price * (1.0 + target_pct / 100.0), 2))
    sl_price = float(body.get("sl_price") or round(max(0.05, exec_price * (1.0 - sl_pct / 100.0)), 2))

    ts_iso = db.now_ist_iso()
    today_date = db.now_ist().strftime("%Y-%m-%d")
    time_hm = db.now_ist().strftime("%H:%M")

    if mode == "LIVE":
        b_row = conn.execute(
            "SELECT * FROM broker_connections WHERE user_id = ? AND broker_code = ?",
            (user_id, broker_code),
        ).fetchone()
        if not b_row or b_row["status"] != "CONNECTED" or not b_row["access_token"]:
            raise RuntimeError(f"Broker '{broker_code}' is not connected. Connect live API credentials in Brokers & API first.")

        exchange = market_data.INDEX_CONFIG[index_symbol]["exchange"]
        tradingsymbol = str(body.get("broker_symbol") or contract_symbol.replace(" ", ""))
        if broker_code == "zerodha":
            client = brokers.ZerodhaKiteClient(b_row["api_key"], b_row["access_token"])
            res = client.place_order(exchange, tradingsymbol, side, qty, order_type, exec_price)
        elif broker_code == "dhan":
            security_id = str(body.get("security_id") or "")
            if not security_id:
                raise RuntimeError("Dhan HQ requires a valid exchange securityId for live option execution.")
            client = brokers.DhanHQClient(b_row["client_id"], b_row["access_token"])
            res = client.place_order("NSE_FNO" if exchange == "NFO" else "BSE_FNO", security_id, side, qty, order_type, exec_price)
        else:
            symbol_token = str(body.get("symbol_token") or "")
            if not symbol_token:
                raise RuntimeError("Angel One SmartAPI requires a valid symboltoken for live option execution.")
            client = brokers.AngelOneClient(b_row["api_key"], b_row["access_token"])
            res = client.place_order(exchange, tradingsymbol, symbol_token, side, qty, order_type, exec_price)

        broker_order_id = res["order_id"]
        conn.execute(
            """
            INSERT INTO orders (user_id, strategy_slug, broker_code, mode, contract_symbol, index_symbol, strike, option_type, side, order_type, qty, price, target_price, sl_price, status, broker_order_id, created_at)
            VALUES (?, ?, ?, 'LIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?, ?)
            """,
            (user_id, strategy_slug, broker_code, contract_symbol, index_symbol, strike, option_type, side, order_type, qty, exec_price, target_price, sl_price, broker_order_id, ts_iso),
        )
        conn.execute(
            """
            INSERT INTO positions (user_id, strategy_slug, broker_code, mode, contract_symbol, index_symbol, strike, option_type, qty, entry_price, target_price, sl_price, ltp, entry_time, status, session_date, created_at)
            VALUES (?, ?, ?, 'LIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
            """,
            (user_id, strategy_slug, broker_code, contract_symbol, index_symbol, strike, option_type, qty, exec_price, target_price, sl_price, live_opt, time_hm, today_date, ts_iso),
        )
        db.add_log(
            conn,
            user_id,
            "ORDER",
            strategy_slug,
            f"[{broker_code.upper()}] {side} {qty} {contract_symbol} @ {exec_price:.2f} · {order_type} · #{broker_order_id}",
        )
        return {"status": "COMPLETE", "broker_order_id": broker_order_id, "price": exec_price, "qty": qty}

    # PAPER execution against live market price
    user_row = conn.execute("SELECT paper_capital FROM users WHERE id = ?", (user_id,)).fetchone()
    required_margin = round(exec_price * qty, 2)
    if side == "BUY" and float(user_row["paper_capital"]) < required_margin:
        raise RuntimeError(f"Insufficient paper margin: required ₹{required_margin:,.2f}, available ₹{float(user_row['paper_capital']):,.2f}")

    paper_order_id = f"PPR{int(db.now_ist().timestamp()) % 10000000}"
    if side == "BUY":
        conn.execute("UPDATE users SET paper_capital = paper_capital - ? WHERE id = ?", (required_margin, user_id))

    conn.execute(
        """
        INSERT INTO orders (user_id, strategy_slug, broker_code, mode, contract_symbol, index_symbol, strike, option_type, side, order_type, qty, price, target_price, sl_price, status, broker_order_id, created_at)
        VALUES (?, ?, 'paper', 'PAPER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?, ?)
        """,
        (user_id, strategy_slug, contract_symbol, index_symbol, strike, option_type, side, order_type, qty, exec_price, target_price, sl_price, paper_order_id, ts_iso),
    )
    conn.execute(
        """
        INSERT INTO positions (user_id, strategy_slug, broker_code, mode, contract_symbol, index_symbol, strike, option_type, qty, entry_price, target_price, sl_price, ltp, entry_time, status, session_date, created_at)
        VALUES (?, ?, 'paper', 'PAPER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
        """,
        (user_id, strategy_slug, contract_symbol, index_symbol, strike, option_type, qty, exec_price, target_price, sl_price, live_opt, time_hm, today_date, ts_iso),
    )
    db.add_log(
        conn,
        user_id,
        "ORDER",
        strategy_slug,
        f"[PAPER] {side} {qty} {contract_symbol} @ {exec_price:.2f} · {order_type} · #{paper_order_id} · SL {sl_price:.2f} · TGT {target_price:.2f}",
    )
    return {"status": "COMPLETE", "broker_order_id": paper_order_id, "price": exec_price, "qty": qty, "contract_symbol": contract_symbol}


class RequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        pass

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def _require_user(self) -> dict | None:
        token = _get_bearer_token(self.headers)
        user = db.get_user_by_token(token)
        if not user:
            self._send_json(401, {"error": "Authentication required"})
            return None
        return user

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                self._send_json(200, {"ok": True, "engine": "python-3.11"})
                return

            if path == "/api/market/snapshot":
                self._send_json(200, market_data.get_live_market_snapshot())
                return

            if path == "/api/market/option-chain":
                idx = qs.get("index", ["NIFTY"])[0]
                self._send_json(200, market_data.get_live_option_chain(idx))
                return

            if path == "/api/market/candles":
                idx = qs.get("index", ["NIFTY"])[0]
                strike_raw = qs.get("strike", [None])[0]
                strike = int(strike_raw) if strike_raw else None
                opt_type = qs.get("option_type", ["CE"])[0]
                interval = qs.get("interval", ["5m"])[0]
                rng = qs.get("range", ["1d"])[0]
                self._send_json(200, market_data.get_option_ohlc_candles(idx, strike, opt_type, interval, rng))
                return

            if path == "/api/brokers/zerodha/login-url":
                api_key = qs.get("api_key", [""])[0]
                if not api_key:
                    self._send_json(400, {"error": "api_key is required"})
                    return
                self._send_json(200, {"url": brokers.ZerodhaKiteClient.login_url(api_key)})
                return

            user = self._require_user()
            if not user:
                return
            user_id = user["id"]

            if path == "/api/auth/me":
                self._send_json(200, {"user": user})
                return

            if path == "/api/dashboard":
                conn = db.get_conn()
                try:
                    _mark_to_market_paper_positions(conn, user_id)
                    conn.commit()

                    snap = market_data.get_live_market_snapshot()
                    user_fresh = dict(conn.execute("SELECT id, email, full_name, paper_capital, created_at FROM users WHERE id = ?", (user_id,)).fetchone())
                    positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()]
                    strategies = [dict(r) for r in conn.execute("SELECT * FROM strategies WHERE user_id = ? ORDER BY id ASC", (user_id,)).fetchall()]
                    logs = [dict(r) for r in conn.execute("SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 30", (user_id,)).fetchall()]
                    primary_broker = conn.execute(
                        "SELECT broker_code, display_name, status, client_id, feed_latency_ms, margin_available, margin_used FROM broker_connections WHERE user_id = ? ORDER BY status = 'CONNECTED' DESC, is_primary DESC LIMIT 1",
                        (user_id,),
                    ).fetchone()

                    today = db.now_ist().strftime("%Y-%m-%d")
                    live_pnl = 0.0
                    live_realized = 0.0
                    paper_pnl = 0.0
                    today_trades = [p for p in positions if p["session_date"] == today]
                    open_positions = [p for p in positions if p["status"] == "OPEN"]
                    closed_today = [p for p in today_trades if p["status"] == "CLOSED"]

                    for p in positions:
                        mtm = (float(p["ltp"]) - float(p["entry_price"])) * int(p["qty"]) if p["status"] == "OPEN" else float(p["realized_pnl"])
                        p["pnl"] = round(mtm, 2)
                        if p["session_date"] == today:
                            if p["mode"] == "LIVE":
                                live_pnl += mtm
                                if p["status"] == "CLOSED":
                                    live_realized += float(p["realized_pnl"])
                            else:
                                paper_pnl += mtm

                    wins = sum(1 for p in closed_today if float(p["realized_pnl"]) > 0)
                    losses = sum(1 for p in closed_today if float(p["realized_pnl"]) <= 0)
                    capital_deployed = sum(float(p["entry_price"]) * int(p["qty"]) for p in open_positions)
                    running_strats = sum(1 for s in strategies if s["mode"] in ("LIVE", "PAPER"))

                    # Strategy P&L aggregation
                    strat_pnl: dict[str, float] = {}
                    for p in today_trades:
                        strat_pnl[p["strategy_slug"]] = round(strat_pnl.get(p["strategy_slug"], 0.0) + float(p["pnl"]), 2)
                    for s in strategies:
                        s["today_pnl"] = strat_pnl.get(s["slug"], 0.0)

                    # Equity curve from closed positions chronologically
                    closed_all = sorted([p for p in positions if p["status"] == "CLOSED"], key=lambda x: x["id"])
                    eq_points = []
                    running_eq = 0.0
                    for idx_p, cp in enumerate(closed_all):
                        running_eq = round(running_eq + float(cp["realized_pnl"]), 2)
                        eq_points.append({"label": cp["session_date"], "idx": idx_p + 1, "equity": running_eq})

                    self._send_json(
                        200,
                        {
                            "user": user_fresh,
                            "market": snap,
                            "kpis": {
                                "live_pnl": round(live_pnl, 2),
                                "live_realized": round(live_realized, 2),
                                "paper_pnl": round(paper_pnl, 2),
                                "trades_total": len(today_trades),
                                "wins": wins,
                                "losses": losses,
                                "open_count": len(open_positions),
                                "open_contracts": [p["contract_symbol"] for p in open_positions[:3]],
                                "capital_deployed": round(capital_deployed, 2),
                                "running_strategies": running_strats,
                                "total_strategies": len(strategies),
                            },
                            "positions": positions,
                            "strategies": strategies,
                            "logs": logs,
                            "equity_curve": eq_points,
                            "equity_total": round(running_eq, 2),
                            "primary_broker": dict(primary_broker) if primary_broker else None,
                        },
                    )
                finally:
                    conn.close()
                return

            if path == "/api/brokers":
                conn = db.get_conn()
                try:
                    data = _fetch_live_broker_data(conn, user_id)
                    self._send_json(200, data)
                finally:
                    conn.close()
                return

            if path == "/api/strategies":
                conn = db.get_conn()
                try:
                    _mark_to_market_paper_positions(conn, user_id)
                    conn.commit()
                    strategies = [dict(r) for r in conn.execute("SELECT * FROM strategies WHERE user_id = ? ORDER BY id ASC", (user_id,)).fetchall()]
                    positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE user_id = ?", (user_id,)).fetchall()]
                    today = db.now_ist().strftime("%Y-%m-%d")
                    for s in strategies:
                        s_pos = [p for p in positions if p["strategy_slug"] == s["slug"]]
                        s_today = [p for p in s_pos if p["session_date"] == today]
                        s_closed = [p for p in s_pos if p["status"] == "CLOSED"]
                        s["today_pnl"] = round(
                            sum(
                                ((float(p["ltp"]) - float(p["entry_price"])) * int(p["qty"]) if p["status"] == "OPEN" else float(p["realized_pnl"]))
                                for p in s_today
                            ),
                            2,
                        )
                        s["net_pnl"] = round(sum(float(p["realized_pnl"]) for p in s_closed), 2)
                        s_wins = [p for p in s_closed if float(p["realized_pnl"]) > 0]
                        s_losses = [p for p in s_closed if float(p["realized_pnl"]) <= 0]
                        s["win_rate"] = round((len(s_wins) / len(s_closed)) * 100.0, 1) if s_closed else 0.0
                        gw = sum(float(p["realized_pnl"]) for p in s_wins)
                        gl = abs(sum(float(p["realized_pnl"]) for p in s_losses))
                        s["profit_factor"] = round(gw / gl, 2) if gl > 0 else (round(gw, 2) if gw > 0 else 0.0)
                        s["trades_count"] = len(s_pos)
                    self._send_json(200, {"strategies": strategies})
                finally:
                    conn.close()
                return

            if path == "/api/analytics/pnl":
                conn = db.get_conn()
                try:
                    _mark_to_market_paper_positions(conn, user_id)
                    conn.commit()
                    positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE user_id = ? ORDER BY id ASC", (user_id,)).fetchall()]
                    strategies = [dict(r) for r in conn.execute("SELECT slug, name, index_symbol FROM strategies WHERE user_id = ?", (user_id,)).fetchall()]
                    strat_names = {s["slug"]: s for s in strategies}

                    today = db.now_ist().strftime("%Y-%m-%d")
                    week_start = (db.now_ist() - market_data.timedelta(days=db.now_ist().weekday())).strftime("%Y-%m-%d")
                    month_prefix = today[:7]

                    today_live = 0.0
                    today_paper = 0.0
                    week_pnl = 0.0
                    month_pnl = 0.0
                    total_gross = 0.0
                    total_charges = 0.0
                    total_net = 0.0

                    daily_map: dict[str, float] = {}
                    by_strategy: dict[str, float] = {s["slug"]: 0.0 for s in strategies}
                    by_index = {"NIFTY": 0.0, "SENSEX": 0.0}
                    by_type = {"CE": 0.0, "PE": 0.0}

                    chg_brokerage = 0.0
                    chg_stt = 0.0
                    chg_exchange = 0.0
                    chg_sebi = 0.0
                    chg_stamp = 0.0
                    chg_gst = 0.0

                    for p in positions:
                        mtm = (float(p["ltp"]) - float(p["entry_price"])) * int(p["qty"]) if p["status"] == "OPEN" else float(p["realized_pnl"])
                        if p["session_date"] == today:
                            if p["mode"] == "LIVE":
                                today_live += mtm
                            else:
                                today_paper += mtm
                        if p["session_date"] >= week_start:
                            week_pnl += mtm
                        if p["session_date"].startswith(month_prefix):
                            month_pnl += mtm

                        if p["status"] == "CLOSED":
                            gross = (float(p["exit_price"]) - float(p["entry_price"])) * int(p["qty"])
                            bd = market_data.calculate_charges(float(p["entry_price"]), float(p["exit_price"]), int(p["qty"]))
                            total_gross += gross
                            total_charges += bd["total"]
                            total_net += float(p["realized_pnl"])
                            chg_brokerage += bd["brokerage"]
                            chg_stt += bd["stt"]
                            chg_exchange += bd["exchange_txn"]
                            chg_sebi += bd["sebi"]
                            chg_stamp += bd["stamp"]
                            chg_gst += bd["gst"]

                        daily_map[p["session_date"]] = round(daily_map.get(p["session_date"], 0.0) + mtm, 2)
                        by_strategy[p["strategy_slug"]] = round(by_strategy.get(p["strategy_slug"], 0.0) + mtm, 2)
                        if p["index_symbol"] in by_index:
                            by_index[p["index_symbol"]] = round(by_index[p["index_symbol"]] + mtm, 2)
                        if p["option_type"] in by_type:
                            by_type[p["option_type"]] = round(by_type[p["option_type"]] + mtm, 2)

                    strat_breakdown = [
                        {
                            "slug": slug,
                            "name": strat_names.get(slug, {}).get("name", slug),
                            "index_symbol": strat_names.get(slug, {}).get("index_symbol", "NIFTY"),
                            "pnl": val,
                        }
                        for slug, val in by_strategy.items()
                    ]
                    strat_breakdown.sort(key=lambda x: x["pnl"], reverse=True)

                    self._send_json(
                        200,
                        {
                            "summary": {
                                "today_live": round(today_live, 2),
                                "today_paper": round(today_paper, 2),
                                "this_week": round(week_pnl, 2),
                                "this_month": round(month_pnl, 2),
                                "gross_pnl": round(total_gross, 2),
                                "net_after_charges": round(total_net, 2),
                                "total_charges": round(total_charges, 2),
                                "total_trades": len(positions),
                            },
                            "daily": [{"date": k, "pnl": v} for k, v in sorted(daily_map.items())],
                            "by_strategy": strat_breakdown,
                            "by_index": by_index,
                            "by_type": by_type,
                            "charges_breakdown": {
                                "brokerage": round(chg_brokerage, 2),
                                "stt": round(chg_stt, 2),
                                "exchange_txn": round(chg_exchange, 2),
                                "gst": round(chg_gst, 2),
                                "sebi_stamp": round(chg_sebi + chg_stamp, 2),
                            },
                        },
                    )
                finally:
                    conn.close()
                return

            if path == "/api/logs":
                level = qs.get("level", ["ALL"])[0].upper()
                source = qs.get("source", ["ALL"])[0]
                q_str = qs.get("q", [""])[0].strip().lower()
                conn = db.get_conn()
                try:
                    rows = [dict(r) for r in conn.execute("SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 300", (user_id,)).fetchall()]
                    counts = {"INFO": 0, "SIGNAL": 0, "ORDER": 0, "EXIT": 0, "WARN": 0, "ERROR": 0}
                    sources = set()
                    filtered = []
                    for r in rows:
                        lvl = r["level"].upper()
                        if lvl in counts:
                            counts[lvl] += 1
                        sources.add(r["source"])
                        if level != "ALL" and lvl != level:
                            continue
                        if source != "ALL" and r["source"] != source:
                            continue
                        if q_str and q_str not in r["message"].lower() and q_str not in r["source"].lower():
                            continue
                        filtered.append(r)
                    self._send_json(200, {"logs": filtered, "counts": counts, "sources": sorted(sources)})
                finally:
                    conn.close()
                return

            self._send_json(404, {"error": f"Unknown endpoint {path}"})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json()

            if path == "/api/auth/register":
                res = db.create_user(
                    str(body.get("email", "")),
                    str(body.get("full_name", "")),
                    str(body.get("password", "")),
                )
                self._send_json(201, res)
                return

            if path == "/api/auth/login":
                res = db.authenticate_user(
                    str(body.get("email", "")),
                    str(body.get("password", "")),
                )
                self._send_json(200, res)
                return

            if path == "/api/auth/logout":
                db.delete_session(_get_bearer_token(self.headers))
                self._send_json(200, {"ok": True})
                return

            user = self._require_user()
            if not user:
                return
            user_id = user["id"]

            if path == "/api/orders":
                conn = db.get_conn()
                try:
                    res = _place_order_core(conn, user_id, body)
                    conn.commit()
                    self._send_json(201, res)
                except Exception as exc:
                    db.add_log(conn, user_id, "ERROR", str(body.get("strategy_slug", "manual")), f"Order failed: {exc}")
                    conn.commit()
                    self._send_json(400, {"error": str(exc)})
                finally:
                    conn.close()
                return

            m_close = re.match(r"^/api/positions/(\d+)/close$", path)
            if m_close:
                pos_id = int(m_close.group(1))
                conn = db.get_conn()
                try:
                    pos = conn.execute("SELECT * FROM positions WHERE id = ? AND user_id = ?", (pos_id, user_id)).fetchone()
                    if not pos:
                        self._send_json(404, {"error": "Position not found"})
                        return
                    if pos["status"] != "OPEN":
                        self._send_json(400, {"error": "Position is already closed"})
                        return
                    snap = market_data.get_live_market_snapshot()
                    spot = float(snap["tickers"][pos["index_symbol"]]["price"])
                    vix = max(9.0, float(snap["tickers"]["INDIAVIX"]["price"]))
                    t_years = market_data.time_to_expiry_years(pos["index_symbol"])
                    exit_p = market_data.black_scholes(spot, float(pos["strike"]), t_years, 0.065, vix / 100.0, pos["option_type"])["price"]
                    chg = market_data.calculate_charges(float(pos["entry_price"]), exit_p, int(pos["qty"]))["total"]
                    gross = (exit_p - float(pos["entry_price"])) * int(pos["qty"])
                    net = round(gross - chg, 2)
                    exit_hm = db.now_ist().strftime("%H:%M")

                    conn.execute(
                        """
                        UPDATE positions
                        SET ltp = ?, status = 'CLOSED', exit_price = ?, exit_time = ?, exit_reason = 'MANUAL', realized_pnl = ?, charges = ?
                        WHERE id = ?
                        """,
                        (exit_p, exit_p, exit_hm, net, chg, pos_id),
                    )
                    if pos["mode"] == "PAPER":
                        conn.execute(
                            "UPDATE users SET paper_capital = paper_capital + ? WHERE id = ?",
                            (round(exit_p * int(pos["qty"]) - chg, 2), user_id),
                        )
                    db.add_log(
                        conn,
                        user_id,
                        "EXIT",
                        pos["strategy_slug"],
                        f"Manual exit @ {exit_p:.2f} · {pos['contract_symbol']} · Net P&L {'+' if net >= 0 else ''}₹{net:,.2f}",
                    )
                    conn.commit()
                    self._send_json(200, {"ok": True, "exit_price": exit_p, "realized_pnl": net})
                finally:
                    conn.close()
                return

            if path == "/api/kill-switch":
                conn = db.get_conn()
                try:
                    conn.execute("UPDATE strategies SET mode = 'PAUSED', updated_at = ? WHERE user_id = ?", (db.now_ist_iso(), user_id))
                    open_rows = conn.execute("SELECT * FROM positions WHERE user_id = ? AND status = 'OPEN'", (user_id,)).fetchall()
                    snap = market_data.get_live_market_snapshot()
                    vix = max(9.0, float(snap["tickers"]["INDIAVIX"]["price"]))
                    exit_hm = db.now_ist().strftime("%H:%M")
                    closed_count = 0
                    for pos in open_rows:
                        spot = float(snap["tickers"][pos["index_symbol"]]["price"])
                        t_years = market_data.time_to_expiry_years(pos["index_symbol"])
                        exit_p = market_data.black_scholes(spot, float(pos["strike"]), t_years, 0.065, vix / 100.0, pos["option_type"])["price"]
                        chg = market_data.calculate_charges(float(pos["entry_price"]), exit_p, int(pos["qty"]))["total"]
                        net = round((exit_p - float(pos["entry_price"])) * int(pos["qty"]) - chg, 2)
                        conn.execute(
                            """
                            UPDATE positions
                            SET ltp = ?, status = 'CLOSED', exit_price = ?, exit_time = ?, exit_reason = 'KILL', realized_pnl = ?, charges = ?
                            WHERE id = ?
                            """,
                            (exit_p, exit_p, exit_hm, net, chg, pos["id"]),
                        )
                        if pos["mode"] == "PAPER":
                            conn.execute(
                                "UPDATE users SET paper_capital = paper_capital + ? WHERE id = ?",
                                (round(exit_p * int(pos["qty"]) - chg, 2), user_id),
                            )
                        closed_count += 1

                    db.add_log(
                        conn,
                        user_id,
                        "WARN",
                        "kill_switch",
                        f"KILL SWITCH TRIGGERED · All strategies paused · {closed_count} open position(s) squared off",
                    )
                    conn.commit()
                    self._send_json(200, {"ok": True, "closed_positions": closed_count})
                finally:
                    conn.close()
                return

            if path == "/api/paper/reset":
                capital = float(body.get("capital", 1000000.0))
                if capital < 10000 or capital > 100000000:
                    raise ValueError("Paper capital must be between ₹10,000 and ₹10,00,00,000")
                conn = db.get_conn()
                try:
                    conn.execute("UPDATE users SET paper_capital = ? WHERE id = ?", (capital, user_id))
                    db.add_log(conn, user_id, "INFO", "paper", f"Paper trading capital set to ₹{capital:,.2f}")
                    conn.commit()
                    self._send_json(200, {"ok": True, "paper_capital": capital})
                finally:
                    conn.close()
                return

            m_connect = re.match(r"^/api/brokers/(zerodha|dhan|angelone)/connect$", path)
            if m_connect:
                code = m_connect.group(1)
                conn = db.get_conn()
                try:
                    client_id = str(body.get("client_id", "")).strip()
                    api_key = str(body.get("api_key", "")).strip()
                    api_secret = str(body.get("api_secret", "")).strip()
                    access_token = str(body.get("access_token", "")).strip()
                    request_token = str(body.get("request_token", "")).strip()
                    password_pin = str(body.get("password_pin", "")).strip()
                    totp_secret = str(body.get("totp_secret", "")).strip()

                    if code == "zerodha":
                        if not api_key:
                            raise ValueError("Zerodha API Key is required")
                        if request_token and api_secret and not access_token:
                            ex = brokers.ZerodhaKiteClient.exchange_session(api_key, api_secret, request_token)
                            access_token = ex["data"].get("access_token", "")
                            client_id = ex["data"].get("user_id", client_id)
                        if not access_token:
                            raise ValueError("Provide a valid Zerodha Access Token (or Request Token + API Secret)")
                        client = brokers.ZerodhaKiteClient(api_key, access_token)
                        margins = client.verify_and_margins()

                    elif code == "dhan":
                        if not client_id or not access_token:
                            raise ValueError("Dhan Client ID and Access Token are required")
                        client = brokers.DhanHQClient(client_id, access_token)
                        margins = client.verify_and_margins()

                    else:
                        if not api_key:
                            raise ValueError("Angel One SmartAPI Key is required")
                        if not access_token:
                            if not client_id or not password_pin or not totp_secret:
                                raise ValueError("Angel One requires Client Code, PIN, and TOTP Secret (or direct JWT Token)")
                            login_res = brokers.AngelOneClient.login(api_key, client_id, password_pin, totp_secret)
                            access_token = login_res["jwt_token"]
                        client = brokers.AngelOneClient(api_key, access_token)
                        margins = client.verify_and_margins()

                    ts = db.now_ist_iso()
                    conn.execute(
                        """
                        UPDATE broker_connections
                        SET status = 'CONNECTED', client_id = ?, api_key = ?, api_secret = ?, access_token = ?, totp_secret = ?,
                            feed_latency_ms = ?, margin_available = ?, margin_used = ?, last_verified_at = ?, last_error = '', updated_at = ?
                        WHERE user_id = ? AND broker_code = ?
                        """,
                        (
                            client_id,
                            api_key,
                            api_secret,
                            access_token,
                            totp_secret,
                            margins["latency_ms"],
                            margins["margin_available"],
                            margins["margin_used"],
                            ts,
                            ts,
                            user_id,
                            code,
                        ),
                    )
                    db.add_log(
                        conn,
                        user_id,
                        "INFO",
                        code,
                        f"Broker authenticated · {code.upper()} · Margin ₹{margins['margin_available']:,.2f} · RTT {margins['latency_ms']}ms",
                    )
                    conn.commit()
                    self._send_json(200, {"ok": True, "broker_code": code, **margins})
                except Exception as exc:
                    ts = db.now_ist_iso()
                    conn.execute(
                        "UPDATE broker_connections SET status = 'ERROR', last_error = ?, updated_at = ? WHERE user_id = ? AND broker_code = ?",
                        (str(exc), ts, user_id, code),
                    )
                    db.add_log(conn, user_id, "ERROR", code, f"Broker authentication failed: {exc}")
                    conn.commit()
                    self._send_json(400, {"error": str(exc)})
                finally:
                    conn.close()
                return

            m_disc = re.match(r"^/api/brokers/(zerodha|dhan|angelone)/disconnect$", path)
            if m_disc:
                code = m_disc.group(1)
                conn = db.get_conn()
                try:
                    conn.execute(
                        "UPDATE broker_connections SET status = 'DISCONNECTED', access_token = '', last_error = '', updated_at = ? WHERE user_id = ? AND broker_code = ?",
                        (db.now_ist_iso(), user_id, code),
                    )
                    db.add_log(conn, user_id, "INFO", code, f"Disconnected {code.upper()} broker session")
                    conn.commit()
                    self._send_json(200, {"ok": True})
                finally:
                    conn.close()
                return

            m_prim = re.match(r"^/api/brokers/(zerodha|dhan|angelone)/primary$", path)
            if m_prim:
                code = m_prim.group(1)
                conn = db.get_conn()
                try:
                    conn.execute("UPDATE broker_connections SET is_primary = 0 WHERE user_id = ?", (user_id,))
                    conn.execute("UPDATE broker_connections SET is_primary = 1 WHERE user_id = ? AND broker_code = ?", (user_id, code))
                    conn.commit()
                    self._send_json(200, {"ok": True})
                finally:
                    conn.close()
                return

            if path == "/api/brokers/sync":
                conn = db.get_conn()
                try:
                    data = _fetch_live_broker_data(conn, user_id)
                    self._send_json(200, data)
                finally:
                    conn.close()
                return

            if path == "/api/strategies/import":
                filename = str(body.get("filename", "")).strip()
                name = str(body.get("name", "")).strip()
                index_symbol = str(body.get("index_symbol", "NIFTY")).upper()
                code_text = str(body.get("code_text", ""))
                if not filename.endswith(".py"):
                    raise ValueError("Strategy file must have a .py extension")
                if not name:
                    name = filename[:-3].replace("_", " ").title()
                slug = re.sub(r"[^a-z0-9_]+", "_", filename[:-3].lower()).strip("_") or f"custom_{int(db.now_ist().timestamp())}"
                if "def " not in code_text:
                    raise ValueError("Python strategy must define at least one function (def ...)")
                conn = db.get_conn()
                try:
                    ts = db.now_ist_iso()
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO strategies (user_id, slug, name, index_symbol, filename, description, mode, lots, target_pct, sl_pct, timeframe, code_text, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'PAPER', ?, ?, ?, '5m', ?, ?, ?)
                        """,
                        (
                            user_id,
                            slug,
                            name,
                            index_symbol if index_symbol in ("NIFTY", "SENSEX") else "NIFTY",
                            filename,
                            str(body.get("description") or "Custom imported Python strategy"),
                            int(body.get("lots", 1)),
                            float(body.get("target_pct", 30.0)),
                            float(body.get("sl_pct", 15.0)),
                            code_text,
                            ts,
                            ts,
                        ),
                    )
                    db.add_log(conn, user_id, "INFO", slug, f"Imported Python strategy {filename} in PAPER mode")
                    conn.commit()
                    self._send_json(201, {"ok": True, "slug": slug})
                finally:
                    conn.close()
                return

            m_scan = re.match(r"^/api/strategies/([a-z0-9_]+)/scan$", path)
            if m_scan:
                slug = m_scan.group(1)
                conn = db.get_conn()
                try:
                    st = conn.execute("SELECT * FROM strategies WHERE user_id = ? AND slug = ?", (user_id, slug)).fetchone()
                    if not st:
                        self._send_json(404, {"error": "Strategy not found"})
                        return
                    if st["mode"] == "PAUSED":
                        raise ValueError("Strategy is PAUSED. Switch to PAPER or LIVE before running a signal scan.")

                    idx = st["index_symbol"]
                    cfg = market_data.INDEX_CONFIG[idx]
                    spot_data = market_data.fetch_yahoo_chart(cfg["yahoo"], interval="5m", range_str="1d", ttl_seconds=10)
                    vix_data = market_data.fetch_yahoo_chart("^INDIAVIX", interval="5m", range_str="1d", ttl_seconds=10)
                    candles = spot_data["candles"]
                    sig = market_data.evaluate_strategy_on_candles(slug, candles, len(candles) - 1, vix_data["price"])
                    force_paper = bool(body.get("force_execute", False))

                    if not sig and force_paper:
                        # Directional bias from latest real market candle close vs open
                        last_c = candles[-1]
                        sig = "CE" if last_c["close"] >= last_c["open"] else "PE"

                    if not sig:
                        db.add_log(conn, user_id, "INFO", slug, f"Live scan on {idx} @ {spot_data['price']:.2f} · No entry trigger on latest 5m bar")
                        conn.commit()
                        self._send_json(200, {"triggered": False, "spot": spot_data["price"], "message": "No signal on latest 5m candle"})
                        return

                    db.add_log(conn, user_id, "SIGNAL", slug, f"Entry condition met on live {idx} ({spot_data['price']:.2f}) -> BUY {sig}")
                    order_res = _place_order_core(
                        conn,
                        user_id,
                        {
                            "mode": st["mode"],
                            "strategy_slug": slug,
                            "index_symbol": idx,
                            "option_type": sig,
                            "side": "BUY",
                            "order_type": "MARKET",
                            "lots": st["lots"],
                            "target_pct": st["target_pct"],
                            "sl_pct": st["sl_pct"],
                        },
                    )
                    conn.commit()
                    self._send_json(200, {"triggered": True, "signal": sig, "order": order_res})
                except Exception as exc:
                    self._send_json(400, {"error": str(exc)})
                finally:
                    conn.close()
                return

            if path == "/api/backtest":
                result = market_data.run_backtest(
                    strategy_slug=str(body.get("strategy_slug", "orb_breakout")),
                    index_symbol=str(body.get("index_symbol", "NIFTY")),
                    period=str(body.get("period", "3M")),
                    target_pct=float(body.get("target_pct", 30.0)),
                    sl_pct=float(body.get("sl_pct", 15.0)),
                    lots=int(body.get("lots", 2)),
                    slippage_pts=float(body.get("slippage_pts", 0.5)),
                    brokerage_per_order=float(body.get("brokerage_per_order", 20.0)),
                )
                self._send_json(200, result)
                return

            self._send_json(404, {"error": f"Unknown endpoint {path}"})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            user = self._require_user()
            if not user:
                return
            user_id = user["id"]
            body = self._read_json()

            m_st = re.match(r"^/api/strategies/([a-z0-9_]+)$", path)
            if m_st:
                slug = m_st.group(1)
                conn = db.get_conn()
                try:
                    st = conn.execute("SELECT * FROM strategies WHERE user_id = ? AND slug = ?", (user_id, slug)).fetchone()
                    if not st:
                        self._send_json(404, {"error": "Strategy not found"})
                        return
                    mode = str(body.get("mode", st["mode"])).upper()
                    if mode not in ("LIVE", "PAPER", "PAUSED"):
                        raise ValueError("Strategy mode must be LIVE, PAPER, or PAUSED")
                    lots = int(body.get("lots", st["lots"]))
                    target_pct = float(body.get("target_pct", st["target_pct"]))
                    sl_pct = float(body.get("sl_pct", st["sl_pct"]))
                    index_symbol = str(body.get("index_symbol", st["index_symbol"])).upper()
                    code_text = str(body.get("code_text", st["code_text"]))

                    conn.execute(
                        """
                        UPDATE strategies
                        SET mode = ?, lots = ?, target_pct = ?, sl_pct = ?, index_symbol = ?, code_text = ?, updated_at = ?
                        WHERE user_id = ? AND slug = ?
                        """,
                        (mode, lots, target_pct, sl_pct, index_symbol, code_text, db.now_ist_iso(), user_id, slug),
                    )
                    db.add_log(conn, user_id, "INFO", slug, f"Strategy updated · mode {mode} · {lots} lot(s) · TGT {target_pct}% · SL {sl_pct}%")
                    conn.commit()
                    updated = dict(conn.execute("SELECT * FROM strategies WHERE user_id = ? AND slug = ?", (user_id, slug)).fetchone())
                    self._send_json(200, {"strategy": updated})
                finally:
                    conn.close()
                return

            self._send_json(404, {"error": f"Unknown endpoint {path}"})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": str(e)})


def main() -> None:
    db.init_db()
    port = int(os.environ.get("PYTHON_ENGINE_PORT", "8001"))
    server = ThreadingHTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"GammaDesk Python Engine listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
