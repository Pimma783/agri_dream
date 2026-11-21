"""Mock fixtures and rate constants for the straw lot planning demo.

All data here is synthetic: names and ids are made up, and there are no phone
numbers, LINE ids, or coordinates. Distances are mock values per (plot, plant)
pair (assumption A4). Dates are integer day offsets from the Session start
date (assumption A3), so this module never reads a clock.

The raw records are plain tuples. `build_plots()` and `build_slots()` turn them
into the frozen dataclasses of `lot_state.py` (imported lazily, so this module
has no dependency on it at import time).
"""

from __future__ import annotations

from decimal import Decimal

# ------------------------------------------------------------------ rates
# Mock cost rates, single place (A1, A2, A5, A6). Shown as «ประมาณการ».
STRAW_PRICE_PER_TON = Decimal(300)   # baht/ton paid to the farmer
BALING_PER_TON = Decimal(250)        # baht/ton
HAUL_PER_TON_KM = Decimal(5)         # baht/ton/km
SLOT_CAPACITY_TONS = Decimal(15)     # tons per queue slot per day
BUFFER_PERCENT = 120                 # proposal targets >= 120% of Target_Tons
DEFAULT_MAX_MOISTURE = Decimal(20)   # percent

# Plants that may be used in orders (A12): open BUYERS entries accepting rice straw.
ORDER_PLANT_IDS = ("B01", "B02", "B03")

RICE_STRAW = "ฟางข้าว"
OTHER_MATERIAL = "ซังข้าวโพด"

# --------------------------------------------------------------- contractor
CONTRACTOR_ID = "C01"
CONTRACTOR_NAME = "ผู้รับจ้างตัวอย่าง C01"

# ------------------------------------------------------------------- plots
# (plot_id, owner_id, owner_name, material, expected_tons, distance_km,
#  ready_day, last_clear_day, moisture_pct)
# `distance_km` applies to every plant in ORDER_PLANT_IDS.
#
# Eligible (standard preset, 10 t): P001 4 t, P002 3 t, P003 5 t are selected by
# distance order and reach 12 t (>= 120% of 10 t). P004 (2 t) stays unselected.
# P002 has unknown moisture (None, shown as «รอตรวจ»).
_PLOT_ROWS = (
    ("P001", "F01", "เกษตรกรตัวอย่าง 1", RICE_STRAW, "4", "12", 1, 8, "14"),
    ("P002", "F02", "เกษตรกรตัวอย่าง 2", RICE_STRAW, "3", "25", 2, 9, None),
    ("P003", "F03", "เกษตรกรตัวอย่าง 3", RICE_STRAW, "5", "38", 1, 10, "18.5"),
    ("P004", "F04", "เกษตรกรตัวอย่าง 4", RICE_STRAW, "2", "55", 2, 10, "12"),
    # Excluded: moisture above the default 20% maximum.
    ("P005", "F05", "เกษตรกรตัวอย่าง 5", RICE_STRAW, "4", "20", 1, 8, "35"),
    # Excluded: distance above 80 km.
    ("P006", "F06", "เกษตรกรตัวอย่าง 6", RICE_STRAW, "6", "85", 1, 8, "15"),
    # Excluded: material is not rice straw.
    ("P007", "F07", "เกษตรกรตัวอย่าง 7", OTHER_MATERIAL, "5", "30", 1, 8, "15"),
    # Excluded: ready day is after the last clearing day.
    ("P008", "F08", "เกษตรกรตัวอย่าง 8", RICE_STRAW, "3", "30", 7, 5, "15"),
)

# Plot ids by role, for tests and docs.
ELIGIBLE_PLOT_IDS = ("P001", "P002", "P003", "P004")
PRESET_SELECTED_PLOT_IDS = ("P001", "P002", "P003")
EXTRA_PLOT_ID = "P004"
UNKNOWN_MOISTURE_PLOT_ID = "P002"
EXCLUDED_PLOT_IDS = {
    "moisture": "P005",
    "distance": "P006",
    "material": "P007",
    "window": "P008",
}

# ------------------------------------------------------------------- slots
# (slot_id, kind, day, capacity_tons, booked_tons)
# S002 has 10 t remaining and S005 has 7 t remaining, both under 12 t, so
# capacity violations are reachable. The first feasible pair for the preset is
# bale S001 (day 2) with haul S004 (day 4).
_SLOT_ROWS = (
    ("S001", "bale", 2, SLOT_CAPACITY_TONS, "0"),
    ("S002", "bale", 3, SLOT_CAPACITY_TONS, "5"),
    ("S003", "bale", 4, SLOT_CAPACITY_TONS, "0"),
    ("S004", "haul", 4, SLOT_CAPACITY_TONS, "0"),
    ("S005", "haul", 5, SLOT_CAPACITY_TONS, "8"),
    ("S006", "haul", 6, SLOT_CAPACITY_TONS, "0"),
)


def build_plots():
    """Return the mock Plots as `lot_state.Plot` objects, ordered by plot id."""
    from lot_state import Plot

    plots = []
    for pid, owner_id, owner, material, tons, km, ready, last, moisture in _PLOT_ROWS:
        plots.append(
            Plot(
                plot_id=pid,
                owner_id=owner_id,
                owner_name=owner,
                material=material,
                expected_tons=Decimal(tons),
                distance_km_by_plant={p: Decimal(km) for p in ORDER_PLANT_IDS},
                ready_day=ready,
                last_clear_day=last,
                moisture_pct=None if moisture is None else Decimal(moisture),
            )
        )
    return tuple(sorted(plots, key=lambda p: p.plot_id))


def build_slots():
    """Return the mock queue Slots as `lot_state.Slot` objects, ordered by id."""
    from lot_state import Slot

    return tuple(
        Slot(
            slot_id=sid,
            kind=kind,
            day=day,
            capacity_tons=Decimal(capacity),
            booked_tons=Decimal(booked),
        )
        for sid, kind, day, capacity, booked in _SLOT_ROWS
    )
