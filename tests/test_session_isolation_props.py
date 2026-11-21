# Feature: straw-lot-planning-demo, Property 20: Sessions are isolated
"""Property 20: operations on one Session never change another Session.

**Validates: Requirements 13.2, 13.4, 13.10**
"""

from __future__ import annotations

import inspect
from datetime import datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

import lot_service
from lot_planning import default_fixtures
from lot_service import (
    SESSION_IDLE_LIMIT,
    SessionStore,
    apply_edit,
    confirm,
    create_order,
    decide_shortfall,
    get_lot,
    propose,
    record_weight,
    submit,
)
from lot_state import lot_to_json

_START = datetime(2025, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
_FX = default_fixtures()
_PLOT_IDS = [p.plot_id for p in _FX.plots]
_BALE_IDS = [s.slot_id for s in _FX.bale_slots]
_HAUL_IDS = [s.slot_id for s in _FX.haul_slots]

SETTINGS = settings(max_examples=100, deadline=None)


class _Clock:
    def __init__(self) -> None:
        self.now = _START

    def __call__(self) -> datetime:
        return self.now


def _snapshot(session) -> dict[str, str]:
    with session.lock:
        return {lid: lot_to_json(lot) for lid, lot in session.lots.items()}


@st.composite
def _ops(draw):
    kind = draw(
        st.sampled_from(
            [
                "create_order",
                "propose",
                "add_plot",
                "remove_plot",
                "set_price",
                "set_moisture",
                "set_queue",
                "submit",
                "confirm",
                "weight",
                "decide",
            ]
        )
    )
    return {
        "kind": kind,
        "target": draw(st.integers(0, 2)),
        "tons": draw(st.integers(1, 30)),
        "price": draw(st.integers(100, 5000)),
        "moisture": draw(st.integers(1, 60)),
        "plot": draw(st.sampled_from(_PLOT_IDS)),
        "bale": draw(st.sampled_from(_BALE_IDS)),
        "haul": draw(st.sampled_from(_HAUL_IDS)),
        "day": draw(st.integers(0, 10)),
        "pick": draw(st.integers(0, 50)),
        "actual": draw(st.integers(1, 60)),
        "choice": draw(st.sampled_from(["plant_accepts", "source_more"])),
    }


def _apply(session, op) -> None:
    """Run one operation on a session, always acting on its first/some lot."""
    kind = op["kind"]
    if kind == "create_order":
        delivery = (session.start_date + timedelta(days=op["day"])).isoformat()
        create_order(
            session,
            {
                "plant_id": "B01",
                "material": "ฟางข้าว",
                "target_tons": op["tons"],
                "offer_price": op["price"],
                "max_moisture_pct": 25,
                "delivery_date": delivery,
            },
        )
        return
    with session.lock:
        ids = list(session.lot_order)
        lot = session.lots[ids[op["pick"] % len(ids)]] if ids else None
    if lot is None:
        return
    rev, lid = lot.revision, lot.lot_id
    if kind == "propose":
        propose(session, lid, rev)
    elif kind == "add_plot":
        apply_edit(session, lid, rev, {"type": "add_plot", "plot_id": op["plot"]})
    elif kind == "remove_plot":
        apply_edit(session, lid, rev, {"type": "remove_plot", "plot_id": op["plot"]})
    elif kind == "set_price":
        apply_edit(session, lid, rev, {"type": "set_price", "offer_price": op["price"]})
    elif kind == "set_moisture":
        apply_edit(
            session,
            lid,
            rev,
            {"type": "set_moisture", "plot_id": op["plot"], "moisture_pct": op["moisture"]},
        )
    elif kind == "set_queue":
        apply_edit(
            session,
            lid,
            rev,
            {"type": "set_queue", "bale_slot_id": op["bale"], "haul_slot_id": op["haul"]},
        )
    elif kind == "submit":
        submit(session, lid, rev)
    elif kind == "confirm":
        if lot.confirmations:
            party = lot.confirmations[op["pick"] % len(lot.confirmations)]
            bale = next((s for s in _FX.bale_slots if s.slot_id == lot.bale_slot_id), None)
            haul = next((s for s in _FX.haul_slots if s.slot_id == lot.haul_slot_id), None)
            bd = hd = None
            if bale and haul:
                bd = (session.start_date + timedelta(days=bale.day)).isoformat()
                hd = (session.start_date + timedelta(days=haul.day)).isoformat()
            confirm(session, lid, rev, party.party_id, bd, hd)
    elif kind == "weight":
        record_weight(session, lid, rev, op["actual"])
    elif kind == "decide":
        decide_shortfall(session, lid, rev, op["choice"])


def _new_store():
    return SessionStore(_Clock())


def _make_sessions(store, n):
    sessions = [store.resolve(None)[0] for _ in range(n)]
    return sessions


@SETTINGS
@given(
    n=st.integers(2, 3),
    ops=st.lists(_ops(), min_size=1, max_size=40),
)
def test_operations_never_change_other_sessions(n, ops):
    store = _new_store()
    sessions = _make_sessions(store, n)
    assert len({s.session_id for s in sessions}) == n
    for op in ops:
        actor = op["target"] % n
        before = [_snapshot(s) for s in sessions]
        _apply(sessions[actor], op)
        after = [_snapshot(s) for s in sessions]
        for i in range(n):
            if i != actor:
                assert before[i] == after[i]


@SETTINGS
@given(
    ops=st.lists(_ops(), min_size=1, max_size=25),
    lot_count=st.integers(1, 3),
)
def test_lot_id_from_one_session_is_404_in_another(ops, lot_count):
    store = _new_store()
    a, b = _make_sessions(store, 2)
    for _ in range(lot_count):
        _apply(a, {**ops[0], "kind": "create_order"})
    for op in ops:
        _apply(a, op)
    for lid in list(a.lots):
        res = get_lot(b, lid)  # b has no lots
        assert (res.ok, res.http_status) == (False, 404)
        assert res.body["code"] == "lot_not_found"
        for result in (
            propose(b, lid, 0),
            apply_edit(b, lid, 0, {"type": "set_price", "offer_price": 100}),
            submit(b, lid, 0),
            confirm(b, lid, 0, "B01"),
            record_weight(b, lid, 0, 1),
            decide_shortfall(b, lid, 0, "plant_accepts"),
        ):
            assert result.http_status == 404
    assert b.lots == {}


@SETTINGS
@given(count=st.integers(2, 60))
def test_tokens_unique_and_at_least_16_bytes(count):
    store = _new_store()
    tokens = [store.resolve(None)[0].session_id for _ in range(count)]
    assert len(set(tokens)) == count
    for t in tokens:
        # urlsafe base64 text: decoded length is len*3/4 (unpadded)
        assert len(t) * 3 // 4 >= 16


@SETTINGS
@given(
    bad=st.one_of(
        st.text(max_size=60),
        st.binary(max_size=30).map(lambda b: b.hex()),
        st.just("../x"),
    ),
    idle_hours=st.integers(24, 100),
)
def test_fresh_invalid_or_expired_token_makes_new_session(bad, idle_hours):
    clock = _Clock()
    store = SessionStore(clock)
    existing, reset = store.resolve(None)
    assert reset is False  # no token: normal first visit
    assert store.resolve(existing.session_id) == (existing, False)

    if bad and bad != existing.session_id:
        s, reset = store.resolve(bad)
        assert reset is True
        assert s is not existing
        assert s.session_id != bad
        assert s.session_id != existing.session_id
        assert s.lots == {}
    s, reset = store.resolve("")
    assert reset is False and s is not existing

    # expired token never resolves to the old session
    clock.now = clock.now + timedelta(hours=idle_hours)
    assert clock.now - existing.last_seen >= SESSION_IDLE_LIMIT
    s, reset = store.resolve(existing.session_id)
    assert reset is True
    assert s is not existing
    assert s.session_id != existing.session_id


def test_no_line_user_id_used_as_key():
    src = inspect.getsource(lot_service.SessionStore) + inspect.getsource(
        lot_service.Session
    )
    lowered = src.lower()
    for word in ("userid", "user_id", "line_user"):
        assert word not in lowered
    store = SessionStore(_Clock())
    s, _ = store.resolve("U1234567890abcdef1234567890abcdef")  # LINE-style userId
    assert s.session_id != "U1234567890abcdef1234567890abcdef"
