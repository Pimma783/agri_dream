"""Hypothesis strategies for the straw lot planning tests.

Domain classes live in lot_state.py / lot_fixtures.py, which are created in
later tasks. They are imported lazily inside the strategies so this module
stays importable now.
"""

from __future__ import annotations

import math
from decimal import Decimal

from hypothesis import strategies as st

STATUSES = ("draft", "awaiting_confirmation", "ready", "closed")
MATERIALS = ("ฟางข้าว", "ซังข้าวโพด", "ใบอ้อย")

# ---------------------------------------------------------------- numbers


def decimals(
    min_value: int | float | Decimal = 0,
    max_value: int | float | Decimal = 100,
    max_places: int = 2,
) -> st.SearchStrategy[Decimal]:
    """Decimals with 0..max_places (default 2) fractional digits."""
    scale = 10**max_places
    lo = int((Decimal(str(min_value)) * scale).to_integral_value())
    hi = int((Decimal(str(max_value)) * scale).to_integral_value())
    return st.integers(min_value=lo, max_value=hi).map(
        lambda n: Decimal(n).scaleb(-max_places)
    )


def decimals_0_2_places(
    min_value: int = 0, max_value: int = 1000
) -> st.SearchStrategy[Decimal]:
    """Decimals with 0, 1 or 2 places (trailing zeros vary)."""
    return st.builds(
        lambda n, places: Decimal(n).scaleb(-places),
        st.integers(min_value=min_value * 100, max_value=max_value * 100),
        st.integers(min_value=0, max_value=2),
    ).filter(lambda d: min_value <= d <= max_value)


def distances_near_80() -> st.SearchStrategy[Decimal]:
    """Distances around the 80 km limit, including exactly 80.0 and 80.1."""
    edge = st.sampled_from(
        [Decimal("79.9"), Decimal("80.0"), Decimal("80.1"), Decimal("80"), Decimal("79.99"), Decimal("80.01")]
    )
    near = st.integers(min_value=7500, max_value=8500).map(lambda n: Decimal(n).scaleb(-2))
    return st.one_of(edge, near)


def day_offsets(min_value: int = 0, max_value: int = 14) -> st.SearchStrategy[int]:
    return st.integers(min_value=min_value, max_value=max_value)


# ---------------------------------------------------------- invalid values


def invalid_numbers() -> st.SearchStrategy[object]:
    """Values that must be rejected where a JSON number is required."""
    return st.one_of(
        st.booleans(),
        st.just(float("nan")),
        st.just(float("inf")),
        st.just(float("-inf")),
        st.integers(min_value=10**18, max_value=10**40),
        st.integers(min_value=-(10**40), max_value=-(10**18)),
        st.text(max_size=12),
        st.just(None),
        st.lists(st.integers(), max_size=2),
    )


def out_of_range_numbers(low: float = 0, high: float = 100) -> st.SearchStrategy[float]:
    """Finite numbers outside [low, high]."""
    return st.one_of(
        st.floats(max_value=low - 0.01, allow_nan=False, allow_infinity=False, min_value=-1e9),
        st.floats(min_value=high + 0.01, allow_nan=False, allow_infinity=False, max_value=1e9),
    )


def invalid_values(low: float = 0, high: float = 100) -> st.SearchStrategy[object]:
    """Any invalid numeric input: wrong type, non-finite, huge or out of range."""
    return st.one_of(invalid_numbers(), out_of_range_numbers(low, high))


def is_finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and (not isinstance(value, float) or math.isfinite(value))
    )


# ---------------------------------------------------------- domain objects


@st.composite
def plots(draw, plant_ids=("B01", "B02", "B03"), material=None):
    from lot_state import Plot  # lazy: created in task 1.3

    ready = draw(day_offsets(0, 8))
    last = draw(day_offsets(0, 10))
    n = draw(st.integers(min_value=0, max_value=10**6))
    return Plot(
        plot_id=f"P{n:06d}",
        owner_id=f"F{draw(st.integers(min_value=1, max_value=5)):02d}",
        owner_name=draw(st.sampled_from(["สมชาย ทดสอบ", "สมหญิง ตัวอย่าง", "ลุงจำลอง"])),
        material=material or draw(st.sampled_from(MATERIALS)),
        expected_tons=draw(decimals_0_2_places(1, 10)),
        distance_km_by_plant={pid: draw(distances_near_80()) for pid in plant_ids},
        ready_day=ready,
        last_clear_day=last,
        moisture_pct=draw(st.one_of(st.none(), decimals(0, 40))),
    )


@st.composite
def orders(draw, plant_ids=("B01", "B02", "B03")):
    from lot_state import Order

    return Order(
        order_id=f"O{draw(st.integers(min_value=1, max_value=999)):03d}",
        plant_id=draw(st.sampled_from(plant_ids)),
        material="ฟางข้าว",
        target_tons=draw(decimals_0_2_places(1, 50)),
        offer_price=draw(decimals(1, 5000, 2)),
        max_moisture_pct=draw(decimals(0, 100, 2)),
        delivery_day=draw(day_offsets(0, 14)),
    )


@st.composite
def slots(draw, kind=None):
    from lot_state import Slot

    capacity = draw(decimals_0_2_places(1, 30))
    booked = Decimal(
        draw(st.integers(min_value=0, max_value=int(capacity * 100)))
    ).scaleb(-2)
    return Slot(
        slot_id=f"S{draw(st.integers(min_value=1, max_value=999)):03d}",
        kind=kind or draw(st.sampled_from(["bale", "haul"])),
        day=draw(day_offsets(0, 14)),
        capacity_tons=capacity,
        booked_tons=booked,
    )


@st.composite
def lots(draw, status=None):
    """A Lot in the given status (or any status when None).

    Shape is structurally valid for the dataclass; planning-level consistency
    is left to the tests that need it.
    """
    from lot_state import Confirmation, Lot, ShortfallDecision, Status

    chosen = status or draw(st.sampled_from(STATUSES))
    status_enum = Status(chosen)
    order = draw(orders())
    plot_ids = tuple(
        draw(st.lists(st.from_regex(r"P[0-9]{3}", fullmatch=True), max_size=4, unique=True))
    )
    has_queue = chosen != "draft" or draw(st.booleans())
    confirmations: tuple = ()
    if chosen in ("awaiting_confirmation", "ready", "closed"):
        parties = [("B01", "plant"), ("F01", "farmer"), ("C01", "contractor")]
        done_all = chosen in ("ready", "closed")
        confirmations = tuple(
            Confirmation(
                party_id=pid,
                name=f"ผู้ร่วมทดสอบ {pid}",
                role=role,
                confirmed=done_all or draw(st.booleans()),
                confirmed_at=None,
                baling_day=None,
                haul_day=None,
            )
            for pid, role in parties
        )
        if chosen == "awaiting_confirmation" and all(c.confirmed for c in confirmations):
            confirmations = confirmations[:-1] + (
                Confirmation(
                    party_id="C01", name="ผู้ร่วมทดสอบ C01", role="contractor",
                    confirmed=False, confirmed_at=None, baling_day=None, haul_day=None,
                ),
            )
    actual = None
    shortfall = None
    if chosen == "closed":
        actual = draw(decimals(0, 100, 2).filter(lambda d: d > 0))
    elif chosen == "ready" and draw(st.booleans()):
        actual = draw(decimals(0, 100, 2).filter(lambda d: d > 0))
        short = draw(decimals(0, 50, 2).filter(lambda d: d > 0))
        shortfall = ShortfallDecision(
            shortfall_tons=short, state="pending", resolution=None,
            remaining_to_source_tons=None,
        )
    return Lot(
        lot_id=f"L{draw(st.integers(min_value=1, max_value=999)):03d}",
        order=order,
        status=status_enum,
        revision=draw(st.integers(min_value=0, max_value=50)),
        selected_plot_ids=plot_ids,
        bale_slot_id="S001" if has_queue else None,
        haul_slot_id="S002" if has_queue else None,
        moisture_overrides={
            pid: draw(decimals(0, 100, 2)) for pid in plot_ids if draw(st.booleans())
        },
        confirmations=confirmations,
        actual_tons=actual,
        shortfall=shortfall,
    )


def lots_in_each_status() -> dict[str, st.SearchStrategy]:
    """One Lot strategy per status."""
    return {s: lots(status=s) for s in STATUSES}
