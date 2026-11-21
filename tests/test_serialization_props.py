# Feature: straw-lot-planning-demo, Property 21: Lot serialization round trip
"""**Validates: Requirements 12.7, 13.7**"""

from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from lot_state import lot_from_json, lot_to_json
from tests.strategies import lots

SETTINGS = settings(max_examples=100, deadline=None)

TOP_KEYS = [
    "lot_id", "order", "status", "revision", "selected_plot_ids", "bale_slot_id",
    "haul_slot_id", "moisture_overrides", "confirmations", "actual_tons",
]
ORDER_KEYS = [
    "order_id", "plant_id", "material", "target_tons", "offer_price",
    "max_moisture_pct", "delivery_day",
]


@SETTINGS
@given(lots())
def test_round_trip_equal_and_stable(lot):
    text = lot_to_json(lot)
    restored = lot_from_json(text)
    assert restored == lot
    assert lot_to_json(restored) == text


@SETTINGS
@given(st.one_of(st.text(max_size=40), st.binary(max_size=20), st.none(), st.integers()))
def test_arbitrary_input_raises_value_error(text):
    try:
        lot_from_json(text)  # type: ignore[arg-type]
    except ValueError:
        return
    # Only an input that is a valid Lot document may succeed; random text never is.
    pytest.fail("malformed input was accepted")


@SETTINGS
@given(st.sampled_from(["[]", "null", "42", '"x"', "{}", "{", '{"order": 1}']))
def test_wrong_shape_raises_value_error(text):
    with pytest.raises(ValueError):
        lot_from_json(text)


@SETTINGS
@given(lots(), st.data())
def test_missing_required_key_raises_value_error(lot, data):
    doc = json.loads(lot_to_json(lot))
    if data.draw(st.booleans()):
        del doc[data.draw(st.sampled_from(TOP_KEYS))]
    else:
        del doc["order"][data.draw(st.sampled_from(ORDER_KEYS))]
    with pytest.raises(ValueError):
        lot_from_json(json.dumps(doc))


@SETTINGS
@given(lots(), st.sampled_from(["bogus", "", "READY", None, 3]))
def test_unknown_status_raises_value_error(lot, bad):
    doc = json.loads(lot_to_json(lot))
    doc["status"] = bad
    with pytest.raises(ValueError):
        lot_from_json(json.dumps(doc))


@SETTINGS
@given(lots(), st.sampled_from(["abc", "NaN", "Infinity", 1.5, True, [], {}]))
def test_bad_decimal_raises_value_error(lot, bad):
    doc = json.loads(lot_to_json(lot))
    doc["order"]["target_tons"] = bad
    with pytest.raises(ValueError):
        lot_from_json(json.dumps(doc))
