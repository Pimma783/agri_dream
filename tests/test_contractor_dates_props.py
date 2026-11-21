# Feature: straw-lot-planning-demo, Property 15: Contractor dates must equal the selected slots
"""Contractor C01 confirms only when both dates equal the selected slot dates.

**Validates: Requirements 9.2, 9.3**
"""

from __future__ import annotations

import io
import json
from datetime import date, timedelta
from http.cookies import SimpleCookie

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import webapp

from .conftest import FakeClock

MISSING = object()  # key omitted from the request body


class _Client:
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
            "POST",
            f"/api/lots/{lot['lot_id']}/{action}",
            {"revision": lot["revision"], **payload},
        )


def _awaiting_lot() -> tuple[_Client, dict]:
    client = _Client()
    delivery = (client.clock().date() + timedelta(days=4)).isoformat()
    status, body = client.call(
        "POST",
        "/api/orders",
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": 10,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert status == 201, body
    status, body = client.write(body["lot"], "proposal")
    assert status == 200, body
    status, body = client.write(body["lot"], "submit")
    assert status == 200, body
    assert body["lot"]["status"] == "awaiting_confirmation"
    return client, body["lot"]


def _shift(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


@st.composite
def _date_value(draw, correct: str, other: str):
    """Either the correct ISO date or some wrong value (any JSON-able kind)."""
    wrong = st.one_of(
        st.integers(-60, 60).filter(bool).map(lambda d: _shift(correct, d)),  # shifted
        st.just(other),  # swapped with the other field's slot date
        st.just(MISSING),
        st.none(),
        st.integers(),
        st.floats(allow_nan=False, allow_infinity=False),
        st.booleans(),
        st.lists(st.integers(), max_size=2),
        st.dictionaries(st.text(max_size=3), st.integers(), max_size=2),
        st.text(max_size=12),  # malformed text
        st.sampled_from(
            ["2026-02-30", "2025-02-29", "2025-13-01", "2025-00-10", "2025-04-31", "0000-00-00"]
        ),
        st.sampled_from(["", " ", correct + " ", " " + correct, correct.replace("-", "/"),
                         correct + "T00:00:00", correct[2:], "２０２５-０１-０１"]),
    )
    return draw(st.one_of(st.just(correct), wrong))


def _payload(bale, haul) -> dict:
    out = {}
    if bale is not MISSING:
        out["bale_date"] = bale
    if haul is not MISSING:
        out["haul_date"] = haul
    return out


def _contractor(lot: dict) -> dict:
    return next(c for c in lot["confirmations"] if c["role"] == "contractor")


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(data=st.data())
def test_contractor_confirms_iff_dates_equal_selected_slots(data):
    client, lot = _awaiting_lot()
    bale_ok, haul_ok = lot["bale_date"], lot["haul_date"]
    assert isinstance(bale_ok, str) and isinstance(haul_ok, str)
    bale = data.draw(_date_value(bale_ok, haul_ok))
    haul = data.draw(_date_value(haul_ok, bale_ok))
    matches = bale == bale_ok and haul == haul_ok  # str equality; other types never equal
    contractor = _contractor(lot)

    status, body = client.write(lot, "confirmations", party_id=contractor["party_id"], **_payload(bale, haul))

    status_after, after = client.call("GET", f"/api/lots/{lot['lot_id']}")
    assert status_after == 200
    after_lot = after["lot"]

    if matches:
        assert status == 200, body
        assert _contractor(body["lot"])["confirmed"] is True
        assert body["lot"]["revision"] == lot["revision"] + 1
        assert _contractor(after_lot)["confirmed"] is True
    else:
        assert status == 422, body
        errors = body.get("errors", {})
        assert errors, body
        assert set(errors) <= {"bale_date", "haul_date"}
        assert ("bale_date" in errors) == (bale != bale_ok)
        assert ("haul_date" in errors) == (haul != haul_ok)
        # Wrong-but-valid or missing dates tell the coordinator to edit the queue first.
        for field, value, ok in (("bale_date", bale, bale_ok), ("haul_date", haul, haul_ok)):
            if value != ok:
                assert "ต้องแก้คิวก่อน" in errors[field]
        # Lot unchanged: contractor pending, status and revision as before.
        assert _contractor(after_lot)["confirmed"] is False
        assert after_lot["status"] == lot["status"] == "awaiting_confirmation"
        assert after_lot["revision"] == lot["revision"]
        assert after_lot["confirmations"] == lot["confirmations"]


@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    bale_shift=st.integers(-30, 30),
    haul_shift=st.integers(-30, 30),
)
def test_shifted_valid_dates_are_rejected_unless_both_exact(bale_shift, haul_shift):
    client, lot = _awaiting_lot()
    bale = _shift(lot["bale_date"], bale_shift)
    haul = _shift(lot["haul_date"], haul_shift)
    contractor = _contractor(lot)
    status, body = client.write(
        lot, "confirmations", party_id=contractor["party_id"], bale_date=bale, haul_date=haul
    )
    if bale_shift == 0 and haul_shift == 0:
        assert status == 200, body
    else:
        assert status == 422, body
        assert ("bale_date" in body["errors"]) == (bale_shift != 0)
        assert ("haul_date" in body["errors"]) == (haul_shift != 0)
        _, after = client.call("GET", f"/api/lots/{lot['lot_id']}")
        assert after["lot"]["revision"] == lot["revision"]
        assert _contractor(after["lot"])["confirmed"] is False
