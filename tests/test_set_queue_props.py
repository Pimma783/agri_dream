# Feature: straw-lot-planning-demo, Property 10: A queue choice is accepted exactly when it is feasible
"""Property test for the set_queue edit.

Validates: Requirements 7.5, 7.6
"""

from __future__ import annotations

import io
import json
from datetime import timedelta
from http.cookies import SimpleCookie

from hypothesis import given, settings, strategies as st

import webapp
from decimal import Decimal

from lot_state import Order
from lot_planning import check_queue_pair, default_fixtures

from .conftest import FakeClock

FX = default_fixtures()
PLOTS = {p.plot_id: p for p in FX.plots}
BALE_IDS = [s.slot_id for s in FX.bale_slots]
HAUL_IDS = [s.slot_id for s in FX.haul_slots]
BALE = {s.slot_id: s for s in FX.bale_slots}
HAUL = {s.slot_id: s for s in FX.haul_slots}


class Client:
    def __init__(self, clock: FakeClock) -> None:
        self.app = webapp.create_app(clock=clock)
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


def _selected(lot: dict) -> list[str]:
    return [s["plot"]["plot_id"] for s in lot["selected"]]


def make_lot(days: int, target: int, removals: list[int]) -> tuple[Client, dict, FakeClock]:
    clock = FakeClock()
    client = Client(clock)
    delivery = (clock().date() + timedelta(days=days)).isoformat()
    status, body = client.call(
        "POST",
        "/api/orders",
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": target,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert status == 201, body
    lot = body["lot"]
    status, body = client.call(
        "POST", f"/api/lots/{lot['lot_id']}/proposal", {"revision": lot["revision"]}
    )
    assert status == 200, body
    lot = body["lot"]
    for idx in removals:
        ids = _selected(lot)
        if len(ids) <= 1:
            break
        status, body = client.call(
            "POST",
            f"/api/lots/{lot['lot_id']}/edits",
            {"revision": lot["revision"], "type": "remove_plot", "plot_id": ids[idx % len(ids)]},
        )
        assert status == 200, body
        lot = body["lot"]
    return client, lot, clock


@settings(max_examples=100, deadline=None)
@given(
    days=st.integers(min_value=1, max_value=10),
    target=st.sampled_from([5, 10, 20, 30]),
    removals=st.lists(st.integers(min_value=0, max_value=10), max_size=2),
    bale_id=st.sampled_from(BALE_IDS),
    haul_id=st.sampled_from(HAUL_IDS),
)
def test_queue_choice_accepted_exactly_when_feasible(days, target, removals, bale_id, haul_id):
    client, lot, _ = make_lot(days, target, removals)
    plots = [PLOTS[i] for i in _selected(lot)]
    if not plots:
        return  # no selection: set_queue is a field error, not a feasibility question
    expected = check_queue_pair(plots, _order_of(days, target), BALE[bale_id], HAUL[haul_id])
    prev = (lot["bale_slot_id"], lot["haul_slot_id"])

    status, body = client.call(
        "POST",
        f"/api/lots/{lot['lot_id']}/edits",
        {
            "revision": lot["revision"],
            "type": "set_queue",
            "bale_slot_id": bale_id,
            "haul_slot_id": haul_id,
        },
    )

    if not expected:
        assert 200 <= status < 300, body
        assert (body["lot"]["bale_slot_id"], body["lot"]["haul_slot_id"]) == (bale_id, haul_id)
    else:
        assert status == 422, body
        assert body["violations"]
        assert body["first_violation"] == body["violations"][0]
        assert [v["code"] for v in body["violations"]] == [v.code for v in expected]
        _, cur = client.call("GET", f"/api/lots/{lot['lot_id']}")
        cur_lot = cur.get("lot", cur)
        assert (cur_lot["bale_slot_id"], cur_lot["haul_slot_id"]) == prev
        assert cur_lot["revision"] == lot["revision"]


def _order_of(days: int, target: int) -> Order:
    return Order(
        order_id="O001",
        plant_id="B01",
        material="ฟางข้าว",
        target_tons=Decimal(target),
        offer_price=Decimal(1500),
        max_moisture_pct=Decimal(20),
        delivery_day=days,
    )
