"""Acceptance scenarios (task 6.5), run through the WSGI app with no network."""

from __future__ import annotations

import io
import json
from datetime import timedelta
from http.cookies import SimpleCookie

import pytest

import webapp
from lot_state import format_tons

from .conftest import FakeClock


class Client:
    """Minimal WSGI client that keeps the sid cookie."""

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


@pytest.fixture
def client(fake_clock: FakeClock) -> Client:
    return Client(fake_clock)


def order_body(clock: FakeClock, days: int = 4) -> dict:
    delivery = (clock().date() + timedelta(days=days)).isoformat()
    return {
        "plant_id": "B01",
        "material": "ฟางข้าว",
        "target_tons": 10,
        "offer_price": 1500,
        "max_moisture_pct": 20,
        "delivery_date": delivery,
    }


def create_lot(client: Client, clock: FakeClock, days: int = 4) -> dict:
    status, body = client.call("POST", "/api/orders", order_body(clock, days))
    assert status == 201, body
    return body["lot"]


def write(client: Client, lot: dict, action: str, **payload):
    status, body = client.call(
        "POST", f"/api/lots/{lot['lot_id']}/{action}", {"revision": lot["revision"], **payload}
    )
    return status, body


def submitted_lot(client: Client, clock: FakeClock) -> dict:
    lot = create_lot(client, clock)
    status, body = write(client, lot, "proposal")
    assert status == 200, body
    lot = body["lot"]
    status, body = write(client, lot, "submit")
    assert status == 200, body
    return body["lot"]


def confirm_all(client: Client, lot: dict) -> dict:
    for conf in lot["confirmations"]:
        extra = {}
        if conf["role"] == "contractor":
            extra = {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        status, body = write(client, lot, "confirmations", party_id=conf["party_id"], **extra)
        assert status == 200, body
        lot = body["lot"]
    return lot


def ready_lot(client: Client, clock: FakeClock) -> dict:
    lot = confirm_all(client, submitted_lot(client, clock))
    assert lot["status"] == "ready"
    return lot


def test_delivery_plus_3_days_is_rejected_at_submit(client, fake_clock):
    lot = create_lot(client, fake_clock, days=3)
    status, body = write(client, lot, "proposal")
    assert status == 200, body
    lot = body["lot"]

    status, body = write(client, lot, "submit")
    assert status == 422
    first = body["first_violation"]
    assert first["code"] == "delivery_date"
    assert first["subject_id"] == "S004"
    assert body["violations"] and body["violations"][0] == first

    status, got = client.call("GET", f"/api/lots/{lot['lot_id']}")
    assert status == 200
    assert got["lot"]["status"] == "draft"
    assert got["lot"]["confirmations"] == []
    assert got["lot"]["revision"] == lot["revision"]


def test_normal_close_with_ten_point_four_tons(client, fake_clock):
    lot = create_lot(client, fake_clock)
    status, body = write(client, lot, "proposal")
    assert status == 200, body
    lot = body["lot"]
    assert lot["estimated_tons"] == 12
    assert [p["plot"]["plot_id"] for p in lot["selected"]] == ["P001", "P002", "P003"]

    status, body = write(client, lot, "submit")
    assert status == 200, body
    lot = body["lot"]
    assert lot["status"] == "awaiting_confirmation"
    assert {c["party_id"] for c in lot["confirmations"]} == {"B01", "F01", "F02", "F03", "C01"}

    lot = confirm_all(client, lot)
    assert lot["status"] == "ready"
    assert lot["confirmed_count"] == lot["confirmation_total"] == 5

    status, body = write(client, lot, "weight", actual_tons=10.4)
    assert status == 200, body
    lot = body["lot"]
    assert lot["status"] == "closed"
    assert (lot["target_tons"], lot["estimated_tons"], lot["actual_tons"]) == (10, 12, 10.4)
    summary = (
        f"ออเดอร์ {format_tons(lot['target_tons'])} ตัน · "
        f"ประมาณการ {format_tons(lot['estimated_tons'])} ตัน · "
        f"รับจริง {format_tons(lot['actual_tons'])} ตัน"
    )
    assert summary == "ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน"


def test_missing_confirmation_stays_awaiting(client, fake_clock):
    lot = submitted_lot(client, fake_clock)
    for conf in lot["confirmations"]:
        if conf["party_id"] == "F03":
            continue
        extra = {}
        if conf["role"] == "contractor":
            extra = {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        status, body = write(client, lot, "confirmations", party_id=conf["party_id"], **extra)
        assert status == 200, body
        lot = body["lot"]
    assert lot["status"] == "awaiting_confirmation"
    assert lot["status_label"] == "รอยืนยัน"
    assert lot["confirmed_count"] == 4
    assert lot["pending_parties"] == ["เกษตรกรตัวอย่าง 3"]


def test_edit_after_all_confirmations_resets_to_awaiting(client, fake_clock):
    lot = ready_lot(client, fake_clock)
    status, body = write(client, lot, "edits", type="set_price", offer_price=1600)
    assert status == 200, body
    lot = body["lot"]
    assert lot["status"] == "awaiting_confirmation"
    assert lot["status_label"] == "รอยืนยัน"
    assert lot["confirmed_count"] == 0
    assert "reset_notice" in body


def test_weight_below_target_gives_pending_shortfall(client, fake_clock):
    lot = ready_lot(client, fake_clock)
    status, body = write(client, lot, "weight", actual_tons=9)
    assert status == 200, body
    lot = body["lot"]
    assert lot["status"] == "ready"
    assert lot["next_action"] == "decide_shortfall"
    assert lot["shortfall_decision"]["state"] == "pending"
    assert lot["shortfall_decision"]["shortfall_tons"] == 1

    for choice in ("plant_accepts", "source_more"):
        status, body = write(client, lot, "shortfall-decision", choice=choice)
        assert status == 200, body
        assert body["lot"]["status"] == "closed"
        # Re-open a fresh lot per choice in the same session.
        if choice == "plant_accepts":
            lot = ready_lot(client, fake_clock)
            status, body = write(client, lot, "weight", actual_tons=9)
            lot = body["lot"]
