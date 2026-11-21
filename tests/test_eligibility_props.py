# Feature: straw-lot-planning-demo, Property 4: Plot eligibility follows the rules
"""Property test for lot_planning.plot_eligibility.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.10**
"""
from __future__ import annotations

from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from lot_planning import plot_eligibility
from lot_state import Order, Plot, format_tons

MATERIALS = ("ฟางข้าว", "ซังข้าวโพด", "ใบอ้อย")
PLANT = "P01"


def _dec(lo: int, hi: int) -> st.SearchStrategy[Decimal]:
    return st.integers(min_value=lo * 10, max_value=hi * 10).map(
        lambda n: Decimal(n).scaleb(-1)
    )


distances = st.one_of(
    st.sampled_from([Decimal("79.9"), Decimal("80.0"), Decimal("80.1"), Decimal("80")]),
    _dec(0, 200),
)
moistures = st.one_of(st.none(), _dec(0, 100))


@st.composite
def cases(draw):
    material = draw(st.sampled_from(MATERIALS))
    order_material = draw(st.sampled_from(MATERIALS))
    ready = draw(st.integers(0, 14))
    last_clear = draw(st.integers(0, 14))
    delivery = draw(st.integers(0, 14))
    plot = Plot(
        plot_id="A01",
        owner_id="F01",
        owner_name="สมชาย",
        material=material,
        expected_tons=Decimal("5"),
        distance_km_by_plant={PLANT: draw(distances)},
        ready_day=ready,
        last_clear_day=last_clear,
        moisture_pct=draw(moistures),
    )
    order = Order(
        order_id="O1",
        plant_id=PLANT,
        material=order_material,
        target_tons=Decimal("20"),
        offer_price=Decimal("1000"),
        max_moisture_pct=draw(_dec(0, 100)),
        delivery_day=delivery,
    )
    override = draw(st.one_of(st.none(), _dec(0, 100)))
    return plot, order, override


def _expected(plot: Plot, order: Order, override: Decimal | None):
    moisture = override if override is not None else plot.moisture_pct
    d = plot.distance_km_by_plant[PLANT]
    failed = set()
    if plot.material != order.material:
        failed.add("material")
    if d > 80:
        failed.add("distance")
    if moisture is not None and moisture > order.max_moisture_pct:
        failed.add("moisture")
    if plot.ready_day > plot.last_clear_day:
        failed.add("baling_window")
    if plot.ready_day > order.delivery_day:
        failed.add("haul_window")
    return moisture, failed


@settings(max_examples=300, deadline=None)
@given(cases())
def test_plot_eligibility_follows_rules(case):
    plot, order, override = case
    moisture, failed = _expected(plot, order, override)
    result = plot_eligibility(plot, order, override)

    # eligible iff no rule fails; reasons empty iff eligible
    assert result.eligible == (not failed)
    assert (len(result.reasons) == 0) == result.eligible
    assert {r.code for r in result.reasons} == failed

    # unknown moisture sets moisture_pending and never excludes
    assert result.moisture_pending == (moisture is None)
    if moisture is None:
        assert "moisture" not in {r.code for r in result.reasons}

    # reasons cite the numbers / names
    by_code = {r.code: r.message_th for r in result.reasons}
    if "material" in by_code:
        assert plot.material in by_code["material"]
        assert order.material in by_code["material"]
    if "distance" in by_code:
        assert format_tons(plot.distance_km_by_plant[PLANT]) in by_code["distance"]
        assert "80" in by_code["distance"]
    if "moisture" in by_code:
        assert format_tons(moisture) in by_code["moisture"]
        assert format_tons(order.max_moisture_pct) in by_code["moisture"]
    for code in ("baling_window", "haul_window"):
        if code in by_code:
            assert str(plot.ready_day) in by_code[code]
    if "baling_window" in by_code:
        assert str(plot.last_clear_day) in by_code["baling_window"]
    if "haul_window" in by_code:
        assert str(order.delivery_day) in by_code["haul_window"]


@settings(max_examples=100, deadline=None)
@given(cases())
def test_override_equals_fresh_evaluation(case):
    plot, order, override = case
    if override is None:
        return
    fresh = Plot(**{**plot.__dict__, "moisture_pct": override})
    assert plot_eligibility(plot, order, override) == plot_eligibility(fresh, order)


@settings(max_examples=100, deadline=None)
@given(cases())
def test_distance_boundary(case):
    plot, order, _ = case
    for dist, ok in ((Decimal("80.0"), True), (Decimal("80.1"), False)):
        p = Plot(
            **{
                **plot.__dict__,
                "material": order.material,
                "distance_km_by_plant": {PLANT: dist},
                "moisture_pct": None,
                "ready_day": 0,
                "last_clear_day": 5,
            }
        )
        o = Order(**{**order.__dict__, "delivery_day": 5})
        res = plot_eligibility(p, o)
        assert res.eligible is ok
        assert res.moisture_pending is True
