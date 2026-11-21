"""Lot service: in-memory session store and per-session state.

Sessions are keyed by a random token only (A8, 13.9). No LINE userId is used.
The clock is injected, so this module never reads real time by itself.
"""

from __future__ import annotations

import dataclasses
import re
import secrets
import threading
from collections.abc import Callable, Mapping
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from enum import Enum
from typing import Any

from lot_fixtures import CONTRACTOR_ID, CONTRACTOR_NAME, ORDER_PLANT_IDS, RICE_STRAW
from lot_planning import (
    Fixtures,
    build_view,
    check_queue_pair,
    default_fixtures,
    plot_eligibility,
    propose_queue,
    select_plots,
)
from lot_state import Confirmation, Lot, Order, ShortfallDecision, Status, format_tons
from matching import BUYERS

SESSION_IDLE_LIMIT = timedelta(hours=24)  # 13.8, A8
MAX_SESSIONS = 500  # D5
MAX_LOTS_PER_SESSION = 20  # D5


class Session:
    """State of one demo session. Hold `lock` while reading or writing it."""

    def __init__(
        self,
        session_id: str,
        now: datetime,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.session_id = session_id
        self._clock = clock
        self.start_date: date = now.date()  # day 0 for A2/A3
        self.last_seen: datetime = now
        self.lots: dict[str, Lot] = {}
        self.lot_order: list[str] = []
        self.next_seq: int = 1
        self.lock = threading.Lock()

    def now(self) -> datetime:
        """Current time from the injected clock (last_seen if none was given)."""
        return self._clock() if self._clock is not None else self.last_seen

    def can_add_lot(self) -> bool:
        return len(self.lots) < MAX_LOTS_PER_SESSION

    def new_lot_id(self) -> str:
        lot_id = f"L{self.next_seq:03d}"
        self.next_seq += 1
        return lot_id

    def add_lot(self, lot: Lot) -> None:
        """Store a new Lot. Caller holds `lock` and checks `can_add_lot`."""
        if lot.lot_id in self.lots:
            raise ValueError("duplicate lot id")
        if not self.can_add_lot():
            raise ValueError("lot cap reached")
        self.lots[lot.lot_id] = lot
        self.lot_order.append(lot.lot_id)

    def replace_lot(self, lot: Lot) -> None:
        if lot.lot_id not in self.lots:
            raise KeyError(lot.lot_id)
        self.lots[lot.lot_id] = lot


class SessionStore:
    def __init__(
        self,
        clock: Callable[[], datetime],
        token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(24),
        max_sessions: int = MAX_SESSIONS,
    ) -> None:
        self._clock = clock
        self._token_factory = token_factory
        self._max_sessions = max_sessions
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def _expired(self, session: Session, now: datetime) -> bool:
        return now - session.last_seen >= SESSION_IDLE_LIMIT

    def _sweep_locked(self, now: datetime) -> None:
        for token in [t for t, s in self._sessions.items() if self._expired(s, now)]:
            del self._sessions[token]

    def sweep(self) -> None:
        """Remove every session idle for 24 hours or more."""
        with self._lock:
            self._sweep_locked(self._clock())

    def resolve(self, token: str | None) -> tuple[Session, bool]:
        """Return (session, was_reset).

        was_reset is True only when a token was sent but is unknown,
        malformed, or expired. No token at all is a normal first visit.
        """
        with self._lock:
            now = self._clock()
            sent = token is not None and token != ""
            if sent and isinstance(token, str):
                session = self._sessions.get(token)
                if session is not None:
                    if not self._expired(session, now):
                        session.last_seen = now
                        return session, False
                    del self._sessions[token]
            self._sweep_locked(now)
            while len(self._sessions) >= self._max_sessions:
                oldest = min(self._sessions, key=lambda t: self._sessions[t].last_seen)
                del self._sessions[oldest]
            new_token = self._token_factory()
            while new_token in self._sessions:
                new_token = self._token_factory()
            session = Session(new_token, now, self._clock)
            self._sessions[new_token] = session
            return session, bool(sent)


# ----------------------------------------------------------------- results


@dataclasses.dataclass(frozen=True)
class Result:
    """Outcome of a service operation (shared by every operation and webapp).

    `body` is a JSON-ready dict. Errors use these shapes:
      422: {"errors": {field: thai_message}, "message": str}
      400/404/409: {"message": str, "code": str}
    """

    ok: bool
    http_status: int
    body: dict[str, Any]


def to_jsonable(value: Any) -> Any:
    """Convert views and state to JSON-ready values (Decimal -> number)."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, Enum):
        return value.value
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: to_jsonable(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, Mapping):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_jsonable(v) for v in value]
    return value


def success(body: dict[str, Any], http_status: int = 200) -> Result:
    return Result(True, http_status, body)


def field_errors(errors: Mapping[str, str]) -> Result:
    """422 with every invalid field in one response."""
    return Result(
        False, 422, {"errors": dict(errors), "message": "ข้อมูลบางช่องไม่ถูกต้อง"}
    )


def failure(http_status: int, code: str, message: str) -> Result:
    return Result(False, http_status, {"message": message, "code": code})


def lot_body(lot: Lot, start_date: date, **extra: Any) -> dict[str, Any]:
    """Response body: the derived view (ISO dates from the Session start) plus extras."""
    return {"lot": to_jsonable(build_view(lot, None, start_date)), **extra}


def check_write_preconditions(
    session: Session,
    lot_id: Any,
    revision: Any,
    allowed_statuses: frozenset[Status] | None = None,
) -> tuple[Lot | None, Result | None]:
    """Fixed check order for Lot writes: 404, 409 revision, 409 status.

    Callers hold `session.lock` and run their 422 value checks afterwards.
    `allowed_statuses=None` means every status except closed. A malformed
    revision (not an integer) is a 422 on the `revision` field (7.9, 13.6).
    """
    lot = session.lots.get(lot_id) if isinstance(lot_id, str) else None
    if lot is None:
        return None, failure(404, "lot_not_found", "ไม่พบล็อตนี้")
    if isinstance(revision, bool) or not isinstance(revision, int):
        return None, field_errors({"revision": "ต้องเป็นเลขรุ่นของล็อต"})
    if revision != lot.revision:
        return None, failure(
            409, "revision_conflict", "ล็อตถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด"
        )
    allowed = allowed_statuses or frozenset(s for s in Status if s is not Status.CLOSED)
    if lot.status not in allowed:
        if lot.status is Status.CLOSED:
            return None, failure(409, "lot_closed", "ล็อตปิดแล้ว แก้ไขไม่ได้")
        return None, failure(
            409, "wrong_status", f"ทำรายการนี้ไม่ได้ในสถานะ «{lot.status.label_th}»"
        )
    return lot, None


# -------------------------------------------------------------- validation

ORDER_FIELDS = (
    "plant_id",
    "material",
    "target_tons",
    "offer_price",
    "max_moisture_pct",
    "delivery_date",
)
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_CENT = Decimal("0.01")
_MSG_NUMBER = "ต้องเป็นตัวเลข"


def json_number(value: Any) -> Decimal | None:
    """Return the value as Decimal if it is a finite JSON number, else None.

    Booleans, strings, NaN and infinity are rejected.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    return Decimal(str(value))


def eligible_order_plant(plant_id: Any) -> bool:
    """A12: a known, open BUYERS entry that accepts rice straw (B01-B03)."""
    if not isinstance(plant_id, str) or plant_id not in ORDER_PLANT_IDS:
        return False
    buyer = BUYERS.get(plant_id)
    return buyer is not None and buyer[3] is True and RICE_STRAW in buyer[1]


def validate_order_payload(
    payload: Mapping[str, Any], start_date: date
) -> tuple[dict[str, Any] | None, dict[str, str]]:
    """Return (clean values, errors). Every invalid field is reported (3.3)."""
    errors: dict[str, str] = {}
    clean: dict[str, Any] = {}

    plant_id = payload.get("plant_id")
    if eligible_order_plant(plant_id):
        clean["plant_id"] = plant_id
    else:
        errors["plant_id"] = "เลือกโรงงานที่เปิดรับซื้อและรับฟางข้าว"

    if payload.get("material") == RICE_STRAW:
        clean["material"] = RICE_STRAW
    else:
        errors["material"] = f"รองรับเฉพาะ {RICE_STRAW}"

    tons = json_number(payload.get("target_tons"))
    if tons is None:
        errors["target_tons"] = _MSG_NUMBER
    elif not (0 < tons <= 100) or tons != tons.quantize(_CENT):
        errors["target_tons"] = "ต้องมากกว่า 0 และไม่เกิน 100 ตัน ทศนิยมไม่เกิน 2 ตำแหน่ง"
    else:
        clean["target_tons"] = tons

    price = json_number(payload.get("offer_price"))
    if price is None:
        errors["offer_price"] = _MSG_NUMBER
    elif not (0 < price <= 100000):
        errors["offer_price"] = "ต้องมากกว่า 0 และไม่เกิน 100,000 บาทต่อตัน"
    else:
        clean["offer_price"] = price

    moisture = json_number(payload.get("max_moisture_pct"))
    if moisture is None:
        errors["max_moisture_pct"] = _MSG_NUMBER
    elif not (1 <= moisture <= 100):
        errors["max_moisture_pct"] = "ต้องอยู่ระหว่าง 1 ถึง 100 เปอร์เซ็นต์"
    else:
        clean["max_moisture_pct"] = moisture

    raw_date = payload.get("delivery_date")
    parsed: date | None = None
    if isinstance(raw_date, str) and _DATE_RE.fullmatch(raw_date):
        try:
            parsed = date.fromisoformat(raw_date)
        except ValueError:
            parsed = None
    if parsed is None:
        errors["delivery_date"] = "ใส่วันที่รูปแบบ ปปปป-ดด-วว"
    else:
        day = (parsed - start_date).days
        if day < 0:
            errors["delivery_date"] = "วันส่งมอบต้องไม่เร็วกว่าวันเริ่มเดโม"
        else:
            clean["delivery_day"] = day

    return (None, errors) if errors else (clean, errors)


# -------------------------------------------------------------- operations


def create_order(session: Session, payload: Any) -> Result:
    """Create one Order and one linked draft Lot, or change nothing (3.1-3.4)."""
    if not isinstance(payload, Mapping):
        return failure(400, "bad_body", "ข้อมูลที่ส่งมาต้องเป็นออบเจ็กต์ JSON")
    with session.lock:
        clean, errors = validate_order_payload(payload, session.start_date)
        if clean is None:
            return field_errors(errors)
        if not session.can_add_lot():
            return failure(409, "lot_cap", "สร้างล็อตได้ไม่เกิน 20 ล็อตต่อ session")
        lot_id = session.new_lot_id()
        order = Order(
            order_id="O" + lot_id[1:],
            plant_id=clean["plant_id"],
            material=clean["material"],
            target_tons=clean["target_tons"],
            offer_price=clean["offer_price"],
            max_moisture_pct=clean["max_moisture_pct"],
            delivery_day=clean["delivery_day"],
        )
        lot = Lot(lot_id=lot_id, order=order, status=Status.DRAFT, revision=0)
        session.add_lot(lot)
        return success(lot_body(lot, session.start_date), 201)


def get_lot(session: Session, lot_id: Any) -> Result:
    """Read a Lot. Works in every status, including closed (7.10)."""
    with session.lock:
        lot = session.lots.get(lot_id) if isinstance(lot_id, str) else None
        if lot is None:
            return failure(404, "lot_not_found", "ไม่พบล็อตนี้")
        return success(lot_body(lot, session.start_date))


# ------------------------------------------------------- propose and edits

EDIT_TYPES = ("add_plot", "remove_plot", "set_price", "set_moisture", "set_queue")
_EDIT_FIELD = {
    "add_plot": "selected_plots",
    "remove_plot": "selected_plots",
    "set_price": "offer_price",
    "set_moisture": "moisture_pct",
    "set_queue": "queue_slots",
}
_FIXTURES: Fixtures | None = None


def _fixtures() -> Fixtures:
    global _FIXTURES
    if _FIXTURES is None:
        _FIXTURES = default_fixtures()
    return _FIXTURES


def _errors_with(errors: Mapping[str, str], **extra: Any) -> Result:
    base = field_errors(errors)
    return Result(False, 422, {**base.body, **to_jsonable(extra)})


def _normalize(cand: Lot, fx: Fixtures) -> tuple[Lot, tuple[str, ...]]:
    """Drop ineligible Plots (D2), keep a feasible queue pair (D4), else re-propose."""
    by_id = {p.plot_id: p for p in fx.plots}
    kept: list[str] = []
    dropped: list[str] = []
    for pid in cand.selected_plot_ids:
        plot = by_id.get(pid)
        if plot is not None and plot_eligibility(
            plot, cand.order, cand.moisture_overrides.get(pid)
        ).eligible:
            kept.append(pid)
        else:
            dropped.append(pid)
    plots = [by_id[i] for i in kept]

    bale_id: str | None = None
    haul_id: str | None = None
    if plots:
        bale = next((s for s in fx.bale_slots if s.slot_id == cand.bale_slot_id), None)
        haul = next((s for s in fx.haul_slots if s.slot_id == cand.haul_slot_id), None)
        if bale and haul and not check_queue_pair(plots, cand.order, bale, haul):
            bale_id, haul_id = bale.slot_id, haul.slot_id
        else:
            prop = propose_queue(plots, cand.order, fx.bale_slots, fx.haul_slots)
            if prop.assigned:
                bale_id, haul_id = prop.bale_slot_id, prop.haul_slot_id
    return (
        dataclasses.replace(
            cand,
            selected_plot_ids=tuple(kept),
            bale_slot_id=bale_id,
            haul_slot_id=haul_id,
        ),
        tuple(dropped),
    )


def _plan_ok(lot: Lot, fx: Fixtures) -> bool:
    """Estimated >= target and a feasible queue pair is assigned."""
    if lot.bale_slot_id is None or lot.haul_slot_id is None:
        return False
    by_id = {p.plot_id: p for p in fx.plots}
    est = sum((by_id[i].expected_tons for i in lot.selected_plot_ids), Decimal(0))
    return est >= lot.order.target_tons


def _commit(
    session: Session,
    lot: Lot,
    cand: Lot,
    dropped: tuple[str, ...],
    changed_field: str,
    fx: Fixtures,
) -> Result:
    """No-op detection, status derivation, one revision bump, one assignment."""
    if cand == lot:
        return success(lot_body(lot, session.start_date, changed=False, dropped_plot_ids=[]))

    reset_notice: dict[str, Any] | None = None
    demoted = False
    new = cand
    if lot.status in (Status.AWAITING, Status.READY):
        ok = _plan_ok(cand, fx)
        was_confirmed = [c.name for c in lot.confirmations if c.confirmed]
        reset = tuple(
            Confirmation(c.party_id, c.role, c.name, False, None, None, None)
            for c in lot.confirmations
        )
        new = dataclasses.replace(
            cand,
            confirmations=reset,
            status=Status.AWAITING if ok else Status.DRAFT,
        )
        demoted = not ok
        if was_confirmed:
            reset_notice = {
                "changed_field": changed_field,
                "reset_parties": was_confirmed,
            }
    new = dataclasses.replace(new, revision=lot.revision + 1)
    session.lots[lot.lot_id] = new  # single assignment commit

    extra: dict[str, Any] = {"changed": True, "dropped_plot_ids": list(dropped)}
    if reset_notice is not None:
        extra["reset_notice"] = reset_notice
    if demoted:
        view = build_view(new, fx)
        conditions: list[str] = []
        if view.shortfall_tons > 0:
            conditions.append(f"ขาด {format_tons(view.shortfall_tons)} ตัน")
        conditions.extend(v.message_th for v in view.violations)
        extra["failing_conditions"] = conditions
    return success(lot_body(new, session.start_date, **extra))


def propose(session: Session, lot_id: Any, revision: Any) -> Result:
    """Select Plots and a queue pair by rule. Draft status only (5.1)."""
    with session.lock:
        lot, err = check_write_preconditions(
            session, lot_id, revision, frozenset({Status.DRAFT})
        )
        if err is not None:
            return err
        assert lot is not None
        fx = _fixtures()
        eligible = [
            p
            for p in fx.plots
            if plot_eligibility(p, lot.order, lot.moisture_overrides.get(p.plot_id)).eligible
        ]
        ids = select_plots(eligible, lot.order)
        cand, dropped = _normalize(
            dataclasses.replace(
                lot, selected_plot_ids=ids, bale_slot_id=None, haul_slot_id=None
            ),
            fx,
        )
        return _commit(session, lot, cand, dropped, "selected_plots", fx)


def apply_edit(session: Session, lot_id: Any, revision: Any, edit: Any) -> Result:
    """Apply one plan edit through validate, candidate, normalize, commit."""
    with session.lock:
        lot, err = check_write_preconditions(session, lot_id, revision)
        if err is not None:
            return err
        assert lot is not None
        if lot.shortfall is not None and lot.shortfall.state == "pending":  # D3
            return failure(
                409, "shortfall_pending", "รอตัดสินใจเรื่องปริมาณขาด แก้แผนไม่ได้"
            )
        if not isinstance(edit, Mapping):
            return failure(400, "bad_body", "ข้อมูลที่ส่งมาต้องเป็นออบเจ็กต์ JSON")
        kind = edit.get("type")
        if kind not in EDIT_TYPES:
            return field_errors({"type": "ชนิดการแก้ไขไม่ถูกต้อง"})

        fx = _fixtures()
        by_id = {p.plot_id: p for p in fx.plots}
        order = lot.order
        cand = lot

        if kind in ("add_plot", "remove_plot", "set_moisture"):
            pid = edit.get("plot_id")
            if not isinstance(pid, str) or pid not in by_id:
                return field_errors({"plot_id": "ไม่พบแปลงนี้"})

        if kind == "add_plot":
            elig = plot_eligibility(by_id[pid], order, lot.moisture_overrides.get(pid))
            if not elig.eligible:
                reasons = [r.message_th for r in elig.reasons]
                return _errors_with(
                    {"plot_id": "; ".join(reasons)}, reasons=reasons
                )
            if pid not in lot.selected_plot_ids:
                cand = dataclasses.replace(
                    lot, selected_plot_ids=lot.selected_plot_ids + (pid,)
                )
        elif kind == "remove_plot":
            if pid in lot.selected_plot_ids:
                cand = dataclasses.replace(
                    lot,
                    selected_plot_ids=tuple(i for i in lot.selected_plot_ids if i != pid),
                )
        elif kind == "set_price":
            price = json_number(edit.get("offer_price"))
            if price is None:
                return field_errors({"offer_price": _MSG_NUMBER})
            if not (0 < price <= 100000):
                return field_errors(
                    {"offer_price": "ต้องมากกว่า 0 และไม่เกิน 100,000 บาทต่อตัน"}
                )
            if price != order.offer_price:
                cand = dataclasses.replace(
                    lot, order=dataclasses.replace(order, offer_price=price)
                )
        elif kind == "set_moisture":
            value = json_number(edit.get("moisture_pct"))
            if value is None or not (0 <= value <= 100):
                return field_errors(
                    {"moisture_pct": "ความชื้นต้องเป็นตัวเลขระหว่าง 0 ถึง 100 เปอร์เซ็นต์"}
                )
            current = lot.moisture_overrides.get(pid, by_id[pid].moisture_pct)
            if current is None or value != current:
                cand = dataclasses.replace(
                    lot, moisture_overrides={**lot.moisture_overrides, pid: value}
                )
        else:  # set_queue
            bale_id = edit.get("bale_slot_id")
            haul_id = edit.get("haul_slot_id")
            errors: dict[str, str] = {}
            bale = next((s for s in fx.bale_slots if s.slot_id == bale_id), None)
            haul = next((s for s in fx.haul_slots if s.slot_id == haul_id), None)
            if bale is None:
                errors["bale_slot_id"] = "ไม่ใช่ช่องคิวอัดฟ่อนที่ถูกต้อง"
            if haul is None:
                errors["haul_slot_id"] = "ไม่ใช่ช่องคิวขนส่งที่ถูกต้อง"
            if errors:
                return field_errors(errors)
            plots = [by_id[i] for i in lot.selected_plot_ids]
            if not plots:
                return field_errors({"bale_slot_id": "ยังไม่ได้เลือกแปลง จึงเลือกคิวไม่ได้"})
            violations = check_queue_pair(plots, order, bale, haul)
            if violations:
                return _errors_with(
                    {"bale_slot_id": violations[0].message_th},
                    violations=violations,
                    first_violation=violations[0],
                )
            cand = dataclasses.replace(lot, bale_slot_id=bale_id, haul_slot_id=haul_id)

        cand, dropped = _normalize(cand, fx)
        return _commit(session, lot, cand, dropped, _EDIT_FIELD[kind], fx)


# ------------------------------------------------------ submit and confirm


def _classify_queue(lot: Lot, fx: Fixtures, plots: list[Any]) -> tuple[dict[str, str], tuple[Any, ...]]:
    """Per-slot status for submit (8.3): {"bale": "missing"|"infeasible", ...}.

    Only failing slots appear. Plot-date violations (ready date, last clearing
    date) belong to the baling slot. Delivery-date and capacity violations
    belong to the slot they name.
    """
    bale = next((s for s in fx.bale_slots if s.slot_id == lot.bale_slot_id), None)
    haul = next((s for s in fx.haul_slots if s.slot_id == lot.haul_slot_id), None)
    failing: dict[str, str] = {}
    if bale is None:
        failing["bale"] = "missing"
    if haul is None:
        failing["haul"] = "missing"
    if bale is None or haul is None:
        # No selected pair. When propose_queue finds no feasible pair, report the
        # violations of its best failed pair (R8.3, R16.2) and name the slots by
        # the constraint they violate; "missing" stays only for slots with no
        # violation to report.
        if not plots:
            return failing, ()
        prop = propose_queue(plots, lot.order, fx.bale_slots, fx.haul_slots)
        if prop.assigned or not prop.violations:
            return failing, ()
        failing = {}
        violations = prop.violations
        bale = next((s for s in fx.bale_slots if s.slot_id == prop.best_failed_bale_slot_id), None)
        haul = next((s for s in fx.haul_slots if s.slot_id == prop.best_failed_haul_slot_id), None)
        if bale is None or haul is None:
            return {"bale": "missing", "haul": "missing"}, violations
    else:
        violations = check_queue_pair(plots, lot.order, bale, haul)
    for v in violations:
        if v.code in ("ready_date", "last_clearing_date"):
            failing["bale"] = "infeasible"
        elif v.subject_id == bale.slot_id:
            failing["bale"] = "infeasible"
        elif v.subject_id == haul.slot_id:
            failing["haul"] = "infeasible"
        else:
            failing.setdefault("haul", "infeasible")
    return failing, violations


def submit(session: Session, lot_id: Any, revision: Any) -> Result:
    """draft -> awaiting_confirmation with one pending Confirmation per party."""
    with session.lock:
        lot, err = check_write_preconditions(
            session, lot_id, revision, frozenset({Status.DRAFT})
        )
        if err is not None:
            return err
        assert lot is not None
        fx = _fixtures()
        by_id = {p.plot_id: p for p in fx.plots}
        plots = [by_id[i] for i in lot.selected_plot_ids]
        estimated = sum((p.expected_tons for p in plots), Decimal(0))
        order = lot.order

        if estimated < order.target_tons:  # 8.2
            shortfall = order.target_tons - estimated
            return _errors_with(
                {"estimated_tons": f"ขาด {format_tons(shortfall)} ตัน ส่งให้ยืนยันไม่ได้"},
                shortfall_tons=shortfall.quantize(_CENT),
            )

        failing, violations = _classify_queue(lot, fx, plots)  # 8.3
        if failing:
            names = {"bale": "คิวอัดฟ่อน", "haul": "คิวขนส่ง"}
            states = {"missing": "ยังไม่ได้เลือก", "infeasible": "ใช้ไม่ได้"}
            errors = {
                f"{kind}_slot_id": f"{names[kind]}{states[state]}"
                for kind, state in failing.items()
            }
            return _errors_with(
                errors,
                slots=failing,
                violations=violations,
                first_violation=violations[0] if violations else None,
            )

        # 8.4 / A14: Plant, one Farmer per distinct owner, the Contractor.
        plant_name = BUYERS[order.plant_id][0]
        parties = [Confirmation(order.plant_id, "plant", plant_name, False, None, None, None)]
        owners: dict[str, str] = {}
        for p in plots:
            owners.setdefault(p.owner_id, p.owner_name)
        for owner_id in sorted(owners):
            parties.append(
                Confirmation(owner_id, "farmer", owners[owner_id], False, None, None, None)
            )
        parties.append(
            Confirmation(CONTRACTOR_ID, "contractor", CONTRACTOR_NAME, False, None, None, None)
        )

        new = dataclasses.replace(
            lot,
            status=Status.AWAITING,
            confirmations=tuple(parties),
            revision=lot.revision + 1,
        )
        session.lots[lot.lot_id] = new  # single assignment commit
        return success(
            lot_body(
                new,
                session.start_date,
                confirmed_count=0,
                total=len(parties),
            )
        )


def _parse_day(raw: Any, start: date) -> int | None:
    """ISO date string -> day offset from the Session start, else None."""
    if not isinstance(raw, str) or not _DATE_RE.fullmatch(raw):
        return None
    try:
        return (date.fromisoformat(raw) - start).days
    except ValueError:
        return None


def confirm(
    session: Session,
    lot_id: Any,
    revision: Any,
    party_id: Any,
    bale_date: Any = None,
    haul_date: Any = None,
) -> Result:
    """Record one party's Confirmation (coordinator-entered, 9.1-9.9)."""
    with session.lock:
        # 404 lot, 409 revision, 409 status (incl. repeats on ready/closed).
        lot, err = check_write_preconditions(
            session, lot_id, revision, frozenset({Status.AWAITING})
        )
        if err is not None:
            return err
        assert lot is not None

        current = next(
            (c for c in lot.confirmations if c.party_id == party_id)
            if isinstance(party_id, str)
            else iter(()),
            None,
        )
        if current is None:  # 9.9
            return failure(404, "party_not_found", "ไม่พบผู้ยืนยันนี้ในล็อต")

        total = len(lot.confirmations)
        done = sum(1 for c in lot.confirmations if c.confirmed)
        if current.confirmed:  # 9.7: idempotent, original time kept
            return success(lot_body(lot, session.start_date, confirmed_count=done, total=total, changed=False))

        baling_day: int | None = None
        haul_day: int | None = None
        if current.role == "contractor":  # 9.2, 9.3
            fx = _fixtures()
            bale = next(s for s in fx.bale_slots if s.slot_id == lot.bale_slot_id)
            haul = next(s for s in fx.haul_slots if s.slot_id == lot.haul_slot_id)
            b = _parse_day(bale_date, session.start_date)
            h = _parse_day(haul_date, session.start_date)
            if b != bale.day or h != haul.day:
                errors: dict[str, str] = {}
                if b != bale.day:
                    errors["bale_date"] = "วันอัดฟ่อนไม่ตรงกับคิวที่เลือก ต้องแก้คิวก่อน"
                if h != haul.day:
                    errors["haul_date"] = "วันขนส่งไม่ตรงกับคิวที่เลือก ต้องแก้คิวก่อน"
                return field_errors(errors)
            baling_day, haul_day = b, h

        stamp = session.now().isoformat()
        confs = tuple(
            dataclasses.replace(
                c, confirmed=True, confirmed_at=stamp, baling_day=baling_day, haul_day=haul_day
            )
            if c.party_id == current.party_id
            else c
            for c in lot.confirmations
        )
        done += 1
        new = dataclasses.replace(
            lot,
            confirmations=confs,
            status=Status.READY if done == total else Status.AWAITING,  # 9.5
            revision=lot.revision + 1,
        )
        session.lots[lot.lot_id] = new  # single assignment commit
        return success(lot_body(new, session.start_date, confirmed_count=done, total=total, changed=True))


# ------------------------------------------------- weight and shortfall

MAX_ACTUAL_TONS = Decimal(100)  # A11
SHORTFALL_CHOICES = ("plant_accepts", "source_more")
_MSG_WEIGHT = "น้ำหนักต้องมากกว่า 0 และไม่เกิน 100 ตัน"


def _round_tons(value: Decimal) -> Decimal:
    """Round half-up to 2 decimals (A13)."""
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def record_weight(session: Session, lot_id: Any, revision: Any, actual_tons: Any) -> Result:
    """Store Actual_Tons in `ready`. Close at or above target, else pend a decision."""
    with session.lock:
        lot, err = check_write_preconditions(
            session, lot_id, revision, frozenset({Status.READY})
        )
        if err is not None:
            return err
        assert lot is not None

        raw = json_number(actual_tons)  # 11.3: finite JSON numbers only
        if raw is None or not (0 < raw <= MAX_ACTUAL_TONS):
            return field_errors({"actual_tons": _MSG_WEIGHT})
        value = _round_tons(raw)
        if value <= 0:  # e.g. 0.004 rounds to 0.00
            return field_errors({"actual_tons": _MSG_WEIGHT})

        target = lot.order.target_tons
        if value >= target:
            new = dataclasses.replace(
                lot,
                actual_tons=value,
                shortfall=None,  # 12.2: clear any pending decision
                status=Status.CLOSED,
                revision=lot.revision + 1,
            )
        else:
            new = dataclasses.replace(
                lot,
                actual_tons=value,
                shortfall=ShortfallDecision(
                    shortfall_tons=_round_tons(target - value),
                    state="pending",
                    resolution=None,
                    remaining_to_source_tons=None,
                ),
                revision=lot.revision + 1,
            )
        session.lots[lot.lot_id] = new  # single assignment commit
        return success(lot_body(new, session.start_date, changed=True))


def decide_shortfall(session: Session, lot_id: Any, revision: Any, choice: Any) -> Result:
    """Resolve a pending shortfall decision and close the Lot (12.4-12.6)."""
    with session.lock:
        lot, err = check_write_preconditions(
            session, lot_id, revision, frozenset({Status.READY})
        )
        if err is not None:
            return err
        assert lot is not None
        pending = lot.shortfall
        if pending is None or pending.state != "pending":  # 12.6
            return failure(409, "no_pending_decision", "ไม่มีเรื่องปริมาณขาดที่รอตัดสินใจ")
        if choice not in SHORTFALL_CHOICES:
            return field_errors({"choice": "เลือก «โรงงานรับตามจริง» หรือ «ต้องหาเพิ่ม»"})

        remaining = Decimal("0.00") if choice == "plant_accepts" else pending.shortfall_tons
        new = dataclasses.replace(
            lot,
            status=Status.CLOSED,
            shortfall=ShortfallDecision(
                shortfall_tons=pending.shortfall_tons,
                state="resolved",
                resolution=choice,
                remaining_to_source_tons=remaining,
            ),
            revision=lot.revision + 1,
        )
        session.lots[lot.lot_id] = new  # single assignment commit
        return success(lot_body(new, session.start_date, changed=True))
