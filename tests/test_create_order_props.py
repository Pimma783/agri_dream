# Feature: straw-lot-planning-demo, Property 3: Order creation is all-or-nothing
"""Property test for lot_service.create_order. Validates: Requirements 3.1, 3.3, 3.4."""
from __future__ import annotations

import itertools
from datetime import timedelta
from decimal import Decimal

from hypothesis import given, settings, strategies as st

from lot_service import SessionStore, create_order
from lot_state import Status, lot_to_json
from tests.conftest import FakeClock

FIELDS = (
    "plant_id", "material", "target_tons", "offer_price", "max_moisture_pct", "delivery_date",
)
STRAW = "ฟางข้าว"
MISSING = object()  # sentinel: the key is left out of the payload


def new_session():
    counter = itertools.count(1)
    store = SessionStore(FakeClock(), token_factory=lambda: f"tok{next(counter)}")
    session, _ = store.resolve(None)
    return session


def snapshot(session):
    return (
        {k: lot_to_json(v) for k, v in session.lots.items()},
        list(session.lot_order),
        session.next_seq,
    )


def number_or_int(value: Decimal):
    return int(value) if value == value.to_integral_value() else float(value)


_BAD_TYPES = st.sampled_from(
    [True, False, "5", "", None, float("nan"), float("inf"), float("-inf"), [], {}]
)


def _num_field(valid, invalid_range):
    return st.one_of(
        st.tuples(valid, st.just(True)),
        st.tuples(invalid_range, st.just(False)),
        st.tuples(_BAD_TYPES, st.just(False)),
        st.tuples(st.just(MISSING), st.just(False)),
    )


# Each strategy yields (value, is_valid).
plant = st.one_of(
    st.tuples(st.sampled_from(["B01", "B02", "B03"]), st.just(True)),
    # closed (B06), non-straw (B04, B05), unknown ids, wrong types
    st.tuples(st.sampled_from(["B04", "B05", "B06", "B99", "", "b01"]), st.just(False)),
    st.tuples(st.one_of(_BAD_TYPES, st.integers()), st.just(False)),
    st.tuples(st.just(MISSING), st.just(False)),
)
material = st.one_of(
    st.tuples(st.just(STRAW), st.just(True)),
    st.tuples(st.sampled_from(["ซังข้าวโพด", "ใบอ้อย", "straw", ""]), st.just(False)),
    st.tuples(st.one_of(_BAD_TYPES, st.integers()), st.just(False)),
    st.tuples(st.just(MISSING), st.just(False)),
)
tons = _num_field(
    st.integers(1, 10000).map(lambda c: number_or_int(Decimal(c) / 100)),
    st.one_of(
        st.integers(-1000, 0).map(lambda c: c / 10),
        st.integers(10001, 100000).map(lambda c: c / 100),
        st.integers(1, 99999).filter(lambda c: c % 10 != 0).map(lambda c: c / 1000),
    ).filter(lambda x: not (0 < x <= 100) or round(x, 2) != x),
)
price = _num_field(
    st.integers(1, 10_000_000).map(lambda c: number_or_int(Decimal(c) / 100)),
    st.one_of(
        st.integers(-100000, 0),
        st.integers(100001, 10**9),
        st.just(0.0),
        st.just(100000.01),
    ),
)
moisture = _num_field(
    st.integers(100, 10000).map(lambda c: number_or_int(Decimal(c) / 100)),
    st.one_of(
        st.integers(-50, 0),
        st.integers(101, 1000),
        st.just(0.99),
        st.just(100.01),
    ),
)
_BAD_DATES = st.sampled_from(
    ["2025-1-1", "2025-02-30", "01-01-2025", "2025/01/05", "not a date", "", "2025-13-01",
     " 2025-01-05", "2025-01-05T00:00"]
)
delivery = st.one_of(
    st.tuples(st.integers(0, 400), st.just(True)).map(lambda t: (("day", t[0]), True)),
    st.tuples(st.integers(1, 400).map(lambda n: ("day", -n)), st.just(False)),
    st.tuples(_BAD_DATES, st.just(False)),
    st.tuples(st.one_of(_BAD_TYPES, st.integers()), st.just(False)),
    st.tuples(st.just(MISSING), st.just(False)),
)


def build_payload(session, parts):
    payload, invalid = {}, set()
    for name, (value, ok) in zip(FIELDS, parts):
        if isinstance(value, tuple) and value and value[0] == "day":
            value = (session.start_date + timedelta(days=value[1])).isoformat()
        if value is not MISSING:
            payload[name] = value
        if not ok:
            invalid.add(name)
    return payload, invalid


payload_parts = st.tuples(plant, material, tons, price, moisture, delivery)
valid_parts = payload_parts.filter(lambda parts: all(ok for _, ok in parts))


@settings(max_examples=150, deadline=None)
@given(parts=valid_parts)
def test_valid_payload_creates_one_draft_lot(parts):
    session = new_session()
    payload, invalid = build_payload(session, parts)
    assert not invalid
    result = create_order(session, payload)
    assert result.http_status == 201 and result.ok
    assert len(session.lots) == 1 and session.lot_order == ["L001"]
    lot = session.lots["L001"]
    assert lot.status is Status.DRAFT
    assert lot.revision == 0
    assert lot.order.order_id == "O001"
    assert lot.order.plant_id == payload["plant_id"]
    assert lot.order.target_tons == Decimal(str(payload["target_tons"]))
    assert lot.order.offer_price == Decimal(str(payload["offer_price"]))
    assert lot.order.max_moisture_pct == Decimal(str(payload["max_moisture_pct"]))
    assert (
        session.start_date + timedelta(days=lot.order.delivery_day)
    ).isoformat() == payload["delivery_date"]
    assert session.next_seq == 2


@settings(max_examples=300, deadline=None)
@given(parts=payload_parts.filter(lambda parts: not all(ok for _, ok in parts)))
def test_invalid_payload_names_every_bad_field_and_changes_nothing(parts):
    session = new_session()
    # A prior valid lot proves "unchanged" is about existing state, not only emptiness.
    seed = {
        "plant_id": "B01", "material": STRAW, "target_tons": 5, "offer_price": 300,
        "max_moisture_pct": 20,
        "delivery_date": (session.start_date + timedelta(days=5)).isoformat(),
    }
    assert create_order(session, seed).http_status == 201
    before = snapshot(session)
    payload, invalid = build_payload(session, parts)
    result = create_order(session, payload)
    assert not result.ok and result.http_status in (400, 422)
    assert set(result.body["errors"]) == invalid
    assert snapshot(session) == before


@settings(max_examples=100, deadline=None)
@given(
    body=st.one_of(
        st.none(), st.integers(), st.text(), st.booleans(), st.lists(st.integers()),
        st.floats(allow_nan=True),
    )
)
def test_non_object_body_is_rejected_without_change(body):
    session = new_session()
    before = snapshot(session)
    result = create_order(session, body)
    assert not result.ok and result.http_status in (400, 422)
    assert snapshot(session) == before
