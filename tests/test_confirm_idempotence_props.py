# Feature: straw-lot-planning-demo, Property 14: Recording a Confirmation twice changes nothing
"""Property 14 (task 4.15). **Validates: Requirements 9.6, 9.7**

In awaiting_confirmation, confirming an already-confirmed party again returns
success and leaves lot_to_json identical (original confirmed_at, same revision,
same counts). A repeated confirm on a Lot that is already ready returns 409 and
leaves the Lot unchanged.
"""

from __future__ import annotations

from datetime import timedelta

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

import lot_service
from lot_state import Status, lot_to_json

from .conftest import FakeClock

PROP_SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)


def _submitted(days: int, plant: str):
    clock = FakeClock()
    store = lot_service.SessionStore(clock)
    session, _ = store.resolve(None)
    delivery = (clock().date() + timedelta(days=days)).isoformat()
    res = lot_service.create_order(
        session,
        {
            "plant_id": plant,
            "material": "ฟางข้าว",
            "target_tons": 10,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert res.ok, res.body
    lot_id = res.body["lot"]["lot_id"]
    assume(lot_service.propose(session, lot_id, session.lots[lot_id].revision).ok)
    res = lot_service.submit(session, lot_id, session.lots[lot_id].revision)
    assume(res.ok)
    return clock, session, lot_id, res.body["lot"]


def _confirm(session, lot_id, view, party_id, role, revision=None):
    extra = {}
    if role == "contractor":
        extra = {"bale_date": view["bale_date"], "haul_date": view["haul_date"]}
    rev = session.lots[lot_id].revision if revision is None else revision
    return lot_service.confirm(session, lot_id, rev, party_id, **extra)


@PROP_SETTINGS
@given(
    days=st.integers(4, 9),
    plant=st.sampled_from(["B01", "B02", "B03"]),
    data=st.data(),
)
def test_repeat_confirm_in_awaiting_changes_nothing(days, plant, data):
    clock, session, lot_id, view = _submitted(days, plant)
    confs = session.lots[lot_id].confirmations
    done = data.draw(st.integers(1, len(confs) - 1))  # stay in awaiting
    order = data.draw(st.permutations(range(len(confs))))
    for idx in order[:done]:
        c = confs[idx]
        res = _confirm(session, lot_id, view, c.party_id, c.role)
        assume(res.ok)
        clock.advance(minutes=1)
    assert session.lots[lot_id].status is Status.AWAITING

    before = lot_to_json(session.lots[lot_id])
    confirmed = [c for c in session.lots[lot_id].confirmations if c.confirmed]
    target = data.draw(st.sampled_from(confirmed))
    clock.advance(hours=data.draw(st.integers(1, 5)))

    res = _confirm(session, lot_id, view, target.party_id, target.role)

    assert res.ok and res.http_status == 200, res.body
    assert res.body["confirmed_count"] == done
    assert res.body["total"] == len(confs)
    assert lot_to_json(session.lots[lot_id]) == before
    after = next(c for c in session.lots[lot_id].confirmations if c.party_id == target.party_id)
    assert after.confirmed_at == target.confirmed_at


@PROP_SETTINGS
@given(
    days=st.integers(4, 9),
    plant=st.sampled_from(["B01", "B02", "B03"]),
    data=st.data(),
)
def test_repeat_confirm_on_ready_lot_is_409_and_unchanged(days, plant, data):
    clock, session, lot_id, view = _submitted(days, plant)
    confs = session.lots[lot_id].confirmations
    for c in confs:
        res = _confirm(session, lot_id, view, c.party_id, c.role)
        assume(res.ok)
        clock.advance(minutes=1)
    assert session.lots[lot_id].status is Status.READY

    before = lot_to_json(session.lots[lot_id])
    target = data.draw(st.sampled_from(confs))
    clock.advance(hours=1)

    res = _confirm(session, lot_id, view, target.party_id, target.role)

    assert not res.ok and res.http_status == 409, res.body
    assert res.body["code"] == "wrong_status"
    assert lot_to_json(session.lots[lot_id]) == before
