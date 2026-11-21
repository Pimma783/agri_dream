# Feature: straw-lot-planning-demo, Property 22: Idle Sessions expire at 24 hours
"""Property test for Session idle expiry and caps. Validates: Requirements 13.8"""
from __future__ import annotations

from datetime import timedelta
from itertools import count

from hypothesis import given, settings, strategies as st

import lot_service
from lot_service import MAX_LOTS_PER_SESSION, MAX_SESSIONS, SessionStore, create_order
from tests.conftest import FakeClock

LIMIT_S = 24 * 3600
SETTINGS = settings(max_examples=100, deadline=None)


def make_store(max_sessions: int = MAX_SESSIONS) -> tuple[FakeClock, SessionStore]:
    clock = FakeClock()
    ids = count()
    return clock, SessionStore(clock, lambda: f"tok{next(ids)}", max_sessions)


def order_payload(session) -> dict:
    return {
        "plant_id": "B01",
        "material": "ฟางข้าว",
        "target_tons": 10,
        "offer_price": 1500,
        "max_moisture_pct": 20,
        "delivery_date": (session.start_date + timedelta(days=4)).isoformat(),
    }


# Idle seconds clustered around the 24 h boundary plus wide values.
idle_s = st.one_of(
    st.integers(0, 2 * LIMIT_S),
    st.integers(LIMIT_S - 3, LIMIT_S + 3),
)


def add_lot(session) -> None:
    assert create_order(session, order_payload(session)).http_status == 201


@SETTINGS
@given(idle=idle_s, via_sweep=st.booleans())
def test_idle_boundary(idle: int, via_sweep: bool) -> None:
    clock, store = make_store()
    session, reset = store.resolve(None)
    assert not reset
    add_lot(session)
    token = session.session_id
    clock.advance(seconds=idle)
    if via_sweep:
        store.sweep()
        alive = len(store) == 1
        assert alive == (idle < LIMIT_S)
        if alive:
            again, reset = store.resolve(token)
            assert again is session and not reset and len(again.lots) == 1
        else:
            assert len(store) == 0
    else:
        again, reset = store.resolve(token)
        if idle < LIMIT_S:
            assert again is session and not reset
            assert len(again.lots) == 1
        else:
            assert reset
            assert again.session_id != token
            assert again.lots == {}
            assert len(store) == 1  # old session and its lots are gone


@SETTINGS
@given(steps=st.lists(st.integers(0, LIMIT_S - 1), min_size=1, max_size=8))
def test_sliding_expiry(steps: list[int]) -> None:
    clock, store = make_store()
    session, _ = store.resolve(None)
    token = session.session_id
    total = 0
    for step in steps:
        clock.advance(seconds=step)
        total += step
        again, reset = store.resolve(token)  # any request refreshes last_seen
        assert again is session and not reset
        assert again.last_seen == clock()
    assert total >= 0
    clock.advance(seconds=LIMIT_S - 1)
    assert store.resolve(token)[1] is False
    clock.advance(seconds=LIMIT_S)
    assert store.resolve(token)[1] is True


@SETTINGS
@given(extra=st.integers(1, 5), cap=st.integers(1, 8))
def test_session_cap_evicts_oldest(extra: int, cap: int) -> None:
    clock, store = make_store(cap)
    tokens = []
    for _ in range(cap + extra):
        clock.advance(seconds=1)
        session, _ = store.resolve(None)
        tokens.append(session.session_id)
        assert len(store) <= cap
    assert len(store) == cap
    for old in tokens[:extra]:
        assert store.resolve(old)[1] is True  # evicted
    # default cap constant is the documented 500
    assert MAX_SESSIONS == 500


def test_default_session_cap_500() -> None:
    clock, store = make_store()
    for _ in range(MAX_SESSIONS + 1):
        clock.advance(seconds=1)
        store.resolve(None)
    assert len(store) == MAX_SESSIONS


@SETTINGS
@given(extra=st.integers(1, 3))
def test_lot_cap_409(extra: int) -> None:
    _, store = make_store()
    session, _ = store.resolve(None)
    for _ in range(MAX_LOTS_PER_SESSION):
        add_lot(session)
    for _ in range(extra):
        res = create_order(session, order_payload(session))
        assert res.http_status == 409
        assert res.body["code"] == "lot_cap"
    assert len(session.lots) == MAX_LOTS_PER_SESSION == 20
    assert lot_service.MAX_LOTS_PER_SESSION == 20
