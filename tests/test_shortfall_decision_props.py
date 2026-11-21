# Feature: straw-lot-planning-demo, Property 18: Shortfall decisions resolve and close the Lot
"""Property test for shortfall decisions. Validates: Requirements 12.4, 12.5, 12.6."""

from __future__ import annotations

import io
import json
from datetime import timedelta
from decimal import Decimal
from http.cookies import SimpleCookie

from hypothesis import given, settings, strategies as st

import webapp

from .conftest import FakeClock

TARGET = 10


class Client:
    def __init__(self) -> None:
        self.clock = FakeClock()
        self.app = webapp.create_app(clock=self.clock)
        self.sid: str | None = None

    def call(self, method: str, path: str, body: dict | None = None):
        raw = json.dumps(body).encode() if body is not None else b""
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "wsgi.input": io.BytesIO(raw),
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.url_scheme": "http",
        }
        if self.sid:
            environ["HTTP_COOKIE"] = f"sid={self.sid}"
        captured: dict = {}

        def start_response(status, headers):
            captured["status"] = int(status.split()[0])
            captured["headers"] = headers

        data = b"".join(self.app(environ, start_response))
        for name, value in captured["headers"]:
            if name == "Set-Cookie":
                morsel = SimpleCookie(value).get("sid")
                if morsel:
                    self.sid = morsel.value
        return captured["status"], json.loads(data)

    def write(self, lot: dict, action: str, **payload):
        return self.call(
            "POST", f"/api/lots/{lot['lot_id']}/{action}", {"revision": lot["revision"], **payload}
        )

    def get(self, lot: dict) -> dict:
        status, body = self.call("GET", f"/api/lots/{lot['lot_id']}")
        assert status == 200, body
        return body["lot"]


def create_lot(c: Client) -> dict:
    delivery = (c.clock().date() + timedelta(days=4)).isoformat()
    status, body = c.call(
        "POST",
        "/api/orders",
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": TARGET,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert status == 201, body
    return body["lot"]


def advance(c: Client, stage: str) -> dict:
    """Drive a fresh Lot to `stage`: created, proposed, awaiting, ready."""
    lot = create_lot(c)
    if stage == "created":
        return lot
    status, body = c.write(lot, "proposal")
    assert status == 200, body
    lot = body["lot"]
    if stage == "proposed":
        return lot
    status, body = c.write(lot, "submit")
    assert status == 200, body
    lot = body["lot"]
    if stage == "awaiting":
        return lot
    for conf in lot["confirmations"]:
        extra = {}
        if conf["role"] == "contractor":
            extra = {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        status, body = c.write(lot, "confirmations", party_id=conf["party_id"], **extra)
        assert status == 200, body
        lot = body["lot"]
    assert lot["status"] == "ready"
    return lot


def dec(value) -> Decimal:
    return Decimal(str(value))


shortfall_cents = st.integers(min_value=1, max_value=TARGET * 100 - 1)  # weight < target
choices = st.sampled_from(["plant_accepts", "source_more"])
bad_choices = st.one_of(
    st.none(),
    st.integers(),
    st.booleans(),
    st.text(max_size=20).filter(lambda s: s not in ("plant_accepts", "source_more")),
)
SETTINGS = settings(max_examples=100, deadline=None)


@SETTINGS
@given(cents=shortfall_cents, choice=choices)
def test_pending_shortfall_choice_resolves_and_closes(cents, choice):
    c = Client()
    lot = advance(c, "ready")
    weight = Decimal(cents) / 100
    status, body = c.write(lot, "weight", actual_tons=float(weight))
    assert status == 200, body
    lot = body["lot"]
    assert lot["status"] == "ready"
    assert lot["shortfall_decision"]["state"] == "pending"
    shortfall = dec(lot["shortfall_decision"]["shortfall_tons"])
    assert shortfall == TARGET - weight

    status, body = c.write(lot, "shortfall-decision", choice=choice)
    assert status == 200, body
    closed = body["lot"]
    assert closed["status"] == "closed"
    assert dec(closed["actual_tons"]) == weight  # plant accepts the actual weight
    sd = closed["shortfall_decision"]
    assert sd["state"] == "resolved"
    assert sd["resolution"] == choice
    expected = Decimal(0) if choice == "plant_accepts" else shortfall
    assert dec(sd["remaining_to_source_tons"]) == expected
    assert dec(sd["shortfall_tons"]) == shortfall

    # A repeated decision on the closed lot is 409 and changes nothing.
    status, body = c.write(closed, "shortfall-decision", choice=choice)
    assert status == 409, body
    assert c.get(closed) == closed


@SETTINGS
@given(cents=shortfall_cents, bad=bad_choices)
def test_invalid_choice_is_422_and_changes_nothing(cents, bad):
    c = Client()
    lot = advance(c, "ready")
    status, body = c.write(lot, "weight", actual_tons=float(Decimal(cents) / 100))
    assert status == 200, body
    lot = body["lot"]
    before = c.get(lot)

    status, body = c.write(lot, "shortfall-decision", choice=bad)
    assert status == 422, body
    assert c.get(lot) == before
    assert before["status"] == "ready"
    assert before["shortfall_decision"]["state"] == "pending"


@SETTINGS
@given(
    stage=st.sampled_from(["created", "proposed", "awaiting", "ready", "met_target"]),
    extra_cents=st.integers(min_value=0, max_value=5000),
    choice=st.one_of(choices, bad_choices),
)
def test_no_pending_decision_is_409_and_changes_nothing(stage, extra_cents, choice):
    c = Client()
    if stage == "met_target":
        lot = advance(c, "ready")
        weight = float(Decimal(TARGET) + Decimal(extra_cents) / 100)
        status, body = c.write(lot, "weight", actual_tons=weight)
        assert status == 200, body
        lot = body["lot"]
        assert lot["status"] == "closed"
    else:
        lot = advance(c, stage)
    before = c.get(lot)

    status, body = c.write(lot, "shortfall-decision", choice=choice)
    assert status == 409, body
    assert c.get(lot) == before
