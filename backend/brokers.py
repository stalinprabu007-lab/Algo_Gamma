import base64
import hashlib
import hmac
import json
import struct
import time
import urllib.error
import urllib.parse
import urllib.request


def generate_totp(secret_base32: str, interval: int = 30, digits: int = 6) -> str:
    """
    Pure Python RFC 6238 TOTP generator for Angel One SmartAPI 2FA.
    """
    cleaned = secret_base32.strip().replace(" ", "").upper()
    if not cleaned:
        raise ValueError("TOTP secret is empty")
    pad = (-len(cleaned)) % 8
    key = base64.b32decode(cleaned + ("=" * pad), casefold=True)
    counter = int(time.time() // interval)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def _http_json(url: str, method: str = "GET", headers: dict | None = None, body: dict | str | None = None) -> tuple[int, dict, int]:
    t0 = time.perf_counter()
    hdrs = {"Accept": "application/json", "User-Agent": "GammaDesk/1.0"}
    if headers:
        hdrs.update(headers)
    data_bytes = None
    if body is not None:
        if isinstance(body, dict):
            if hdrs.get("Content-Type") == "application/x-www-form-urlencoded":
                data_bytes = urllib.parse.urlencode(body).encode("utf-8")
            else:
                hdrs.setdefault("Content-Type", "application/json")
                data_bytes = json.dumps(body).encode("utf-8")
        else:
            data_bytes = body.encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            raw_text = resp.read().decode("utf-8") or "{}"
            return resp.status, json.loads(raw_text), latency_ms
    except urllib.error.HTTPError as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        raw_err = e.read().decode("utf-8") or "{}"
        try:
            err_json = json.loads(raw_err)
        except Exception:
            err_json = {"message": raw_err}
        return e.code, err_json, latency_ms
    except urllib.error.URLError as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return 503, {"message": str(e.reason)}, latency_ms


class ZerodhaKiteClient:
    BASE = "https://api.kite.trade"

    @staticmethod
    def login_url(api_key: str) -> str:
        return f"https://kite.trade/connect/login?v=3&api_key={urllib.parse.quote(api_key)}"

    @classmethod
    def exchange_session(cls, api_key: str, api_secret: str, request_token: str) -> dict:
        checksum = hashlib.sha256(f"{api_key}{request_token}{api_secret}".encode("utf-8")).hexdigest()
        status, data, latency = _http_json(
            f"{cls.BASE}/session/token",
            method="POST",
            headers={"X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded"},
            body={"api_key": api_key, "request_token": request_token, "checksum": checksum},
        )
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha HTTP {status}")
        return {"data": data.get("data", {}), "latency_ms": latency}

    def __init__(self, api_key: str, access_token: str):
        self.api_key = api_key
        self.access_token = access_token
        self.headers = {
            "X-Kite-Version": "3",
            "Authorization": f"token {api_key}:{access_token}",
        }

    def verify_and_margins(self) -> dict:
        status, data, latency = _http_json(f"{self.BASE}/user/margins", headers=self.headers)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha authentication error (HTTP {status})")
        eq = data.get("data", {}).get("equity", {})
        avail = float(eq.get("available", {}).get("live_balance", 0.0) or eq.get("net", 0.0))
        used = float(eq.get("utilised", {}).get("debits", 0.0))
        return {"margin_available": avail, "margin_used": used, "latency_ms": latency, "raw": data.get("data", {})}

    def get_positions(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/portfolio/positions", headers=self.headers)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha positions HTTP {status}")
        net = data.get("data", {}).get("net", [])
        return [
            {
                "broker": "zerodha",
                "symbol": p.get("tradingsymbol", ""),
                "exchange": p.get("exchange", ""),
                "qty": int(p.get("quantity", 0)),
                "avg_price": float(p.get("average_price", 0.0)),
                "ltp": float(p.get("last_price", 0.0)),
                "pnl": float(p.get("pnl", 0.0)),
                "product": p.get("product", "NRML"),
            }
            for p in net
        ]

    def get_holdings(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/portfolio/holdings", headers=self.headers)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha holdings HTTP {status}")
        return data.get("data", [])

    def get_orders(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/orders", headers=self.headers)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha orders HTTP {status}")
        return data.get("data", [])

    def place_order(self, exchange: str, tradingsymbol: str, side: str, qty: int, order_type: str, price: float = 0.0, product: str = "NRML") -> dict:
        payload = {
            "tradingsymbol": tradingsymbol,
            "exchange": exchange,
            "transaction_type": side.upper(),
            "order_type": order_type.upper(),
            "quantity": str(qty),
            "product": product,
            "validity": "DAY",
        }
        if order_type.upper() in ("LIMIT", "SL"):
            payload["price"] = str(price)
        if order_type.upper() in ("SL", "SL-M"):
            payload["trigger_price"] = str(price)
        hdrs = {**self.headers, "Content-Type": "application/x-www-form-urlencoded"}
        status, data, latency = _http_json(f"{self.BASE}/orders/regular", method="POST", headers=hdrs, body=payload)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha order rejected (HTTP {status})")
        return {"order_id": data.get("data", {}).get("order_id", ""), "latency_ms": latency}

    def cancel_order(self, order_id: str, variety: str = "regular") -> dict:
        status, data, _ = _http_json(f"{self.BASE}/orders/{variety}/{order_id}", method="DELETE", headers=self.headers)
        if status >= 400 or data.get("status") == "error":
            raise RuntimeError(data.get("message") or f"Zerodha cancel rejected (HTTP {status})")
        return data


class DhanHQClient:
    BASE = "https://api.dhan.co/v2"

    def __init__(self, client_id: str, access_token: str):
        self.client_id = client_id
        self.access_token = access_token
        self.headers = {
            "access-token": access_token,
            "client-id": client_id,
            "Content-Type": "application/json",
        }

    def verify_and_margins(self) -> dict:
        status, data, latency = _http_json(f"{self.BASE}/fundlimit", headers=self.headers)
        if status >= 400 or data.get("errorCode") or data.get("status") == "error":
            raise RuntimeError(data.get("errorMessage") or data.get("message") or f"Dhan authentication error (HTTP {status})")
        avail = float(data.get("availabelBalance", data.get("availableBalance", 0.0)))
        used = float(data.get("utilizedAmount", 0.0))
        return {"margin_available": avail, "margin_used": used, "latency_ms": latency, "raw": data}

    def get_positions(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/positions", headers=self.headers)
        if status >= 400:
            raise RuntimeError(data.get("errorMessage") or f"Dhan positions HTTP {status}")
        items = data if isinstance(data, list) else data.get("data", [])
        return [
            {
                "broker": "dhan",
                "symbol": p.get("tradingSymbol", ""),
                "exchange": p.get("exchangeSegment", ""),
                "qty": int(p.get("netQty", 0)),
                "avg_price": float(p.get("costPrice", 0.0)),
                "ltp": float(p.get("drvOptionPrice", p.get("buyAvg", 0.0))),
                "pnl": float(p.get("unrealizedProfit", 0.0)) + float(p.get("realizedProfit", 0.0)),
                "product": p.get("productType", "MARGIN"),
            }
            for p in items
        ]

    def get_holdings(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/holdings", headers=self.headers)
        if status >= 400:
            raise RuntimeError(data.get("errorMessage") or f"Dhan holdings HTTP {status}")
        return data if isinstance(data, list) else data.get("data", [])

    def get_orders(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/orders", headers=self.headers)
        if status >= 400:
            raise RuntimeError(data.get("errorMessage") or f"Dhan orders HTTP {status}")
        return data if isinstance(data, list) else data.get("data", [])

    def place_order(self, exchange_segment: str, security_id: str, side: str, qty: int, order_type: str, price: float = 0.0, product_type: str = "INTRADAY") -> dict:
        payload = {
            "dhanClientId": self.client_id,
            "transactionType": side.upper(),
            "exchangeSegment": exchange_segment,
            "productType": product_type,
            "orderType": "STOP_LOSS_MARKET" if order_type.upper() == "SL-M" else order_type.upper(),
            "validity": "DAY",
            "securityId": security_id,
            "quantity": int(qty),
            "price": price if order_type.upper() == "LIMIT" else 0,
            "triggerPrice": price if order_type.upper() in ("SL", "SL-M") else 0,
        }
        status, data, latency = _http_json(f"{self.BASE}/orders", method="POST", headers=self.headers, body=payload)
        if status >= 400 or data.get("errorCode"):
            raise RuntimeError(data.get("errorMessage") or f"Dhan order rejected (HTTP {status})")
        return {"order_id": str(data.get("orderId", "")), "latency_ms": latency}

    def cancel_order(self, order_id: str) -> dict:
        status, data, _ = _http_json(f"{self.BASE}/orders/{order_id}", method="DELETE", headers=self.headers)
        if status >= 400:
            raise RuntimeError(data.get("errorMessage") or f"Dhan cancel rejected (HTTP {status})")
        return data


class AngelOneClient:
    BASE = "https://apiconnect.angelone.in"

    @classmethod
    def login(cls, api_key: str, client_code: str, password_pin: str, totp_secret: str) -> dict:
        totp = generate_totp(totp_secret) if len(totp_secret.strip()) > 6 else totp_secret.strip()
        headers = {
            "X-PrivateKey": api_key,
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "Content-Type": "application/json",
        }
        status, data, latency = _http_json(
            f"{cls.BASE}/rest/auth/angelbroking/user/v1/loginByPassword",
            method="POST",
            headers=headers,
            body={"clientcode": client_code, "password": password_pin, "totp": totp},
        )
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One login failed (HTTP {status})")
        return {"jwt_token": data["data"]["jwtToken"], "refresh_token": data["data"].get("refreshToken", ""), "latency_ms": latency}

    def __init__(self, api_key: str, jwt_token: str):
        self.api_key = api_key
        self.jwt_token = jwt_token
        self.headers = {
            "Authorization": f"Bearer {jwt_token}",
            "X-PrivateKey": api_key,
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "Content-Type": "application/json",
        }

    def verify_and_margins(self) -> dict:
        status, data, latency = _http_json(f"{self.BASE}/rest/secure/angelbroking/user/v1/getRMS", headers=self.headers)
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One RMS error (HTTP {status})")
        rms = data.get("data") or {}
        avail = float(rms.get("availablecash", 0.0) or 0.0)
        used = float(rms.get("utiliseddebits", 0.0) or 0.0)
        return {"margin_available": avail, "margin_used": used, "latency_ms": latency, "raw": rms}

    def get_positions(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/rest/secure/angelbroking/order/v1/getPosition", headers=self.headers)
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One positions HTTP {status}")
        items = data.get("data") or []
        return [
            {
                "broker": "angelone",
                "symbol": p.get("tradingsymbol", ""),
                "exchange": p.get("exchange", ""),
                "qty": int(p.get("netqty", 0)),
                "avg_price": float(p.get("netprice", 0.0)),
                "ltp": float(p.get("ltp", 0.0)),
                "pnl": float(p.get("pnl", 0.0)),
                "product": p.get("producttype", "INTRADAY"),
            }
            for p in items
        ]

    def get_holdings(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/rest/secure/angelbroking/portfolio/v1/getAllHolding", headers=self.headers)
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One holdings HTTP {status}")
        return data.get("data", {}).get("holdings", [])

    def get_orders(self) -> list[dict]:
        status, data, _ = _http_json(f"{self.BASE}/rest/secure/angelbroking/order/v1/getOrderBook", headers=self.headers)
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One orders HTTP {status}")
        return data.get("data") or []

    def place_order(self, exchange: str, tradingsymbol: str, symboltoken: str, side: str, qty: int, order_type: str, price: float = 0.0, product_type: str = "INTRADAY") -> dict:
        payload = {
            "variety": "NORMAL",
            "tradingsymbol": tradingsymbol,
            "symboltoken": symboltoken,
            "transactiontype": side.upper(),
            "exchange": exchange,
            "ordertype": "STOPLOSS_MARKET" if order_type.upper() == "SL-M" else order_type.upper(),
            "producttype": product_type,
            "duration": "DAY",
            "price": str(price if order_type.upper() == "LIMIT" else 0),
            "triggerprice": str(price if order_type.upper() in ("SL", "SL-M") else 0),
            "quantity": str(qty),
        }
        status, data, latency = _http_json(f"{self.BASE}/rest/secure/angelbroking/order/v1/placeOrder", method="POST", headers=self.headers, body=payload)
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One order rejected (HTTP {status})")
        return {"order_id": str(data.get("data", {}).get("orderid", "")), "latency_ms": latency}

    def cancel_order(self, order_id: str, variety: str = "NORMAL") -> dict:
        status, data, _ = _http_json(
            f"{self.BASE}/rest/secure/angelbroking/order/v1/cancelOrder",
            method="POST",
            headers=self.headers,
            body={"variety": variety, "orderid": order_id},
        )
        if status >= 400 or not data.get("status"):
            raise RuntimeError(data.get("message") or f"Angel One cancel rejected (HTTP {status})")
        return data
