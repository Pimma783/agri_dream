# Feature: straw-lot-planning-demo, Property 19: Tons formatting is exact and has no trailing zeros
"""**Validates: Requirements 7.3, 11.7**"""
from decimal import Decimal

from hypothesis import given, settings, strategies as st

from lot_state import format_tons

# Decimals with at most 2 decimal places (hundredths), positive and negative.
two_dp_decimals = st.integers(min_value=-10_000_000, max_value=10_000_000).map(
    lambda n: Decimal(n).scaleb(-2)
)


@settings(max_examples=200)
@given(two_dp_decimals)
def test_format_tons_round_trips_without_trailing_zeros(value):
    text = format_tons(value)
    assert Decimal(text) == value
    if "." in text:
        assert not text.endswith("0")
        assert not text.endswith(".")
    assert "e" not in text.lower()


@settings(max_examples=100)
@given(
    st.integers(min_value=0, max_value=100_000).map(lambda n: Decimal(n).scaleb(-2)),
    st.integers(min_value=0, max_value=100_000).map(lambda n: Decimal(n).scaleb(-2)),
)
def test_shortfall_value_formats_exactly(target, estimated):
    shortfall = target - estimated
    text = format_tons(shortfall)
    assert Decimal(text) == shortfall
    assert not text.endswith(".")
    if "." in text:
        assert not text.endswith("0")


def test_examples():
    assert format_tons(Decimal("10.40")) == "10.4"
    assert format_tons(Decimal("12.00")) == "12"
    assert format_tons(Decimal("0.05")) == "0.05"
    assert format_tons(Decimal("0.00")) == "0"
