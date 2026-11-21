# Feature: straw-lot-planning-demo, Property 16: An accepted edit after confirmation resets all parties
"""Property 16 (task 4.17). **Validates: Requirements 10.1, 10.2, 10.3**

For Lots in awaiting_confirmation (some parties confirmed) or ready, any
accepted edit that changes a value sets every Confirmation to pending, grows the
revision by exactly 1 and sets the status to awaiting_confirmation when
Estimated_Tons >= Target_Tons with a feasible queue, else draft with the failing
conditions reported. The reset_notice names the changed field and the parties
that had confirmed. Edits in draft keep draft and add 1 to the revision.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

import lot_service
from lot_planning import default_fixtures

from .conftest import FakeClock

PLOT_IDS = [f"P{i:03d}" for i in range(1, 9)]
BALE_SLOTS = ["S001", "S002", "S003"]
HAUL_SLOTS = ["S004", "S005", "S006"]
FIELD = {
    "add_plot": "selected_plots",
    "remove_plot": "selected_plots",
    "set_price": "offer_price",
    "set_moisture": "moisture_pct",
    "set_queue": "queue_slots",
}

PROP_SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)

edits = st.one_of(
    st.builds(lambda p: {"type": "add_plot", "plot_id": p}, st.sampled_from(PLOT_IDS)),
    st.builds(lambda p: {"type": "remove_plot", "plot_id": p}, st.sampled_from(PLOT_IDS)),
    st.builds(
        lambda v: {"type": "set_price", "offer_price": v}, st.integers(1, 100000)
    ),
    st.builds(
        lambda p, v: {"type": "set_moisture", "plot_id": p, "moisture_pct": v},
        st.sampled_from(PLOT_IDS),
        st.integers(0, 100),
    ),
    st.builds(
        lambda b, h: {"type": "set_queue", "bale_slot_id": b, "haul_slot_id": h},
        st.sampled_from(BALE_SLOTS),
        st.sampled_from(HAUL_SLOTS),
    ),
)

# awaiting (none confirmed), awaiting with n confirmed (n of 4 of 5), ready
confirmed_counts = st.integers(0, 5)


def make_lot(confirmed: int, days: int):
    """Awaiting lot with `confirmed` parties confirmed; 5 means ready."""
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
    res = lot_service.propose(session, lot_id, session.lots[lot_id].revision)
    assume(res.ok)
    res = lot_service.submit(session, lot_id, session.lots[lot_id].revision)
    assume(res.ok)
    view = res.body["lot"]
    for conf in list(session.lots[lot_id].confirmations)[:confirmed]:
        extra = {}
        if conf.role == "contractor":
            extra = {"bale_date": view["bale_date"], "haul_date": view["haul_date"]}
        res = lot_service.confirm(
            session, lot_id, session.lots[lot_id].revision, conf.party_id, **extra
        )
        assume(res.ok)
    return session, lot_id


def expected_estimated(lot) -> Decimal:
    by_id = {p.plot_id: p for p in default_fixtures().plots}
    return sum((by_id[i].expected_tons for i in lot.selected_plot_ids), Decimal(0))


@PROP_SETTINGS
@given(confirmed=confirmed_counts, days=st.integers(3, 8), edit=edits)
def test_accepted_edit_after_confirmation_resets_all(confirmed, days, edit):
    session, lot_id = make_lot(confirmed, days)
    before = session.lots[lot_id]
    assume(before.status.value in ("awaiting_confirmation", "ready"))
    prior = [c.name for c in before.confirmations if c.confirmed]

    res = lot_service.apply_edit(session, lot_id, before.revision, edit)
    assume(res.ok and res.body["changed"] is True)
    after = session.lots[lot_id]

    assert after.revision == before.revision + 1
    assert res.body["lot"]["revision"] == before.revision + 1
    assert after.confirmations
    assert all(not c.confirmed for c in after.confirmations)
    assert [c.party_id for c in after.confirmations] == [
        c.party_id for c in before.confirmations
    ]

    plan_ok = (
        expected_estimated(after) >= after.order.target_tons
        and after.bale_slot_id is not None
        and after.haul_slot_id is not None
    )
    if plan_ok:
        assert after.status.value == "awaiting_confirmation"
        assert "failing_conditions" not in res.body
    else:
        assert after.status.value == "draft"
        assert res.body["failing_conditions"]

    if prior:
        notice = res.body["reset_notice"]
        assert notice["changed_field"] == FIELD[edit["type"]]
        assert sorted(notice["reset_parties"]) == sorted(prior)
    else:
        assert "reset_notice" not in res.body


@PROP_SETTINGS
@given(days=st.integers(3, 8), edit=edits)
def test_edit_in_draft_keeps_draft_and_bumps_revision(days, edit):
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
    before = session.lots[lot_id]
    assert before.status.value == "draft"

    res = lot_service.apply_edit(session, lot_id, before.revision, edit)
    assume(res.ok and res.body["changed"] is True)
    after = session.lots[lot_id]
    assert after.status.value == "draft"
    assert after.revision == before.revision + 1
    assert "reset_notice" not in res.body
