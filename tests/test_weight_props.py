# Feature: straw-lot-planning-demo, Property 17: Weight outcome depends only on status and value
"""Property 17 (task 4.18): weight outcome depends only on status and value.

**Validates: Requirements 11.1, 11.3, 11.4, 11.5, 12.1, 12.2**
"""

from __future__ import annotations

import math
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

import lot_service as svc
from lot_state import Status

from .conftest import FakeClock

CENT = Decimal("0.01")
SETTINGS = settings(max_examples=100, deadline=None)


def half_up(value: float | int) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ helpers


def new_session() -> tuple[svc.Session, FakeClock]:
    clock = FakeClock()
    return svc.Session("tok", clock(), clock), clock


def order_payload(clock: FakeClock, target) -> dict:
    return {
        "plant_id": "B01",
        "material": "ฟางข้าว",
        "target_tons": target,
        "offer_price": 1500,
        "max_moisture_pct": 20,
        "delivery_date": (clock().date() + timedelta(days=4)).isoformat(),
    }


def ok(result) -> dict:
    assert result.ok, result.body
    return result.body["lot"]


def make_lot(target, upto: str):
    """Build a Lot through the service up to draft/awaiting/ready."""
    session, clock = new_session()
    lot = ok(svc.create_order(session, order_payload(clock, target)))
    lid = lot["lot_id"]
    if upto == "draft":
        return session, lid
    lot = ok(svc.propose(session, lid, lot["revision"]))
    lot = ok(svc.submit(session, lid, lot["revision"]))
    if upto == "awaiting":
        return session, lid
    for conf in lot["confirmations"]:
        extra = {}
        if conf["role"] == "contractor":
            extra = {"bale_date": lot["bale_date"], "haul_date": lot["haul_date"]}
        lot = ok(svc.confirm(session, lid, lot["revision"], conf["party_id"], **extra))
    assert lot["status"] == "ready"
    return session, lid


def snapshot(session, lid):
    return session.lots[lid]


def weigh(session, lid, value):
    return svc.record_weight(session, lid, session.lots[lid].revision, value)


# --------------------------------------------------------------- strategies

targets = st.integers(min_value=1, max_value=1200).map(lambda n: Decimal(n) / 100)
# Finite numbers in (0, 100] with up to 4 decimals; includes ties and sub-cent values.
valid_values = st.one_of(
    st.integers(min_value=1, max_value=1_000_000).map(lambda n: float(Decimal(n) / 10000)),
    st.integers(min_value=1, max_value=100).map(int),
).filter(lambda v: half_up(v) > 0)
invalid_values = st.one_of(
    st.sampled_from(
        [0, 0.0, -0.0, 0.004, 0.0049, -1, -0.01, 100.01, 101, 1e9, math.nan, math.inf,
         -math.inf, True, False, "5", "", None, [], {}, [1]]
    ),
    st.floats(max_value=0, allow_nan=False, allow_infinity=True),
    st.floats(min_value=100.0001, allow_nan=False, allow_infinity=True),
    st.floats(min_value=0.0, max_value=0.0049, exclude_min=True),
    st.text(max_size=5),
)


def js(value) -> float | int:
    return int(value) if value == value.to_integral_value() else float(value)


def target_json(target: Decimal):
    return js(target)


# --------------------------------------------------------------- properties


@SETTINGS
@given(target=targets, value=valid_values)
def test_valid_weight_outcome(target, value):
    session, lid = make_lot(target_json(target), "ready")
    before = snapshot(session, lid)
    result = weigh(session, lid, value)
    assert result.ok and result.http_status == 200, result.body
    after = snapshot(session, lid)
    stored = half_up(value)
    assert after.actual_tons == stored
    assert after.revision == before.revision + 1
    if stored >= target:
        assert after.status is Status.CLOSED
        assert after.shortfall is None
    else:
        assert after.status is Status.READY
        assert after.shortfall is not None
        assert after.shortfall.state == "pending"
        assert after.shortfall.shortfall_tons == (target - stored).quantize(CENT)


@SETTINGS
@given(target=targets, first=valid_values, second=valid_values)
def test_later_weight_replaces_earlier(target, first, second):
    session, lid = make_lot(target_json(target), "ready")
    r1 = weigh(session, lid, first)
    assert r1.ok
    if session.lots[lid].status is Status.CLOSED:
        # Closed lots reject further weights (covered by the wrong-status property).
        r2 = weigh(session, lid, second)
        assert r2.http_status == 409
        assert session.lots[lid].actual_tons == half_up(first)
        return
    r2 = weigh(session, lid, second)
    assert r2.ok, r2.body
    after = session.lots[lid]
    stored = half_up(second)
    assert after.actual_tons == stored
    if stored >= target:
        assert after.status is Status.CLOSED
        assert after.shortfall is None  # 12.2 clears the pending decision
    else:
        assert after.status is Status.READY
        assert after.shortfall.state == "pending"
        assert after.shortfall.shortfall_tons == (target - stored).quantize(CENT)


@SETTINGS
@given(target=targets, value=invalid_values, first=st.one_of(st.none(), valid_values))
def test_invalid_value_is_422_and_unchanged(target, value, first):
    session, lid = make_lot(target_json(target), "ready")
    if first is not None:
        assert weigh(session, lid, first).ok
        if session.lots[lid].status is not Status.READY:
            return  # closed; wrong-status case is a separate property
    before = snapshot(session, lid)
    result = weigh(session, lid, value)
    assert not result.ok and result.http_status == 422, (value, result.body)
    assert "actual_tons" in result.body["errors"]
    assert snapshot(session, lid) == before


@SETTINGS
@given(
    target=targets,
    value=st.one_of(valid_values, invalid_values),
    upto=st.sampled_from(["draft", "awaiting"]),
)
def test_wrong_status_is_409_and_unchanged(target, value, upto):
    session, lid = make_lot(target_json(target), upto)
    before = snapshot(session, lid)
    result = weigh(session, lid, value)
    assert not result.ok and result.http_status == 409, (upto, value, result.body)
    assert snapshot(session, lid) == before


@SETTINGS
@given(target=targets, final=valid_values, value=st.one_of(valid_values, invalid_values))
def test_closed_lot_rejects_weight_with_409(target, final, value):
    session, lid = make_lot(target_json(target), "ready")
    # Close by weighing at or above target (<= 100 always valid for target <= 12).
    assert weigh(session, lid, 12).ok
    assert session.lots[lid].status is Status.CLOSED
    before = snapshot(session, lid)
    result = weigh(session, lid, value)
    assert not result.ok and result.http_status == 409
    assert snapshot(session, lid) == before
