# Feature: straw-lot-planning-demo, Property 7: Delivered cost matches the formula and its lower bound
"""**Validates: Requirements 6.1, 6.2, 6.6, 6.7**"""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

from hypothesis import given, settings
from hypothesis import strategies as st

from lot_planning import delivered_cost
from lot_state import Plot

PLANT = "B01"
SETTINGS = settings(max_examples=200, deadline=None)

tons_st = st.integers(min_value=1, max_value=5000).map(lambda n: Decimal(n) / 100)
dist_st = st.integers(min_value=0, max_value=800).map(lambda n: Decimal(n) / 10)


@st.composite
def plot_st(draw, distance=dist_st):
    return Plot(
        plot_id="P",
        owner_id="O",
        owner_name="synthetic",
        material="ฟางข้าว",
        expected_tons=draw(tons_st),
        distance_km_by_plant={PLANT: draw(distance)},
        ready_day=0,
        last_clear_day=10,
        moisture_pct=None,
    )


plots_st = st.lists(plot_st(), min_size=1, max_size=8)


def expected_per_ton(plots) -> int:
    t = sum((Fraction(p.expected_tons) for p in plots), Fraction(0))
    haul = sum(
        (Fraction(p.expected_tons) * Fraction(p.distance_km_by_plant[PLANT]) * 5 for p in plots),
        Fraction(0),
    )
    q = (300 * t + 250 * t + haul) / t
    return int((q + Fraction(1, 2)) // 1)


@SETTINGS
@given(plots_st)
def test_per_ton_matches_formula(plots):
    result = delivered_cost(plots, PLANT)
    assert result is not None
    assert result.per_ton == Decimal(expected_per_ton(plots))
    assert result.estimated_tons == sum((p.expected_tons for p in plots), Decimal(0))


@SETTINGS
@given(plots_st)
def test_haulage_amount_is_sum_of_ton_km_rate(plots):
    result = delivered_cost(plots, PLANT)
    haul = sum(
        (p.expected_tons * p.distance_km_by_plant[PLANT] * 5 for p in plots), Decimal(0)
    )
    assert result.haul_total == haul
    assert result.straw_total == 300 * result.estimated_tons
    assert result.baling_total == 250 * result.estimated_tons


@SETTINGS
@given(plots_st)
def test_delivered_cost_at_least_straw_plus_baling(plots):
    assert delivered_cost(plots, PLANT).per_ton >= 550


def test_empty_selection_returns_none():
    assert delivered_cost([], PLANT) is None
    assert delivered_cost(iter(()), PLANT) is None


@SETTINGS
@given(st.lists(plot_st(), max_size=3), st.integers(min_value=1, max_value=3))
def test_zero_ton_plots_return_none_without_error(_, n):
    zero = [
        Plot("Z", "O", "synthetic", "ฟางข้าว", Decimal(0), {PLANT: Decimal(10)}, 0, 10, None)
    ] * n
    assert delivered_cost(zero, PLANT) is None


@SETTINGS
@given(plots_st, plot_st(distance=st.just(Decimal(0))))
def test_adding_zero_distance_plot_never_raises_per_ton(plots, extra):
    before = delivered_cost(plots, PLANT)
    after = delivered_cost([*plots, extra], PLANT)
    assert after.per_ton <= before.per_ton
    assert after.per_ton >= 550
    assert after.haul_total == before.haul_total
