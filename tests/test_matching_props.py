# Feature: straw-lot-planning-demo, Property 1: Search results match the eligibility model and ordering
"""Property test for F3 search eligibility and ordering.

**Validates: Requirements 1.1, 1.2, 1.3, 1.5**
"""

from __future__ import annotations

from unittest import mock

from hypothesis import given, settings, strategies as st

import matching

MATERIALS = sorted(matching.MATERIALS)
PROVINCES = sorted(matching.PILOT_PROVINCES)

materials = st.sampled_from(MATERIALS)
provinces = st.sampled_from(PROVINCES)
# Includes boundary quantities around the buyer minimums (1, 2, 3).
quantities = st.one_of(
    st.sampled_from([0.01, 0.99, 1, 1.01, 1.99, 2, 2.01, 2.99, 3, 3.01, 100]),
    st.floats(min_value=0.001, max_value=500, allow_nan=False, allow_infinity=False),
)
distances = st.one_of(
    st.sampled_from([0, 79.9, 80, 80.0, 80.1, 85]),
    st.floats(min_value=0, max_value=200, allow_nan=False, allow_infinity=False),
)


@st.composite
def buyer_tables(draw):
    ids = draw(st.lists(st.from_regex(r"B[0-9]{2}", fullmatch=True), min_size=0, max_size=8, unique=True))
    table = {}
    for buyer_id in ids:
        routes = {}
        for province in draw(st.lists(provinces, unique=True, max_size=3)):
            routes[province] = draw(distances)
        table[buyer_id] = (
            f"name-{buyer_id}",
            draw(materials),
            draw(st.sampled_from([1, 2, 3, 5])),
            draw(st.booleans()),
            draw(st.sampled_from([700, 750, 900, 900, 1100])),  # duplicate prices force tie-breaks
            routes,
        )
    return table


def model(table, material, quantity, province):
    rows = []
    for buyer_id, (_n, accepted, minimum, is_open, price, routes) in table.items():
        d = routes.get(province)
        if is_open and accepted == material and minimum <= quantity and d is not None and d <= 80:
            rows.append((buyer_id, d, price))
    rows.sort(key=lambda r: (-r[2], r[1], r[0]))
    return rows


def run(table, material, quantity, province):
    with mock.patch.object(matching, "BUYERS", table):
        return matching.find_biomass_buyers(material, quantity, province)


def summarize(result):
    return [
        (m["buyer_id"], m["distance_km"], m["simulated_price_thb_per_ton"])
        for m in result["matches"]
    ]


@settings(max_examples=200, deadline=None)
@given(table=buyer_tables(), material=materials, quantity=quantities, province=provinces)
def test_generated_tables_match_model(table, material, quantity, province):
    first = run(table, material, quantity, province)
    assert summarize(first) == model(table, material, quantity, province)
    assert first["quantity_tons"] == quantity
    # Idempotence: same input gives equal results.
    assert run(table, material, quantity, province) == first


@settings(max_examples=200, deadline=None)
@given(material=materials, quantity=quantities, province=provinces)
def test_shipped_buyers_match_model(material, quantity, province):
    result = matching.find_biomass_buyers(material, quantity, province)
    assert summarize(result) == model(matching.BUYERS, material, quantity, province)
    assert matching.find_biomass_buyers(material, quantity, province) == result


@settings(max_examples=100, deadline=None)
@given(material=materials, quantity=quantities, province=provinces, price=st.integers(1, 5000))
def test_exact_80_included_and_80_point_1_excluded(material, quantity, province, price):
    table = {
        "T80": ("at80", material, 0.001, True, price, {province: 80.0}),
        "T81": ("at80.1", material, 0.001, True, price, {province: 80.1}),
    }
    ids = [m["buyer_id"] for m in run(table, material, quantity, province)["matches"]]
    assert ids == ["T80"]
