"""Pure planning rules for the straw lot planning demo.

No I/O, no clock, no randomness. Tons, distances and moisture are `Decimal`;
dates are integer day offsets from the Session start date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Mapping

from lot_state import Order, Plot, Slot, format_tons

MAX_DISTANCE_KM = Decimal(80)

# Reason codes, in the order reasons are reported (Req. 4.3-4.5, 4.8).
REASON_ORDER = ("material", "distance", "moisture", "baling_window", "haul_window")


@dataclass(frozen=True)
class Reason:
    code: str        # one of REASON_ORDER
    message_th: str  # Thai text citing the numbers or names involved


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    moisture_pending: bool
    reasons: tuple[Reason, ...]  # empty exactly when eligible


def plot_eligibility(
    plot: Plot,
    order: Order,
    moisture_override: Decimal | None = None,
) -> Eligibility:
    """Screen one Plot against one Order.

    `moisture_override` (a reading recorded on the Lot) replaces the fixture
    moisture when given. Unknown moisture does not exclude the Plot; it sets
    `moisture_pending` (A9).
    """
    reasons: list[Reason] = []

    # Material (4.5)
    if plot.material != order.material:
        reasons.append(
            Reason(
                "material",
                f"วัสดุของแปลงคือ {plot.material} แต่ออเดอร์ต้องการ {order.material}",
            )
        )

    # Distance: 80.0 passes, 80.1 fails (4.1, 4.4)
    distance = plot.distance_km_by_plant.get(order.plant_id)
    if distance is None:
        reasons.append(
            Reason("distance", f"ไม่มีข้อมูลระยะทางจากแปลง {plot.plot_id} ถึงโรงงาน {order.plant_id}")
        )
    elif distance > MAX_DISTANCE_KM:
        reasons.append(
            Reason(
                "distance",
                f"ระยะทาง {format_tons(distance)} กม. เกินขีดจำกัด {format_tons(MAX_DISTANCE_KM)} กม.",
            )
        )

    # Moisture (4.1-4.3)
    moisture = moisture_override if moisture_override is not None else plot.moisture_pct
    moisture_pending = moisture is None
    if moisture is not None and moisture > order.max_moisture_pct:
        reasons.append(
            Reason(
                "moisture",
                f"ความชื้น {format_tons(moisture)}% สูงกว่าที่รับได้ไม่เกิน {format_tons(order.max_moisture_pct)}%",
            )
        )

    # Baling window: ready day <= last clearing day, inclusive (4.6, 4.8)
    if plot.ready_day > plot.last_clear_day:
        reasons.append(
            Reason(
                "baling_window",
                f"ช่วงอัดฟ่อนไม่มีวันที่ทำได้: พร้อมวันที่ {plot.ready_day} "
                f"แต่ต้องเคลียร์แปลงภายในวันที่ {plot.last_clear_day}",
            )
        )

    # Haul window: earliest bale day is ready_day, haul day must fall in
    # [bale day, delivery day], so ready_day <= delivery_day (4.7, 4.8)
    if plot.ready_day > order.delivery_day:
        reasons.append(
            Reason(
                "haul_window",
                f"ช่วงขนส่งไม่มีวันที่ทำได้: พร้อมวันที่ {plot.ready_day} "
                f"แต่ส่งมอบภายในวันที่ {order.delivery_day}",
            )
        )

    return Eligibility(
        eligible=not reasons,
        moisture_pending=moisture_pending,
        reasons=tuple(reasons),
    )


# ---------------------------------------------------------------- queue checks

# Order in which failing conditions are reported (Req. 16.2).
CHECK_ORDER = ("ready_date", "last_clearing_date", "delivery_date", "queue_capacity")


@dataclass(frozen=True)
class Violation:
    code: str          # one of CHECK_ORDER
    subject_type: str  # "plot" | "slot"
    subject_id: str    # plot id, slot id, or "none" when a slot kind is empty
    message_th: str    # names the Plot or Slot and the violated constraint
    detail: Mapping[str, str]


@dataclass(frozen=True)
class QueueProposal:
    bale_slot_id: str | None  # set only when the pair is feasible
    haul_slot_id: str | None
    violations: tuple[Violation, ...]  # empty when a queue is assigned
    best_failed_bale_slot_id: str | None = None
    best_failed_haul_slot_id: str | None = None

    @property
    def assigned(self) -> bool:
        return self.bale_slot_id is not None


def check_queue_pair(
    plots: Iterable[Plot],
    order: Order,
    bale_slot: Slot,
    haul_slot: Slot,
) -> tuple[Violation, ...]:
    """Return every violated condition for a (bale, haul) slot pair.

    The tuple is sorted by (CHECK_ORDER index, subject_id); an empty tuple means
    the pair is feasible. Element 0 is the "first failing condition" (16.2).
    All date bounds are inclusive.
    """
    plots = tuple(plots)
    b = bale_slot.day
    h = haul_slot.day
    estimated = sum((p.expected_tons for p in plots), Decimal(0))
    found: list[Violation] = []

    for p in plots:
        if b < p.ready_day:
            found.append(
                Violation(
                    "ready_date", "plot", p.plot_id,
                    f"แปลง {p.plot_id}: วันอัดฟ่อน {b} ก่อนวันพร้อมเก็บเกี่ยว {p.ready_day}",
                    {"bale_day": str(b), "ready_day": str(p.ready_day)},
                )
            )
        if b > p.last_clear_day:
            found.append(
                Violation(
                    "last_clearing_date", "plot", p.plot_id,
                    f"แปลง {p.plot_id}: วันอัดฟ่อน {b} เกินวันที่ต้องเคลียร์แปลง {p.last_clear_day}",
                    {"bale_day": str(b), "last_clear_day": str(p.last_clear_day)},
                )
            )

    if h > order.delivery_day:
        found.append(
            Violation(
                "delivery_date", "slot", haul_slot.slot_id,
                f"ช่องขนส่ง {haul_slot.slot_id}: วันขน {h} เกินวันส่งมอบ {order.delivery_day}",
                {"haul_day": str(h), "delivery_day": str(order.delivery_day)},
            )
        )
    elif h < b:
        found.append(
            Violation(
                "delivery_date", "slot", haul_slot.slot_id,
                f"ช่องขนส่ง {haul_slot.slot_id}: วันขน {h} ก่อนวันอัดฟ่อน {b}",
                {"haul_day": str(h), "bale_day": str(b)},
            )
        )

    for kind_th, slot in (("อัดฟ่อน", bale_slot), ("ขนส่ง", haul_slot)):
        if slot.remaining_tons < estimated:
            found.append(
                Violation(
                    "queue_capacity", "slot", slot.slot_id,
                    f"ช่อง{kind_th} {slot.slot_id}: เหลือ {format_tons(slot.remaining_tons)} ตัน "
                    f"น้อยกว่าปริมาณประมาณการ {format_tons(estimated)} ตัน",
                    {
                        "remaining_tons": format_tons(slot.remaining_tons),
                        "estimated_tons": format_tons(estimated),
                    },
                )
            )

    found.sort(key=lambda v: (CHECK_ORDER.index(v.code), v.subject_id))
    return tuple(found)


def propose_queue(
    plots: Iterable[Plot],
    order: Order,
    bale_slots: Iterable[Slot],
    haul_slots: Iterable[Slot],
) -> QueueProposal:
    """Pick the first feasible (bale, haul) pair, scanning in
    (bale_day, bale_slot_id, haul_day, haul_slot_id) order.

    If no pair is feasible, assign no queue and report the pair with the fewest
    violations (ties by scan order) and that pair's violations. If a slot kind
    is empty, report one `queue_capacity` violation with subject_id "none".
    """
    plots = tuple(plots)
    bales = sorted(bale_slots, key=lambda s: (s.day, s.slot_id))
    hauls = sorted(haul_slots, key=lambda s: (s.day, s.slot_id))

    if not bales or not hauls:
        missing = "อัดฟ่อน" if not bales else "ขนส่ง"
        return QueueProposal(
            None, None,
            (
                Violation(
                    "queue_capacity", "slot", "none",
                    f"ไม่มีช่องคิว{missing}",
                    {"missing_kind": "bale" if not bales else "haul"},
                ),
            ),
        )

    best: tuple[Slot, Slot, tuple[Violation, ...]] | None = None
    for bale in bales:
        for haul in hauls:
            violations = check_queue_pair(plots, order, bale, haul)
            if not violations:
                return QueueProposal(bale.slot_id, haul.slot_id, ())
            if best is None or len(violations) < len(best[2]):
                best = (bale, haul, violations)

    assert best is not None
    return QueueProposal(None, None, best[2], best[0].slot_id, best[1].slot_id)


# ------------------------------------------------------- selection and cost

from fractions import Fraction  # noqa: E402
from dataclasses import field  # noqa: E402

from lot_fixtures import (  # noqa: E402
    BALING_PER_TON,
    BUFFER_PERCENT,
    HAUL_PER_TON_KM,
    STRAW_PRICE_PER_TON,
    build_plots,
    build_slots,
)
from lot_state import Lot, Status  # noqa: E402


def select_plots(eligible_plots: Iterable[Plot], order: Order) -> tuple[str, ...]:
    """Pick Plots in A7 order until Estimated_Tons >= 120% of Target_Tons (A6).

    Sort key is (distance to the order's plant, ready_day, plot_id). The stop
    test is exact: estimated * 100 >= target * BUFFER_PERCENT.
    """
    ordered = sorted(
        eligible_plots,
        key=lambda p: (p.distance_km_by_plant[order.plant_id], p.ready_day, p.plot_id),
    )
    chosen: list[str] = []
    estimated = Decimal(0)
    for p in ordered:
        if estimated * 100 >= order.target_tons * BUFFER_PERCENT:
            break
        chosen.append(p.plot_id)
        estimated += p.expected_tons
    return tuple(chosen)


@dataclass(frozen=True)
class DeliveredCost:
    per_ton: Decimal       # whole baht, half-up (A13)
    straw_total: Decimal
    baling_total: Decimal
    haul_total: Decimal
    estimated_tons: Decimal


def _round_half_up_int(numerator: Decimal, denominator: Decimal) -> Decimal:
    q = Fraction(numerator) / Fraction(denominator)
    return Decimal((q + Fraction(1, 2)).__floor__())


def delivered_cost(plots: Iterable[Plot], plant_id: str) -> DeliveredCost | None:
    """(straw + baling + haulage) / estimated tons, whole baht half-up.

    Returns None when the selection holds no tons (6.6).
    """
    plots = tuple(plots)
    tons = sum((p.expected_tons for p in plots), Decimal(0))
    if tons <= 0:
        return None
    straw = STRAW_PRICE_PER_TON * tons
    baling = BALING_PER_TON * tons
    haul = sum(
        (p.expected_tons * p.distance_km_by_plant[plant_id] * HAUL_PER_TON_KM for p in plots),
        Decimal(0),
    )
    return DeliveredCost(
        per_ton=_round_half_up_int(straw + baling + haul, tons),
        straw_total=straw,
        baling_total=baling,
        haul_total=haul,
        estimated_tons=tons,
    )


# ------------------------------------------------------------------- view


@dataclass(frozen=True)
class Fixtures:
    plots: tuple[Plot, ...]
    slots: tuple[Slot, ...]

    @property
    def bale_slots(self) -> tuple[Slot, ...]:
        return tuple(s for s in self.slots if s.kind == "bale")

    @property
    def haul_slots(self) -> tuple[Slot, ...]:
        return tuple(s for s in self.slots if s.kind == "haul")


def default_fixtures() -> Fixtures:
    return Fixtures(plots=build_plots(), slots=build_slots())


@dataclass(frozen=True)
class PlotView:
    plot: Plot
    eligibility: Eligibility
    moisture_pct: Decimal | None  # effective value (override applied)
    distance_km: Decimal | None
    reason_th: str                # why selected, or why excluded


@dataclass(frozen=True)
class SlotView:
    slot_id: str
    kind: str
    day: int
    date: str | None  # ISO, None when the Session start date is not given
    remaining_tons: Decimal


@dataclass(frozen=True)
class ConfirmationView:
    party_id: str
    role: str
    name: str
    confirmed: bool
    confirmed_at: str | None


@dataclass(frozen=True)
class ShortfallView:
    state: str  # "pending" | "resolved"
    resolution: str | None
    shortfall_tons: Decimal
    remaining_to_source_tons: Decimal | None


@dataclass(frozen=True)
class AddablePlotView:
    plot_id: str
    owner_id: str
    owner_name: str
    expected_tons: Decimal
    distance_km: Decimal | None
    ready_day: int
    last_clear_day: int
    ready_date: str | None
    last_clear_date: str | None
    moisture_pct: Decimal | None


@dataclass(frozen=True)
class LotView:
    lot_id: str
    revision: int
    status: Status
    status_label: str
    next_action: str
    conditions_th: tuple[str, ...]
    target_tons: Decimal
    estimated_tons: Decimal
    shortfall_tons: Decimal
    delivered_cost: DeliveredCost | None
    offer_price: Decimal
    selected: tuple[PlotView, ...]
    excluded: tuple[PlotView, ...]
    addable_plot_ids: tuple[str, ...]  # eligible and not selected
    bale_slot_id: str | None
    haul_slot_id: str | None
    queue_assigned: bool
    violations: tuple[Violation, ...]
    first_violation: Violation | None
    confirmed_count: int
    confirmation_total: int
    pending_parties: tuple[str, ...]   # names of parties not yet confirmed
    no_eligible_plot: bool
    actual_tons: Decimal | None = None
    shortfall_decision: ShortfallView | None = None
    slots: tuple[SlotView, ...] = ()
    bale_date: str | None = None
    haul_date: str | None = None
    confirmations: tuple[ConfirmationView, ...] = ()
    addable_plots: tuple[AddablePlotView, ...] = ()


def order_conditions_th(order: Order) -> tuple[str, ...]:
    """Thai list of the conditions a Lot must pass (3.2)."""
    return (
        f"วัสดุ: {order.material}",
        f"ปริมาณเป้าหมาย: {format_tons(order.target_tons)} ตัน",
        f"วันส่งมอบ: วันที่ {order.delivery_day} นับจากวันเริ่มเดโม",
        f"ความชื้นสูงสุด: {format_tons(order.max_moisture_pct)}%",
        f"ระยะทางจากแปลงถึงโรงงานไม่เกิน {format_tons(MAX_DISTANCE_KM)} กม.",
        "วันขนส่งต้องไม่เกินวันส่งมอบ",
    )


def _next_action(lot: Lot, has_selection: bool) -> str:
    if lot.status is Status.DRAFT:
        return "submit" if has_selection else "propose"
    if lot.status is Status.AWAITING:
        return "wait_for_confirmations"
    if lot.status is Status.READY:
        if lot.shortfall is not None and lot.shortfall.state == "pending":
            return "decide_shortfall"
        return "record_weight"
    return "new_order"


def build_view(
    lot: Lot, fixtures: Fixtures | None = None, start_date: date | None = None
) -> LotView:
    """Derive everything shown for a Lot. Pure: nothing here is stored.

    `start_date` (Session day 0) only fills the ISO date fields; without it
    they are None.
    """
    fx = fixtures or default_fixtures()

    def iso(day: int) -> str | None:
        return None if start_date is None else (start_date + timedelta(days=day)).isoformat()
    order = lot.order
    by_id = {p.plot_id: p for p in fx.plots}

    def pview(plot: Plot, reason: str | None = None) -> PlotView:
        ov = lot.moisture_overrides.get(plot.plot_id)
        elig = plot_eligibility(plot, order, ov)
        moisture = ov if ov is not None else plot.moisture_pct
        text = reason if reason is not None else "; ".join(r.message_th for r in elig.reasons)
        return PlotView(plot, elig, moisture, plot.distance_km_by_plant.get(order.plant_id), text)

    eligible = [p for p in fx.plots if pview(p).eligibility.eligible]
    rule_ids = select_plots(eligible, order)

    selected_plots = [by_id[i] for i in lot.selected_plot_ids if i in by_id]
    selected_views = []
    for p in selected_plots:
        if p.plot_id in rule_ids:
            n = rule_ids.index(p.plot_id) + 1
            reason = (
                f"เลือกลำดับที่ {n} ตามกติกา: ระยะทางใกล้ที่สุดก่อน "
                f"({format_tons(p.distance_km_by_plant[order.plant_id])} กม.) "
                f"แล้วเรียงตามวันพร้อมเก็บเกี่ยว (วันที่ {p.ready_day}) จนถึง "
                f"{BUFFER_PERCENT}% ของเป้าหมาย"
            )
        else:
            reason = "เพิ่มโดยผู้ประสานงาน"
        selected_views.append(pview(p, reason))

    selected_set = set(lot.selected_plot_ids)
    excluded_views = tuple(pview(p) for p in fx.plots if not pview(p).eligibility.eligible)
    addable = tuple(p.plot_id for p in eligible if p.plot_id not in selected_set)

    estimated = sum((p.expected_tons for p in selected_plots), Decimal(0))
    shortfall = max(Decimal(0), order.target_tons - estimated)
    cost = delivered_cost(selected_plots, order.plant_id)

    # Queue: check the chosen pair when both are selected, otherwise show why
    # no queue could be proposed for the current selection.
    bale = next((s for s in fx.bale_slots if s.slot_id == lot.bale_slot_id), None)
    haul = next((s for s in fx.haul_slots if s.slot_id == lot.haul_slot_id), None)
    if not selected_plots:
        violations: tuple[Violation, ...] = ()
        assigned = False
    elif bale is not None and haul is not None:
        violations = check_queue_pair(selected_plots, order, bale, haul)
        assigned = not violations
    else:
        prop = propose_queue(selected_plots, order, fx.bale_slots, fx.haul_slots)
        violations = prop.violations
        assigned = False

    slot_views = tuple(
        SlotView(s.slot_id, s.kind, s.day, iso(s.day), s.remaining_tons)
        for s in (*fx.bale_slots, *fx.haul_slots)
    )
    addable_views = []
    for pid in addable:
        p = by_id[pid]
        ov = lot.moisture_overrides.get(pid)
        addable_views.append(
            AddablePlotView(
                pid, p.owner_id, p.owner_name, p.expected_tons,
                p.distance_km_by_plant.get(order.plant_id),
                p.ready_day, p.last_clear_day, iso(p.ready_day), iso(p.last_clear_day),
                ov if ov is not None else p.moisture_pct,
            )
        )
    sf = lot.shortfall
    decision = (
        None
        if sf is None
        else ShortfallView(sf.state, sf.resolution, sf.shortfall_tons, sf.remaining_to_source_tons)
    )

    confs = lot.confirmations
    confirmed = sum(1 for c in confs if c.confirmed)

    return LotView(
        lot_id=lot.lot_id,
        revision=lot.revision,
        status=lot.status,
        status_label=lot.status.label_th,
        next_action=_next_action(lot, bool(selected_plots)),
        conditions_th=order_conditions_th(order),
        target_tons=order.target_tons,
        estimated_tons=estimated,
        shortfall_tons=shortfall,
        delivered_cost=cost,
        offer_price=order.offer_price,
        selected=tuple(selected_views),
        excluded=excluded_views,
        addable_plot_ids=addable,
        bale_slot_id=lot.bale_slot_id,
        haul_slot_id=lot.haul_slot_id,
        queue_assigned=assigned,
        violations=violations,
        first_violation=violations[0] if violations else None,
        confirmed_count=confirmed,
        confirmation_total=len(confs),
        pending_parties=tuple(c.name for c in confs if not c.confirmed),
        no_eligible_plot=not eligible,
        actual_tons=lot.actual_tons,
        shortfall_decision=decision,
        slots=slot_views,
        bale_date=iso(bale.day) if bale is not None else None,
        haul_date=iso(haul.day) if haul is not None else None,
        confirmations=tuple(
            ConfirmationView(c.party_id, c.role, c.name, c.confirmed, c.confirmed_at)
            for c in confs
        ),
        addable_plots=tuple(addable_views),
    )
