# Feature: straw-lot-planning-demo, Property 8: Adding then removing a Plot restores the derived values
"""Property test: add_plot then remove_plot restores the derived Lot values.

**Validates: Requirements 6.3, 7.1**
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from itertools import count

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

import lot_service
from lot_planning import build_view, default_fixtures
from lot_service import SessionStore, to_jsonable

from .conftest import FakeClock

FIXTURES = default_fixtures()
EXPECTED = {p.plot_id: p.expected_tons for p in FIXTURES.plots}

order_payloads = st.fixed_dictionaries(
    {
        "plant_id": st.sampled_from(["B01", "B02", "B03"]),
        "target_tons": st.integers(min_value=1, max_value=60).map(lambda n: n / 2),
        "offer_price": st.integers(min_value=1, max_value=5000),
        "max_moisture_pct": st.integers(min_value=1, max_value=100),
        "delivery_offset": st.integers(min_value=0, max_value=10),
    }
)


def _new_session():
    clock = FakeClock()
    tokens = count(1)
    store = SessionStore(clock, token_factory=lambda: f"tok{next(tokens)}")
    session, _ = store.resolve(None)
    return clock, session


def _derived(lot: dict) -> dict:
    cost = lot["delivered_cost"]
    return {
        "selected": [p["plot"]["plot_id"] for p in lot["selected"]],
        "estimated_tons": lot["estimated_tons"],
        "shortfall_tons": lot["shortfall_tons"],
        "delivered_cost": cost,
        "bale_slot_id": lot["bale_slot_id"],
        "haul_slot_id": lot["haul_slot_id"],
        "queue_assigned": lot["queue_assigned"],
    }


def _check_recomputed(session, lot_id: str, body: dict) -> None:
    """The response view is the derived view of the stored Lot, same response."""
    stored = session.lots[lot_id]
    assert body["lot"] == to_jsonable(build_view(stored, None, session.start_date))
    est = sum((EXPECTED[i] for i in stored.selected_plot_ids), Decimal(0))
    assert Decimal(str(body["lot"]["estimated_tons"])) == est
    shortfall = max(stored.order.target_tons - est, Decimal(0))
    assert Decimal(str(body["lot"]["shortfall_tons"])) == shortfall


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
@given(payload=order_payloads, data=st.data())
def test_add_then_remove_plot_restores_derived_values(payload, data):
    clock, session = _new_session()
    body = {k: v for k, v in payload.items() if k != "delivery_offset"}
    body["material"] = "ฟางข้าว"
    body["delivery_date"] = (
        clock().date() + timedelta(days=payload["delivery_offset"])
    ).isoformat()

    res = lot_service.create_order(session, body)
    assert res.ok, res.body
    lot_id = res.body["lot"]["lot_id"]
    rev = res.body["lot"]["revision"]

    res = lot_service.propose(session, lot_id, rev)
    assert res.ok, res.body
    before = res.body["lot"]
    assert before["status"] == "draft"
    addable = before["addable_plot_ids"]
    assume(addable)
    plot_id = data.draw(st.sampled_from(addable))

    res = lot_service.apply_edit(
        session, lot_id, before["revision"], {"type": "add_plot", "plot_id": plot_id}
    )
    assert res.ok, res.body
    added = res.body["lot"]
    assert plot_id in [p["plot"]["plot_id"] for p in added["selected"]]
    _check_recomputed(session, lot_id, res.body)

    res = lot_service.apply_edit(
        session, lot_id, added["revision"], {"type": "remove_plot", "plot_id": plot_id}
    )
    assert res.ok, res.body
    _check_recomputed(session, lot_id, res.body)

    # Revision may differ; derived values must match the originals.
    assert _derived(res.body["lot"]) == _derived(before)
