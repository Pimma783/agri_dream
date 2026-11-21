# Feature: straw-lot-planning-demo, Property 5: The queue check returns ordered violations and matches the constraints
"""Property test for lot_planning.check_queue_pair and propose_queue.

Validates: Requirements 4.6, 4.7, 5.3, 5.7, 8.3, 16.2
"""
from __future__ import annotations

from decimal import Decimal

from hypothesis import given, settings, strategies as st

from lot_planning import CHECK_ORDER, check_queue_pair, propose_queue
from lot_state import Order, Plot, Slot

# Small ranges so inclusive boundaries are hit often.
days = st.integers(min_value=0, max_value=6)
tons = st.integers(min_value=0, max_value=800).map(lambda n: Decimal(n).scaleb(-2))


@st.composite
def plots_st(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    out = []
    for i in range(n):
        ready = draw(days)
        out.append(
            Plot(
                plot_id=f"P{draw(st.integers(0, 9))}{i}",
                owner_id="o",
                owner_name="o",
                material="m",
                expected_tons=draw(tons),
                distance_km_by_plant={"PL": Decimal(10)},
                ready_day=ready,
                last_clear_day=draw(days),
                moisture_pct=None,
            )
        )
    return tuple(out)


order_st = days.map(
    lambda d: Order("O", "PL", "m", Decimal(10), Decimal(1), Decimal(20), d)
)


def slot_st(kind: str, idx: int):
    return st.builds(
        lambda day, cap, booked: Slot(
            f"{kind[0].upper()}{idx}", kind, day, cap, min(booked, cap)
        ),
        days,
        tons,
        tons,
    )


@st.composite
def slots_st(draw, kind: str):
    n = draw(st.integers(min_value=0, max_value=3))
    return tuple(draw(slot_st(kind, i)) for i in range(n))


def model_violated(plots, order, bale, haul) -> set[str]:
    est = sum((p.expected_tons for p in plots), Decimal(0))
    bad: set[str] = set()
    if any(bale.day < p.ready_day for p in plots):
        bad.add("ready_date")
    if any(bale.day > p.last_clear_day for p in plots):
        bad.add("last_clearing_date")
    if not (bale.day <= haul.day <= order.delivery_day):
        bad.add("delivery_date")
    if bale.remaining_tons < est or haul.remaining_tons < est:
        bad.add("queue_capacity")
    return bad


@settings(max_examples=200, deadline=None)
@given(plots=plots_st(), order=order_st, bale=slot_st("bale", 0), haul=slot_st("haul", 1))
def test_check_queue_pair_ordered_and_matches_constraints(plots, order, bale, haul):
    result = check_queue_pair(plots, order, bale, haul)
    expected = model_violated(plots, order, bale, haul)

    keys = [(CHECK_ORDER.index(v.code), v.subject_id) for v in result]
    assert keys == sorted(keys)
    assert (result == ()) == (not expected)
    assert {v.code for v in result} == expected
    if result:
        first = next(c for c in CHECK_ORDER if c in expected)
        assert result[0].code == first


@settings(max_examples=200, deadline=None)
@given(
    plots=plots_st(),
    order=order_st,
    bales=slots_st("bale"),
    hauls=slots_st("haul"),
)
def test_propose_queue_first_feasible_in_scan_order(plots, order, bales, hauls):
    proposal = propose_queue(plots, order, bales, hauls)

    feasible = [
        (b, h)
        for b in sorted(bales, key=lambda s: (s.day, s.slot_id))
        for h in sorted(hauls, key=lambda s: (s.day, s.slot_id))
        if not model_violated(plots, order, b, h)
    ]
    if feasible:
        b, h = feasible[0]
        assert proposal.assigned
        assert (proposal.bale_slot_id, proposal.haul_slot_id) == (b.slot_id, h.slot_id)
        assert proposal.violations == ()
    else:
        assert not proposal.assigned
        assert proposal.bale_slot_id is None and proposal.haul_slot_id is None
        assert len(proposal.violations) > 0
