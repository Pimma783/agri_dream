# Feature: straw-lot-planning-demo, Property 13: Submit creates exactly one Confirmation per required party
"""**Validates: Requirements 8.4**"""
from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta
from unittest import mock

from hypothesis import HealthCheck, event, given, settings
from hypothesis import strategies as st

import lot_service
from lot_fixtures import CONTRACTOR_ID, ELIGIBLE_PLOT_IDS
from lot_planning import Fixtures, default_fixtures
from lot_state import Status

START = datetime(2025, 1, 6, 8, 0)
OWNER_IDS = ("F01", "F02", "F03", "F04")


def _fixtures_with_owners(owner_by_plot: dict[str, str]) -> Fixtures:
    base = default_fixtures()
    plots = tuple(
        dataclasses.replace(p, owner_id=owner_by_plot[p.plot_id], owner_name="ชื่อ " + owner_by_plot[p.plot_id])
        if p.plot_id in owner_by_plot
        else p
        for p in base.plots
    )
    return Fixtures(plots=plots, slots=base.slots)


@st.composite
def scenarios(draw):
    owners = {pid: draw(st.sampled_from(OWNER_IDS)) for pid in ELIGIBLE_PLOT_IDS}
    target = draw(st.integers(min_value=1, max_value=14))
    edits = draw(
        st.lists(
            st.tuples(st.sampled_from(("add_plot", "remove_plot")), st.sampled_from(ELIGIBLE_PLOT_IDS)),
            max_size=10,
        )
    )
    return owners, target, edits


def _make_lot(session, target):
    delivery = (START + timedelta(days=4)).date().isoformat()
    res = lot_service.create_order(
        session,
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": target,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert res.ok, res.body
    return res.body["lot"]["lot_id"]


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
)
@given(scenarios())
def test_submit_creates_one_pending_confirmation_per_party(scenario):
    owners, target, edits = scenario
    fx = _fixtures_with_owners(owners)
    with mock.patch.object(lot_service, "_FIXTURES", fx):
        session = lot_service.Session("s1", START, clock=lambda: START)
        lot_id = _make_lot(session, target)
        res = lot_service.propose(session, lot_id, session.lots[lot_id].revision)
        assert res.ok, res.body
        for kind, pid in edits:
            lot_service.apply_edit(
                session, lot_id, session.lots[lot_id].revision, {"type": kind, "plot_id": pid}
            )

        before = session.lots[lot_id]
        res = lot_service.submit(session, lot_id, before.revision)
        after = session.lots[lot_id]

        event(f"ok={res.ok}")
        if not res.ok:
            assert after.confirmations == ()
            assert after.status == Status.DRAFT
            assert after.revision == before.revision
            return

        by_id = {p.plot_id: p for p in fx.plots}
        expected_farmers = {by_id[i].owner_id for i in after.selected_plot_ids}
        assert after.status == Status.AWAITING
        ids = [c.party_id for c in after.confirmations]
        assert len(ids) == len(set(ids))
        assert set(ids) == {"B01", CONTRACTOR_ID} | expected_farmers
        assert len(ids) == 2 + len(expected_farmers)
        roles = {c.party_id: c.role for c in after.confirmations}
        assert roles["B01"] == "plant" and roles[CONTRACTOR_ID] == "contractor"
        assert all(roles[f] == "farmer" for f in expected_farmers)
        assert all(not c.confirmed and c.confirmed_at is None for c in after.confirmations)


def test_submit_without_enough_tons_creates_no_confirmations():
    fx = default_fixtures()
    with mock.patch.object(lot_service, "_FIXTURES", fx):
        session = lot_service.Session("s1", START, clock=lambda: START)
        lot_id = _make_lot(session, 14)  # all eligible plots total 14 t but selection is emptied below
        lot_service.propose(session, lot_id, session.lots[lot_id].revision)
        for pid in ELIGIBLE_PLOT_IDS:
            lot_service.apply_edit(
                session, lot_id, session.lots[lot_id].revision, {"type": "remove_plot", "plot_id": pid}
            )
        res = lot_service.submit(session, lot_id, session.lots[lot_id].revision)
        assert not res.ok
        assert session.lots[lot_id].confirmations == ()
        assert session.lots[lot_id].status == Status.DRAFT
