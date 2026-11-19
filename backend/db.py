import os
import sqlite3
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.environ.get("GAMMADESK_DB_PATH", os.path.join(DATA_DIR, "gammadesk.db"))

DEFAULT_STRATEGIES = [
    {
        "slug": "orb_breakout",
        "name": "ORB Breakout",
        "index_symbol": "NIFTY",
        "filename": "orb_breakout.py",
        "description": "Buys ATM CE/PE on a 15-min opening-range breakout with volume confirmation.",
        "mode": "PAPER",
        "lots": 2,
        "target_pct": 30.0,
        "sl_pct": 15.0,
        "timeframe": "5m",
        "code_text": '''# orb_breakout.py — Opening Range Breakout (15m ORB)
def evaluate_signal(candles, spot, vix, params):
    """
    Triggers ATM CE when 5m close breaks above 09:15-09:30 high
    with volume > 1.2x opening range average, or ATM PE on breakdown.
    """
    if len(candles) < 4:
        return None
    orb_high = max(c["high"] for c in candles[:3])
    orb_low = min(c["low"] for c in candles[:3])
    last = candles[-1]
    if last["close"] > orb_high:
        return {"side": "BUY", "option_type": "CE", "reason": "ORB High Breakout"}
    if last["close"] < orb_low:
        return {"side": "BUY", "option_type": "PE", "reason": "ORB Low Breakdown"}
    return None
''',
    },
    {
        "slug": "vwap_reversal",
        "name": "VWAP Reversal",
        "index_symbol": "SENSEX",
        "filename": "vwap_reversal.py",
        "description": "Fades extended moves back to session VWAP on SENSEX weekly options.",
        "mode": "PAPER",
        "lots": 3,
        "target_pct": 25.0,
        "sl_pct": 12.0,
        "timeframe": "5m",
        "code_text": '''# vwap_reversal.py — Mean Reversion toward Session VWAP
def evaluate_signal(candles, spot, vix, params):
    """
    Computes intraday typical-price VWAP and enters reversal options
    when spot deviates > 0.45% and prints an engulfing rejection bar.
    """
    if len(candles) < 6:
        return None
    vwap = sum(((c["high"] + c["low"] + c["close"]) / 3.0) for c in candles) / len(candles)
    last, prev = candles[-1], candles[-2]
    dev = (last["close"] - vwap) / vwap
    if dev > 0.0045 and last["close"] < prev["open"]:
        return {"side": "BUY", "option_type": "PE", "reason": "VWAP Upper Fade"}
    if dev < -0.0045 and last["close"] > prev["open"]:
        return {"side": "BUY", "option_type": "CE", "reason": "VWAP Lower Reclaim"}
    return None
''',
    },
    {
        "slug": "ema_cross",
        "name": "EMA 9/21 Cross",
        "index_symbol": "NIFTY",
        "filename": "ema_cross.py",
        "description": "Trend-following option buying on 9/21 EMA crossover of spot.",
        "mode": "PAPER",
        "lots": 1,
        "target_pct": 40.0,
        "sl_pct": 20.0,
        "timeframe": "5m",
        "code_text": '''# ema_cross.py — Fast/Slow EMA Trend Crossover
def evaluate_signal(candles, spot, vix, params):
    """
    Buys ATM CE on bullish 9/21 EMA cross, ATM PE on bearish cross.
    """
    if len(candles) < 22:
        return None
    closes = [c["close"] for c in candles]
    ema9 = sum(closes[-9:]) / 9.0
    ema21 = sum(closes[-21:]) / 21.0
    if ema9 > ema21 and closes[-2] <= sum(closes[-10:-1]) / 9.0:
        return {"side": "BUY", "option_type": "CE", "reason": "EMA 9/21 Bullish Cross"}
    if ema9 < ema21 and closes[-2] >= sum(closes[-10:-1]) / 9.0:
        return {"side": "BUY", "option_type": "PE", "reason": "EMA 9/21 Bearish Cross"}
    return None
''',
    },
    {
        "slug": "expiry_gamma",
        "name": "Expiry Gamma Blast",
        "index_symbol": "SENSEX",
        "filename": "expiry_gamma.py",
        "description": "Expiry-day OTM momentum buys on sharp VIX + spot expansion.",
        "mode": "PAUSED",
        "lots": 2,
        "target_pct": 60.0,
        "sl_pct": 25.0,
        "timeframe": "5m",
        "code_text": '''# expiry_gamma.py — Late-Session Gamma Expansion
def evaluate_signal(candles, spot, vix, params):
    """
    Captures rapid option gamma acceleration on range expansion > 1.8x ATR.
    """
    if len(candles) < 10:
        return None
    ranges = [c["high"] - c["low"] for c in candles[-10:-1]]
    avg_range = sum(ranges) / len(ranges)
    last = candles[-1]
    if (last["high"] - last["low"]) > avg_range * 1.8:
        opt = "CE" if last["close"] > last["open"] else "PE"
        return {"side": "BUY", "option_type": opt, "reason": "Gamma Range Expansion"}
    return None
''',
    },
    {
        "slug": "supertrend_momo",
        "name": "Supertrend Momentum",
        "index_symbol": "NIFTY",
        "filename": "supertrend_momo.py",
        "description": "Supertrend (10,3) flips on 5m spot with volatility filter.",
        "mode": "PAUSED",
        "lots": 2,
        "target_pct": 35.0,
        "sl_pct": 18.0,
        "timeframe": "5m",
        "code_text": '''# supertrend_momo.py — Supertrend (10, 3) Trend Flip
def evaluate_signal(candles, spot, vix, params):
    """
    Follows Supertrend (10, 3) directional flips when India VIX >= 11.
    """
    if len(candles) < 12 or vix < 11.0:
        return None
    hl2 = (candles[-1]["high"] + candles[-1]["low"]) / 2.0
    atr = sum(c["high"] - c["low"] for c in candles[-10:]) / 10.0
    if candles[-1]["close"] > hl2 + atr * 0.6:
        return {"side": "BUY", "option_type": "CE", "reason": "Supertrend Bullish Flip"}
    if candles[-1]["close"] < hl2 - atr * 0.6:
        return {"side": "BUY", "option_type": "PE", "reason": "Supertrend Bearish Flip"}
    return None
''',
    },
]


def now_ist() -> datetime:
    return datetime.now(IST)


def now_ist_iso() -> str:
    return now_ist().isoformat()


def now_ist_time() -> str:
    return now_ist().strftime("%H:%M:%S")


def get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    conn = get_conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                full_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                paper_capital REAL NOT NULL DEFAULT 1000000.0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS broker_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                broker_code TEXT NOT NULL,
                display_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'DISCONNECTED',
                client_id TEXT NOT NULL DEFAULT '',
                api_key TEXT NOT NULL DEFAULT '',
                api_secret TEXT NOT NULL DEFAULT '',
                access_token TEXT NOT NULL DEFAULT '',
                totp_secret TEXT NOT NULL DEFAULT '',
                feed_latency_ms INTEGER NOT NULL DEFAULT 0,
                margin_available REAL NOT NULL DEFAULT 0.0,
                margin_used REAL NOT NULL DEFAULT 0.0,
                is_primary INTEGER NOT NULL DEFAULT 0,
                last_verified_at TEXT NOT NULL DEFAULT '',
                last_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, broker_code),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS strategies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                slug TEXT NOT NULL,
                name TEXT NOT NULL,
                index_symbol TEXT NOT NULL,
                filename TEXT NOT NULL,
                description TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'PAPER',
                lots INTEGER NOT NULL DEFAULT 1,
                target_pct REAL NOT NULL DEFAULT 30.0,
                sl_pct REAL NOT NULL DEFAULT 15.0,
                timeframe TEXT NOT NULL DEFAULT '5m',
                code_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, slug),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                strategy_slug TEXT NOT NULL DEFAULT 'manual',
                broker_code TEXT NOT NULL DEFAULT 'paper',
                mode TEXT NOT NULL DEFAULT 'PAPER',
                contract_symbol TEXT NOT NULL,
                index_symbol TEXT NOT NULL,
                strike INTEGER NOT NULL,
                option_type TEXT NOT NULL,
                side TEXT NOT NULL,
                order_type TEXT NOT NULL,
                qty INTEGER NOT NULL,
                price REAL NOT NULL,
                trigger_price REAL NOT NULL DEFAULT 0.0,
                target_price REAL NOT NULL DEFAULT 0.0,
                sl_price REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'COMPLETE',
                broker_order_id TEXT NOT NULL DEFAULT '',
                rejection_reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                strategy_slug TEXT NOT NULL DEFAULT 'manual',
                broker_code TEXT NOT NULL DEFAULT 'paper',
                mode TEXT NOT NULL DEFAULT 'PAPER',
                contract_symbol TEXT NOT NULL,
                index_symbol TEXT NOT NULL,
                strike INTEGER NOT NULL,
                option_type TEXT NOT NULL,
                qty INTEGER NOT NULL,
                entry_price REAL NOT NULL,
                target_price REAL NOT NULL DEFAULT 0.0,
                sl_price REAL NOT NULL DEFAULT 0.0,
                ltp REAL NOT NULL,
                entry_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                exit_price REAL NOT NULL DEFAULT 0.0,
                exit_time TEXT NOT NULL DEFAULT '',
                exit_reason TEXT NOT NULL DEFAULT '',
                realized_pnl REAL NOT NULL DEFAULT 0.0,
                charges REAL NOT NULL DEFAULT 0.0,
                session_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                timestamp_ist TEXT NOT NULL,
                level TEXT NOT NULL,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    if salt_hex is None:
        salt_hex = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 120000)
    return dk.hex(), salt_hex


def verify_password(password: str, expected_hash: str, salt_hex: str) -> bool:
    computed, _ = hash_password(password, salt_hex)
    return hmac.compare_digest(computed, expected_hash)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def add_log(conn: sqlite3.Connection, user_id: int, level: str, source: str, message: str) -> None:
    conn.execute(
        "INSERT INTO logs (user_id, timestamp_ist, level, source, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, now_ist_time(), level.upper(), source, message, now_ist_iso()),
    )


def seed_user_workspace(conn: sqlite3.Connection, user_id: int) -> None:
    ts = now_ist_iso()
    brokers = [
        ("zerodha", "Zerodha Kite", 1),
        ("dhan", "Dhan HQ v2", 0),
        ("angelone", "Angel One SmartAPI", 0),
    ]
    for code, display_name, is_primary in brokers:
        conn.execute(
            """
            INSERT OR IGNORE INTO broker_connections
            (user_id, broker_code, display_name, status, is_primary, updated_at)
            VALUES (?, ?, ?, 'DISCONNECTED', ?, ?)
            """,
            (user_id, code, display_name, is_primary, ts),
        )

    for st in DEFAULT_STRATEGIES:
        conn.execute(
            """
            INSERT OR IGNORE INTO strategies
            (user_id, slug, name, index_symbol, filename, description, mode, lots, target_pct, sl_pct, timeframe, code_text, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                st["slug"],
                st["name"],
                st["index_symbol"],
                st["filename"],
                st["description"],
                st["mode"],
                st["lots"],
                st["target_pct"],
                st["sl_pct"],
                st["timeframe"],
                st["code_text"],
                ts,
                ts,
            ),
        )

    add_log(conn, user_id, "INFO", "system", "Trader workspace initialized · Paper wallet ₹10,00,000.00 ready")
    add_log(conn, user_id, "INFO", "system", "Live NSE/BSE index & VIX feed active · connect Zerodha, Dhan, or Angel One for live execution")


def create_user(email: str, full_name: str, password: str) -> dict:
    email_norm = email.strip().lower()
    name_clean = full_name.strip()
    if not email_norm or "@" not in email_norm:
        raise ValueError("A valid email address is required")
    if len(name_clean) < 2:
        raise ValueError("Full name must be at least 2 characters")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters")

    pw_hash, salt = hash_password(password)
    conn = get_conn()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email_norm,)).fetchone()
        if existing:
            raise ValueError("An account with this email already exists")
        ts = now_ist_iso()
        cur = conn.execute(
            "INSERT INTO users (email, full_name, password_hash, salt, paper_capital, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (email_norm, name_clean, pw_hash, salt, 1000000.0, ts),
        )
        user_id = cur.lastrowid
        seed_user_workspace(conn, user_id)
        token = create_session_for_user(conn, user_id)
        conn.commit()
        user = conn.execute("SELECT id, email, full_name, paper_capital, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        return {"user": dict(user), "token": token}
    finally:
        conn.close()


def create_session_for_user(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    t_hash = hash_token(token)
    expires = (now_ist() + timedelta(days=7)).isoformat()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (t_hash, user_id, expires, now_ist_iso()),
    )
    return token


def authenticate_user(email: str, password: str) -> dict:
    email_norm = email.strip().lower()
    if not email_norm or not password:
        raise ValueError("Email and password are required")
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email_norm,)).fetchone()
        if not row or not verify_password(password, row["password_hash"], row["salt"]):
            raise ValueError("Invalid email or password")
        token = create_session_for_user(conn, row["id"])
        add_log(conn, row["id"], "INFO", "auth", f"Authenticated session for {email_norm}")
        conn.commit()
        return {
            "user": {
                "id": row["id"],
                "email": row["email"],
                "full_name": row["full_name"],
                "paper_capital": row["paper_capital"],
                "created_at": row["created_at"],
            },
            "token": token,
        }
    finally:
        conn.close()


def get_user_by_token(token: str) -> dict | None:
    if not token:
        return None
    t_hash = hash_token(token)
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.full_name, u.paper_capital, u.created_at, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (t_hash,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now_ist_iso():
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (t_hash,))
            conn.commit()
            return None
        return {
            "id": row["id"],
            "email": row["email"],
            "full_name": row["full_name"],
            "paper_capital": row["paper_capital"],
            "created_at": row["created_at"],
        }
    finally:
        conn.close()


def delete_session(token: str) -> None:
    if not token:
        return
    conn = get_conn()
    try:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
        conn.commit()
    finally:
        conn.close()
