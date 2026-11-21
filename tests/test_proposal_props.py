# Feature: straw-lot-planning-demo, Property 6: Proposals select by rule and are deterministic
"""Property 6. Validates: Requirements 5.1, 5.3, 5.6, 5.7, 5.8, 5.9, 7.3, 15.7."""
from __future__ import annotations

import dataclasses
from decimal import Decimal

from hypothesis import given, settings, strategies as st

from lot_fixtures import BUFFER_PERCENT, PRESET_SELECTED_PLOT_IDS, RICE_STRAW
from lot_planning import (
    Fixtures,
    build_view,
    check_queue_pair,
    default_fixtures,
    plot_eligibility,
    propose_queue,
    select_plots,
)
from lot_state import Lot, Order, Plot, Slot, Status

PLANT = "B01"
SETTINGS = settings(max_examples=150, deadline=None)


@st.composite
def plots_st(draw, min_size=0, max_size=8):
    n = draw(st.integers(min_size, max_size))
    out = []
    for i in range(n):
        ready = draw(st.integers(0, 12))
        last = draw(st.integers(ready - 1 if ready else 0, ready + 8))
        out.append(
            Plot(
                plot_id=f"X{i:03d}",
                owner_id=f"O{i}",
                owner_name=f"owner {i}",
                material=draw(st.sampled_from([RICE_STRAW, RICE_STRAW, "other"])),
                expected_tons=Decimal(draw(st.integers(1, 2500))) / 100,
                distance_km_by_plant={
                    PLANT: Decimal(draw(st.integers(0, 900))) / 10
                },
                ready_day=ready,
                last_clear_day=last,
                moisture_pct=draw(
                    st.none() | st.integers(0, 300).map(lambda v: Decimal(v) / 10)
                ),
            )
        )
    return draw(st.permutations(out)) if out else []


orders_st = st.builds(
    Order,
    order_id=st.just("O1"),
    plant_id=st.just(PLANT),
    material=st.just(RICE_STRAW),
    target_tons=st.integers(1, 6000).map(lambda v: Decimal(v) / 100),
    offer_price=st.just(Decimal(1000)),
    max_moisture_pct=st.integers(50, 250).map(lambda v: Decimal(v) / 10),
    delivery_day=st.integers(0, 12),
)

slots_st = st.lists(
    st.tuples(
        st.sampled_from(["bale", "haul"]),
        st.integers(0, 12),
        st.integers(0, 40),
        st.integers(0, 40),
    ),
    max_size=8,
).map(
    lambda rows: [
        Slot(f"S{i:03d}", k, d, Decimal(c), Decimal(min(b, c)))
        for i, (k, d, c, b) in enumerate(rows)
    ]
)


def eligible_of(plots, order):
    return [p for p in plots if plot_eligibility(p, order).eligible]


def sorted_of(plots, order):
    return sorted(plots, key=lambda p: (p.distance_km_by_plant[PLANT], p.ready_day, p.plot_id))


def tons(plots):
    return sum((p.expected_tons for p in plots), Decimal(0))


def reached(estimated, order):
    return estimated * 100 >= order.target_tons * BUFFER_PERCENT


@SETTINGS
@given(plots_st(), orders_st)
def test_selection_is_rule_ordered_prefix_with_exact_stop(plots, order):
    eligible = eligible_of(plots, order)
    ordered = sorted_of(eligible, order)
    ids = select_plots(eligible, order)
    chosen = ordered[: len(ids)]
    assert list(ids) == [p.plot_id for p in chosen]  # prefix of sorted order
    est = tons(chosen)
    if len(ids) < len(ordered):
        assert reached(est, order)  # stopped because reached
    # stops as soon as reached: dropping the last plot is not yet enough
    if ids:
        assert not reached(tons(chosen[:-1]), order)
    # nothing before the last plot had already reached the buffer
    for k in range(len(chosen)):
        assert not reached(tons(chosen[:k]), order)


@SETTINGS
@given(plots_st(), orders_st)
def test_shortfall_and_empty_cases(plots, order):
    eligible = eligible_of(plots, order)
    ids = select_plots(eligible, order)
    lot = Lot("L1", order, Status.DRAFT, 0, selected_plot_ids=ids)
    view = build_view(lot, Fixtures(tuple(plots), ()))
    est = tons([p for p in plots if p.plot_id in ids])
    assert view.estimated_tons == est
    assert view.shortfall_tons == max(Decimal(0), order.target_tons - est)
    if est < order.target_tons:
        assert view.shortfall_tons == order.target_tons - est
    if not reached(est, order):
        assert set(ids) == {p.plot_id for p in eligible}  # all eligible returned
    if not eligible:
        assert ids == ()
        assert view.no_eligible_plot
        assert view.shortfall_tons == order.target_tons
        assert not view.queue_assigned
        assert view.selected == ()


@SETTINGS
@given(plots_st(), orders_st, slots_st)
def test_queue_assignment_consistent_with_pair_checks(plots, order, slots):
    eligible = eligible_of(plots, order)
    chosen = [p for p in eligible if p.plot_id in select_plots(eligible, order)]
    bales = [s for s in slots if s.kind == "bale"]
    hauls = [s for s in slots if s.kind == "haul"]
    prop = propose_queue(chosen, order, bales, hauls)
    if not chosen:
        # no selection: no pair is feasible only if it truly fails; an assigned
        # queue must still satisfy the pair check
        pass
    if prop.assigned:
        b = next(s for s in bales if s.slot_id == prop.bale_slot_id)
        h = next(s for s in hauls if s.slot_id == prop.haul_slot_id)
        assert check_queue_pair(chosen, order, b, h) == ()
        assert prop.violations == ()
    else:
        assert prop.violations
        for b in bales:
            for h in hauls:
                assert check_queue_pair(chosen, order, b, h) != ()


@SETTINGS
@given(plots_st(), orders_st, slots_st, st.randoms(use_true_random=False))
def test_deterministic_and_order_independent(plots, order, slots, rnd):
    eligible = eligible_of(plots, order)
    shuffled = list(plots)
    rnd.shuffle(shuffled)
    assert select_plots(eligible, order) == select_plots(eligible, order)
    assert select_plots(eligible, order) == select_plots(eligible_of(shuffled, order), order)
    chosen = [p for p in eligible if p.plot_id in select_plots(eligible, order)]
    bales = [s for s in slots if s.kind == "bale"]
    hauls = [s for s in slots if s.kind == "haul"]
    first = propose_queue(chosen, order, bales, hauls)
    assert first == propose_queue(chosen, order, bales, hauls)
    shuffled_slots = list(slots)
    rnd.shuffle(shuffled_slots)
    again = propose_queue(
        list(reversed(chosen)),
        order,
        [s for s in shuffled_slots if s.kind == "bale"],
        [s for s in shuffled_slots if s.kind == "haul"],
    )
    assert again == first


def test_standard_preset_selects_p001_p002_p003():
    fx = default_fixtures()
    order = Order("O1", "B01", RICE_STRAW, Decimal(10), Decimal(1000), Decimal(20), 6)
    eligible = eligible_of(fx.plots, order)
    ids = select_plots(eligible, order)
    assert ids == PRESET_SELECTED_PLOT_IDS == ("P001", "P002", "P003")
    lot = Lot("L1", order, Status.DRAFT, 0, selected_plot_ids=ids)
    view = build_view(lot, fx)
    assert view.estimated_tons == Decimal(12)
    assert view.shortfall_tons == 0
    prop = propose_queue([p for p in fx.plots if p.plot_id in ids], order, fx.bale_slots, fx.haul_slots)
    assert prop.assigned
    assert dataclasses.replace(lot, selected_plot_ids=ids) == lot
