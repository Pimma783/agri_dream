"""Serve the F3 web and LIFF demo as a WSGI application.

Routes are registered in ROUTES with the `route` decorator. A handler takes a
`Request` and returns `(http_status, json_value)`. Handlers that need the
demo Session call `req.session()`; static files and the F3 endpoints never do,
so they never create a Session (13.1).
"""
import json
import logging
import os
import re
import time
from datetime import datetime
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

import lot_service
from lot_fixtures import (
    BALING_PER_TON,
    BUFFER_PERCENT,
    DEFAULT_MAX_MOISTURE,
    HAUL_PER_TON_KM,
    ORDER_PLANT_IDS,
    RICE_STRAW,
    SLOT_CAPACITY_TONS,
    STRAW_PRICE_PER_TON,
)
from lot_planning import build_view
from lot_service import SessionStore, to_jsonable
from matching import BUYERS, MATERIALS, PILOT_PROVINCES, find_biomass_buyers

WEB = Path(__file__).with_name("web")
ASSETS = {
    "/": ("index.html", "text/html"),
    "/app.js": ("app.js", "text/javascript"),
    "/lot.js": ("lot.js", "text/javascript"),
    "/style.css": ("style.css", "text/css"),
}
MAX_BODY_BYTES = 4096
MSG_NOT_FOUND = "ไม่พบหน้านี้"
MSG_METHOD = "ไม่รองรับวิธีเรียกนี้"
MSG_SERVER_ERROR = "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง"
MSG_BAD_BODY = "ข้อมูลไม่ถูกต้อง"
MSG_BAD_SEARCH = "ข้อมูลค้นหาไม่ถูกต้อง"  # unchanged text for /api/matches

CSP = "; ".join((
    "default-src 'self'",
    "script-src 'self' https://static.line-scdn.net",
    "style-src 'self'",
    "img-src 'self' data: https://*.line-scdn.net",
    "connect-src 'self' https://*.line.me https://*.line-scdn.net",
    "object-src 'none'",
    "base-uri 'self'",
))

log = logging.getLogger("webapp")


class BadRequest(Exception):
    """Raised by Request.json when the body is not an acceptable JSON object."""


class Request:
    def __init__(self, environ, store, params):
        self.environ = environ
        self.store = store
        self.params = params
        self.method = environ["REQUEST_METHOD"]
        self.path = environ["PATH_INFO"]
        self._session = None
        self.session_reset = False
        self.new_token = None

    def cookie(self, name):
        raw = self.environ.get("HTTP_COOKIE", "")
        try:
            jar = SimpleCookie(raw)
        except CookieError:
            return None
        morsel = jar.get(name)
        return morsel.value if morsel else None

    def session(self):
        """Resolve (or create) the Session for this request."""
        if self._session is None:
            sent = self.cookie("sid")
            session, was_reset = self.store.resolve(sent)
            self._session = session
            self.session_reset = was_reset
            if session.session_id != sent:
                self.new_token = session.session_id
        return self._session

    def json(self, message=MSG_BAD_BODY):
        """Read a JSON object of at most 4096 bytes, else raise BadRequest(message)."""
        try:
            size = int(self.environ.get("CONTENT_LENGTH") or 0)
            if not 0 < size <= MAX_BODY_BYTES:
                raise ValueError
            body = json.loads(self.environ["wsgi.input"].read(size))
            if not isinstance(body, dict):
                raise ValueError
        except (ValueError, UnicodeError, RecursionError):
            raise BadRequest(message) from None
        return body

    @property
    def is_https(self):
        proto = self.environ.get("HTTP_X_FORWARDED_PROTO", "").split(",")[0].strip().lower()
        return self.environ.get("wsgi.url_scheme") == "https" or proto == "https"

    def session_cookie(self):
        value = f"sid={self.new_token}; Path=/; HttpOnly; SameSite=Lax"
        return value + "; Secure" if self.is_https else value


# ------------------------------------------------------------------ routing

ROUTES = []  # (method, compiled path regex, handler)


def route(method, pattern):
    """Register a handler. `pattern` is a regex; named groups go to req.params."""
    compiled = re.compile(pattern)

    def register(handler):
        ROUTES.append((method, compiled, handler))
        return handler
    return register


def dispatch(req):
    allowed = set()
    for method, pattern, handler in ROUTES:
        found = pattern.fullmatch(req.path)
        if not found:
            continue
        if method == req.method:
            req.params = found.groupdict()
            return handler(req)
        allowed.add(method)
    if allowed:
        return 405, {"message": MSG_METHOD}, {"Allow": ", ".join(sorted(allowed))}
    return 404, {"message": MSG_NOT_FOUND}


def respond(start_response, status, content_type, body, extra_headers=()):
    start_response(status, [
        ("Content-Type", f"{content_type}; charset=utf-8"),
        ("Content-Length", str(len(body))),
        ("Referrer-Policy", "no-referrer"),
        ("X-Content-Type-Options", "nosniff"),
        ("Content-Security-Policy", CSP),
        *extra_headers,
    ])
    return [body]


def status_line(code):
    return f"{code} {HTTPStatus(code).phrase}"


def json_response(start_response, status, value, extra_headers=()):
    return respond(start_response, status, "application/json",
                   json.dumps(value, ensure_ascii=False).encode(), extra_headers)


# ------------------------------------------------------------------- routes

def static_handler(req):
    filename, mime = ASSETS[req.path]
    try:
        body = (WEB / filename).read_bytes()
    except OSError:
        return 404, {"message": MSG_NOT_FOUND}
    return 200, (mime, body)


for _path in ASSETS:
    route("GET", re.escape(_path))(static_handler)


@route("GET", r"/api/config")
def api_config(req):
    return 200, {
        "liff_id": os.getenv("LIFF_ID", ""),
        "materials": sorted(MATERIALS),
        "provinces": sorted(PILOT_PROVINCES),
    }


@route("POST", r"/api/matches")
def api_matches(req):
    try:
        body = req.json(MSG_BAD_SEARCH)
    except BadRequest as err:
        return 400, {"message": str(err)}
    material = body.get("material")
    province = body.get("province")
    quantity = body.get("quantity_tons")
    try:
        tons = float(quantity) if type(quantity) in (int, float) else 0
    except OverflowError:
        tons = 0
    result = find_biomass_buyers(
        material if isinstance(material, str) else "",
        tons,
        province if isinstance(province, str) else "",
    )
    return (422 if "errors" in result else 200), result


def _rates():
    estimate = "ประมาณการ"
    return [
        {"key": "straw", "label": "ค่าฟาง", "value": STRAW_PRICE_PER_TON,
         "unit": "บาท/ตัน", "note": estimate},
        {"key": "baling", "label": "ค่าอัดก้อน", "value": BALING_PER_TON,
         "unit": "บาท/ตัน", "note": estimate},
        {"key": "haul", "label": "ค่าขนส่ง", "value": HAUL_PER_TON_KM,
         "unit": "บาท/ตัน/กม.", "note": estimate},
        {"key": "slot_capacity", "label": "ความจุคิวต่อวัน", "value": SLOT_CAPACITY_TONS,
         "unit": "ตัน", "note": "ข้อมูลจำลอง"},
        {"key": "buffer", "label": "เป้าหมายสำรอง", "value": BUFFER_PERCENT,
         "unit": "% ของเป้า", "note": estimate},
    ]


@route("GET", r"/api/demo")
def api_demo(req):
    session = req.session()
    plants = [{
        "plant_id": pid,
        "name": BUYERS[pid][0],
        "min_tons": BUYERS[pid][2],
        "price_thb_per_ton": BUYERS[pid][4],
        "price_note": "ข้อมูลจำลอง",
    } for pid in ORDER_PLANT_IDS]
    with session.lock:
        lots = []
        for lot_id in session.lot_order:
            view = build_view(session.lots[lot_id], None, session.start_date)
            lots.append({
                "lot_id": view.lot_id,
                "revision": view.revision,
                "status": view.status,
                "status_label": view.status_label,
                "next_action": view.next_action,
                "target_tons": view.target_tons,
                "estimated_tons": view.estimated_tons,
                "shortfall_tons": view.shortfall_tons,
                "confirmed_count": view.confirmed_count,
                "confirmation_total": view.confirmation_total,
                "actual_tons": view.actual_tons,
                "shortfall_decision": view.shortfall_decision,
            })
    return 200, to_jsonable({
        "plants": plants,
        "preset": {
            "material": RICE_STRAW,
            "target_tons": 10,
            "max_moisture_pct": DEFAULT_MAX_MOISTURE,
        },
        "rates": _rates(),
        "lots": lots,
        "session_reset": req.session_reset,
        "today": req.store.today().isoformat(),
        "liff_id": os.getenv("LIFF_ID", ""),
    })


# -------------------------------------------------------------- lot endpoints

def _lot_result(result):
    """Map a service Result to (status, body). Adds top-level first_violation
    (element 0 of violations) whenever the response carries violations (16.2)."""
    body = result.body
    if "first_violation" not in body:
        violations = body.get("violations")
        if violations is None:
            lot = body.get("lot")
            violations = lot.get("violations") if isinstance(lot, dict) else None
        if violations:
            body["first_violation"] = violations[0]
    return result.http_status, body


def _lot_write(req, call):
    """Read the JSON body, then call `call(session, lot_id, revision, body)`.

    `revision` is passed as sent (None when missing). The service answers
    404, 409 revision, 409 status, then 422; a missing revision is a 422 on
    the `revision` field.
    """
    try:
        body = req.json()
    except BadRequest as err:
        return 400, {"message": str(err), "code": "bad_body"}
    return _lot_result(call(req.session(), req.params["lot_id"], body.get("revision"), body))


@route("POST", r"/api/orders")
def api_create_order(req):
    try:
        body = req.json()
    except BadRequest as err:
        return 400, {"message": str(err), "code": "bad_body"}
    return _lot_result(lot_service.create_order(req.session(), body))


@route("GET", r"/api/lots/(?P<lot_id>[^/]+)")
def api_get_lot(req):
    return _lot_result(lot_service.get_lot(req.session(), req.params["lot_id"]))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/proposal")
def api_proposal(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.propose(s, i, r))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/edits")
def api_edits(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.apply_edit(s, i, r, b))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/submit")
def api_submit(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.submit(s, i, r))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/confirmations")
def api_confirmations(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.confirm(
        s, i, r, b.get("party_id"), b.get("bale_date"), b.get("haul_date")))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/weight")
def api_weight(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.record_weight(
        s, i, r, b.get("actual_tons")))


@route("POST", r"/api/lots/(?P<lot_id>[^/]+)/shortfall-decision")
def api_shortfall(req):
    return _lot_write(req, lambda s, i, r, b: lot_service.decide_shortfall(
        s, i, r, b.get("choice")))


# ---------------------------------------------------------------- app factory

class _Store:
    """SessionStore plus the injected clock, so handlers can read today's date."""

    def __init__(self, clock):
        self._clock = clock
        self._inner = SessionStore(clock)

    def resolve(self, token):
        return self._inner.resolve(token)

    def today(self):
        return self._clock().date()

    def __getattr__(self, name):
        return getattr(self._inner, name)


def create_app(clock=datetime.now, store=None):
    """Build a WSGI app. Tests inject `clock` (a callable returning datetime)."""
    store = store or _Store(clock)

    def app(environ, start_response):
        started = time.perf_counter()
        method = environ.get("REQUEST_METHOD", "")
        path = environ.get("PATH_INFO", "")
        req = Request(environ, store, {})
        extra = []
        try:
            result = dispatch(req)
            code, payload = result[0], result[1]
            if len(result) > 2:
                extra.extend(result[2].items())
            if req.new_token:
                extra.append(("Set-Cookie", req.session_cookie()))
            if code == 200 and isinstance(payload, tuple):
                mime, body = payload
                out = respond(start_response, status_line(code), mime, body, extra)
            else:
                out = json_response(start_response, status_line(code), payload, extra)
        except Exception as err:  # no stack trace, no details to the client
            code = 500
            log.error("unhandled %s", type(err).__name__)
            out = json_response(start_response, status_line(500), {"message": MSG_SERVER_ERROR})
        log.info("%s %s %d %.1fms", method, path, code, (time.perf_counter() - started) * 1000)
        return out

    return app


application = create_app()


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):  # access logging is done in `app`
        pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with make_server("127.0.0.1", int(os.getenv("PORT", "8000")), application,
                     handler_class=QuietHandler) as server:
        print(f"http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()
