"""HTTP example tests (task 6.4): WSGI calls only, no socket.

**Validates: Requirements 1.6, 2.1, 2.2, 13.1, 13.10**
"""
from __future__ import annotations

import io
import json
from datetime import timedelta
from http.cookies import SimpleCookie

import pytest

import webapp

from .conftest import FakeClock


class WsgiClient:
    """Tiny WSGI client. Keeps no cookies unless the test passes them."""

    def __init__(self, clock: FakeClock) -> None:
        self.app = webapp.create_app(clock=clock)
        self.sid: str | None = None

    def raw(self, method, path, body=None, *, cookie=None, headers=None, scheme="http"):
        data = json.dumps(body).encode() if body is not None else b""
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "wsgi.input": io.BytesIO(data),
            "CONTENT_LENGTH": str(len(data)),
            "wsgi.url_scheme": scheme,
        }
        if cookie is not None:
            environ["HTTP_COOKIE"] = f"sid={cookie}"
        environ.update(headers or {})
        captured: dict = {}

        def start_response(status, response_headers):
            captured["status"] = int(status.split()[0])
            captured["headers"] = response_headers

        payload = b"".join(self.app(environ, start_response))
        return captured["status"], captured["headers"], payload

    def call(self, method, path, body=None, **kw):
        """Send with the remembered sid; return (status, json, headers)."""
        if "cookie" not in kw and self.sid:
            kw["cookie"] = self.sid
        status, headers, payload = self.raw(method, path, body, **kw)
        for name, value in headers:
            if name == "Set-Cookie":
                morsel = SimpleCookie(value).get("sid")
                if morsel:
                    self.sid = morsel.value
        try:
            parsed = json.loads(payload)
        except ValueError:
            parsed = payload
        return status, parsed, headers


def header_values(headers, name):
    return [v for k, v in headers if k.lower() == name.lower()]


@pytest.fixture
def client(fake_clock):
    return WsgiClient(fake_clock)


def order_body(clock, days=4):
    return {
        "plant_id": "B01",
        "material": "ฟางข้าว",
        "target_tons": 10,
        "offer_price": 1500,
        "max_moisture_pct": 20,
        "delivery_date": (clock().date() + timedelta(days=days)).isoformat(),
    }


def create_lot(client, clock):
    status, body, _ = client.call("POST", "/api/orders", order_body(clock))
    assert status == 201, body
    return body["lot"]


def write(client, lot, action, **payload):
    status, body, _ = client.call(
        "POST", f"/api/lots/{lot['lot_id']}/{action}", {"revision": lot["revision"], **payload}
    )
    return status, body


def submitted_lot(client, clock):
    lot = create_lot(client, clock)
    status, body = write(client, lot, "proposal")
    assert status == 200, body
    status, body = write(client, body["lot"], "submit")
    assert status == 200, body
    return body["lot"]


def ready_lot(client, clock):
    lot = submitted_lot(client, clock)
    for conf in lot["confirmations"]:
        extra = {}
        if conf["role"] == "contractor":
            extra = {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        status, body = write(client, lot, "confirmations", party_id=conf["party_id"], **extra)
        assert status == 200, body
        lot = body["lot"]
    assert lot["status"] == "ready"
    return lot


# ------------------------------------------------------------ F3 contract

def test_config_shape_and_no_cookie(client):
    status, body, headers = client.call("GET", "/api/config")
    assert status == 200
    assert set(body) == {"liff_id", "materials", "provinces"}
    assert isinstance(body["liff_id"], str)
    assert body["materials"] and body["provinces"]
    assert header_values(headers, "Set-Cookie") == []


def test_matches_ok_has_no_cookie(client):
    status, body, headers = client.call(
        "POST", "/api/matches",
        {"material": "ฟางข้าว", "province": "อุตรดิตถ์", "quantity_tons": 10},
    )
    assert status == 200, body
    assert "errors" not in body
    assert header_values(headers, "Set-Cookie") == []


def test_matches_400_for_bad_body(client):
    status, body, _ = client.call("POST", "/api/matches", [1, 2])
    assert status == 400
    assert body == {"message": webapp.MSG_BAD_SEARCH}


def test_matches_400_for_empty_body(client):
    status, _, _ = client.call("POST", "/api/matches")
    assert status == 400


def test_matches_422_for_invalid_fields(client):
    status, body, headers = client.call(
        "POST", "/api/matches", {"material": 1, "province": None, "quantity_tons": "x"}
    )
    assert status == 422
    assert body["errors"]
    assert header_values(headers, "Set-Cookie") == []


# ---------------------------------------------------------------- cookies

def test_demo_sets_cookie_with_flags_and_long_token(client):
    status, body, headers = client.call("GET", "/api/demo")
    assert status == 200
    assert body["session_reset"] is False
    cookies = header_values(headers, "Set-Cookie")
    assert len(cookies) == 1
    assert "HttpOnly" in cookies[0]
    assert "SameSite=Lax" in cookies[0]
    assert "Secure" not in cookies[0]
    token = SimpleCookie(cookies[0])["sid"].value
    assert len(token.encode()) >= 16


def test_cookie_secure_over_https_scheme(client):
    _, headers, _ = client.raw("GET", "/api/demo", scheme="https")
    assert "Secure" in header_values(headers, "Set-Cookie")[0]


def test_cookie_secure_with_forwarded_proto(client):
    _, headers, _ = client.raw(
        "GET", "/api/demo", headers={"HTTP_X_FORWARDED_PROTO": "https"}
    )
    assert "Secure" in header_values(headers, "Set-Cookie")[0]


def test_valid_cookie_is_reused_without_new_cookie(client):
    client.call("GET", "/api/demo")
    status, body, headers = client.call("GET", "/api/demo")
    assert status == 200
    assert body["session_reset"] is False
    assert header_values(headers, "Set-Cookie") == []


@pytest.mark.parametrize("path", ["/", "/app.js", "/lot.js", "/style.css", "/api/config"])
def test_no_cookie_for_static_and_config(client, path):
    status, headers, _ = client.raw("GET", path)
    assert status == 200
    assert header_values(headers, "Set-Cookie") == []


def test_bogus_cookie_flags_reset_and_issues_new_cookie(client):
    status, headers, payload = client.raw("GET", "/api/demo", cookie="not-a-real-token")
    assert status == 200
    assert json.loads(payload)["session_reset"] is True
    assert len(header_values(headers, "Set-Cookie")) == 1


def test_expired_cookie_flags_reset_and_issues_new_cookie(client, fake_clock):
    client.call("GET", "/api/demo")
    old = client.sid
    fake_clock.advance(hours=24)
    status, body, headers = client.call("GET", "/api/demo")
    assert status == 200
    assert body["session_reset"] is True
    cookies = header_values(headers, "Set-Cookie")
    assert len(cookies) == 1
    assert SimpleCookie(cookies[0])["sid"].value != old


# --------------------------------------------------- 404 / 405 / 500 paths

def test_unknown_path_is_404(client):
    status, body, _ = client.call("GET", "/nope")
    assert status == 404
    assert body == {"message": webapp.MSG_NOT_FOUND}


def test_missing_static_file_is_404(client, monkeypatch, tmp_path):
    monkeypatch.setattr(webapp, "WEB", tmp_path)
    status, body, headers = client.call("GET", "/lot.js")
    assert status == 404
    assert body == {"message": webapp.MSG_NOT_FOUND}
    assert header_values(headers, "Set-Cookie") == []


def test_wrong_method_is_405_with_allow(client):
    status, body, headers = client.call("GET", "/api/matches")
    assert status == 405
    assert body == {"message": webapp.MSG_METHOD}
    assert header_values(headers, "Allow") == ["POST"]
    status, _, headers = client.call("POST", "/api/config", {})
    assert status == 405
    assert header_values(headers, "Allow") == ["GET"]


def test_unhandled_error_is_generic_500_without_trace(client, monkeypatch):
    def boom(req):
        raise RuntimeError("secret-internal-detail /home/x/file.py")

    monkeypatch.setattr(
        webapp, "ROUTES", [*webapp.ROUTES, ("GET", webapp.re.compile("/boom"), boom)]
    )
    status, headers, payload = client.raw("GET", "/boom")
    assert status == 500
    assert json.loads(payload) == {"message": webapp.MSG_SERVER_ERROR}
    text = payload.decode()
    assert "secret-internal-detail" not in text
    assert "Traceback" not in text and "RuntimeError" not in text
    assert header_values(headers, "Set-Cookie") == []


# -------------------------------------------------------- lot endpoints

def test_create_order_is_201(client, fake_clock):
    status, body, _ = client.call("POST", "/api/orders", order_body(fake_clock))
    assert status == 201
    assert body["lot"]["status"] == "draft"


def test_get_lot_200_and_unknown_404(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body, _ = client.call("GET", f"/api/lots/{lot['lot_id']}")
    assert status == 200
    assert body["lot"]["lot_id"] == lot["lot_id"]
    status, _, _ = client.call("GET", "/api/lots/L-unknown")
    assert status == 404


def test_proposal_edits_submit_confirmations_return_200(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body = write(client, lot, "proposal")
    assert status == 200, body
    status, body = write(client, body["lot"], "edits", type="set_price", offer_price=1600)
    assert status == 200, body
    status, body = write(client, body["lot"], "submit")
    assert status == 200, body
    lot = body["lot"]
    conf = lot["confirmations"][0]
    extra = (
        {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        if conf["role"] == "contractor" else {}
    )
    status, body = write(client, lot, "confirmations", party_id=conf["party_id"], **extra)
    assert status == 200, body


def test_weight_200_and_shortfall_decision_200(client, fake_clock):
    lot = ready_lot(client, fake_clock)
    status, body = write(client, lot, "weight", actual_tons=9)
    assert status == 200, body
    assert body["lot"]["next_action"] == "decide_shortfall"
    status, body = write(client, body["lot"], "shortfall-decision", choice="plant_accepts")
    assert status == 200, body
    assert body["lot"]["status"] == "closed"


@pytest.mark.parametrize(
    "action", ["proposal", "edits", "submit", "confirmations", "weight", "shortfall-decision"]
)
def test_unknown_lot_is_404(client, action):
    status, body, _ = client.call("POST", f"/api/lots/L-unknown/{action}", {"revision": 1})
    assert status == 404, body


def test_stale_revision_is_409(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body, _ = client.call(
        "POST", f"/api/lots/{lot['lot_id']}/proposal", {"revision": lot["revision"] + 5}
    )
    assert status == 409, body


def test_missing_revision_is_422(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body, _ = client.call("POST", f"/api/lots/{lot['lot_id']}/proposal", {})
    assert status == 422, body
    assert "revision" in json.dumps(body, ensure_ascii=False)


def test_lot_write_with_bad_body_is_400(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body, _ = client.call("POST", f"/api/lots/{lot['lot_id']}/proposal")
    assert status == 400
    assert body["code"] == "bad_body"


# --------------------------------------------------------- security headers

@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/", None),
        ("GET", "/api/config", None),
        ("GET", "/api/demo", None),
        ("GET", "/nope", None),
        ("POST", "/api/matches", {"material": "x"}),
    ],
)
def test_security_headers_present(client, method, path, body):
    _, headers, _ = client.raw(method, path, body)
    assert header_values(headers, "X-Content-Type-Options") == ["nosniff"]
    assert header_values(headers, "Referrer-Policy")
    csp = header_values(headers, "Content-Security-Policy")
    assert len(csp) == 1
    assert "https://static.line-scdn.net" in csp[0]
    assert "script-src" in csp[0]
