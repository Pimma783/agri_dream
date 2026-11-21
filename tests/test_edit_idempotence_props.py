# Feature: straw-lot-planning-demo, Property 11: Repeating an edit is a no-op
"""Property 11 (task 4.12). **Validates: Requirements 10.5**

For Lots in draft, awaiting_confirmation or ready, an accepted edit applied a
second time (with the new revision) succeeds with changed=False, leaves
lot_to_json identical (status, confirmations, revision) and has no reset_notice.
An edit that changes no value on the first attempt is also a no-op.
"""

from __future__ import annotations

from datetime import timedelta

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

import lot_service
from lot_state import lot_to_json

from .conftest import FakeClock

PLOT_IDS = [f"P{i:03d}" for i in range(1, 9)]
BALE_SLOTS = ["S001", "S002", "S003", "S999"]
HAUL_SLOTS = ["S004", "S005", "S006", "S999"]

PROP_SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)

edits = st.one_of(
    st.builds(lambda p: {"type": "add_plot", "plot_id": p}, st.sampled_from(PLOT_IDS)),
    st.builds(lambda p: {"type": "remove_plot", "plot_id": p}, st.sampled_from(PLOT_IDS)),
    st.builds(
        lambda v: {"type": "set_price", "offer_price": v},
        st.one_of(st.integers(1, 100000), st.sampled_from([1500, 1500.0])),
    ),
    st.builds(
        lambda p, v: {"type": "set_moisture", "plot_id": p, "moisture_pct": v},
        st.sampled_from(PLOT_IDS),
        st.one_of(st.integers(0, 100), st.sampled_from([14, 18.5, 25, 12])),
    ),
    st.builds(
        lambda b, h: {"type": "set_queue", "bale_slot_id": b, "haul_slot_id": h},
        st.sampled_from(BALE_SLOTS),
        st.sampled_from(HAUL_SLOTS),
    ),
)

# draft (fresh), draft (proposed), awaiting, awaiting (partly confirmed), ready
states = st.sampled_from(["draft", "proposed", "awaiting", "partial", "ready"])


def make_lot(state: str, days: int):
    clock = FakeClock()
    store = lot_service.SessionStore(clock)
    session, _ = store.resolve(None)
    delivery = (clock().date() + timedelta(days=days)).isoformat()
    res = lot_service.create_order(
        session,
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": 10,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert res.ok, res.body
    lot_id = res.body["lot"]["lot_id"]
    if state == "draft":
        return session, lot_id
    res = lot_service.propose(session, lot_id, session.lots[lot_id].revision)
    assume(res.ok)
    if state == "proposed":
        return session, lot_id
    res = lot_service.submit(session, lot_id, session.lots[lot_id].revision)
    assume(res.ok)
    if state == "awaiting":
        return session, lot_id
    view = res.body["lot"]
    confs = session.lots[lot_id].confirmations
    for i, conf in enumerate(confs):
        if state == "partial" and i == len(confs) - 1:
            break
        extra = {}
        if conf.role == "contractor":
            extra = {"bale_date": view["bale_date"], "haul_date": view["haul_date"]}
        res = lot_service.confirm(
            session, lot_id, session.lots[lot_id].revision, conf.party_id, **extra
        )
        assume(res.ok)
    return session, lot_id


def assert_noop(session, lot_id, edit, res):
    assert res.ok, res.body
    assert res.body["changed"] is False
    assert "reset_notice" not in res.body
    return lot_to_json(session.lots[lot_id])


@PROP_SETTINGS
@given(state=states, days=st.integers(3, 8), edit=edits)
def test_repeating_accepted_edit_is_noop(state, days, edit):
    session, lot_id = make_lot(state, days)
    first = lot_service.apply_edit(session, lot_id, session.lots[lot_id].revision, edit)
    assume(first.ok)
    assert session.lots[lot_id].status.value in ("draft", "awaiting_confirmation", "ready")
    before = lot_to_json(session.lots[lot_id])
    revision = session.lots[lot_id].revision
    if first.body["changed"]:
        assert first.body["lot"]["revision"] == revision

    second = lot_service.apply_edit(session, lot_id, revision, edit)
    after = assert_noop(session, lot_id, edit, second)
    assert after == before
    assert session.lots[lot_id].revision == revision

    # A third repeat stays a no-op as well.
    third = lot_service.apply_edit(session, lot_id, revision, edit)
    assert assert_noop(session, lot_id, edit, third) == before


@PROP_SETTINGS
@given(state=states, days=st.integers(3, 8), edit=edits)
def test_first_attempt_that_changes_nothing_is_noop(state, days, edit):
    session, lot_id = make_lot(state, days)
    before = lot_to_json(session.lots[lot_id])
    res = lot_service.apply_edit(session, lot_id, session.lots[lot_id].revision, edit)
    assume(res.ok and res.body["changed"] is False)
    assert "reset_notice" not in res.body
    assert lot_to_json(session.lots[lot_id]) == before


@PROP_SETTINGS
@given(state=states, days=st.integers(3, 8))
def test_set_price_to_current_value_is_noop(state, days):
    session, lot_id = make_lot(state, days)
    before = lot_to_json(session.lots[lot_id])
    price = session.lots[lot_id].order.offer_price
    res = lot_service.apply_edit(
        session,
        lot_id,
        session.lots[lot_id].revision,
        {"type": "set_price", "offer_price": int(price)},
    )
    assert_noop(session, lot_id, None, res)
    assert lot_to_json(session.lots[lot_id]) == before
