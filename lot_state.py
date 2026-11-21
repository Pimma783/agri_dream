"""Immutable state model and JSON snapshot for the straw lot planning demo.

Pure module: no I/O, no clock. Tons, distances, prices and moisture are
`Decimal`. Days are integer offsets from the Session start date.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import StrEnum
from typing import Any, Mapping


class Status(StrEnum):
    DRAFT = "draft"
    AWAITING = "awaiting_confirmation"
    READY = "ready"
    CLOSED = "closed"

    @property
    def label_th(self) -> str:
        return STATUS_LABELS_TH[self.value]


STATUS_LABELS_TH = {
    "draft": "ร่าง",
    "awaiting_confirmation": "รอยืนยัน",
    "ready": "พร้อมดำเนินงาน",
    "closed": "ปิดล็อต",
}


@dataclass(frozen=True)
class Plot:
    plot_id: str
    owner_id: str
    owner_name: str
    material: str
    expected_tons: Decimal
    distance_km_by_plant: Mapping[str, Decimal]
    ready_day: int
    last_clear_day: int
    moisture_pct: Decimal | None


@dataclass(frozen=True)
class Slot:
    slot_id: str
    kind: str  # "bale" | "haul"
    day: int
    capacity_tons: Decimal
    booked_tons: Decimal

    @property
    def remaining_tons(self) -> Decimal:
        return self.capacity_tons - self.booked_tons


@dataclass(frozen=True)
class Order:
    order_id: str
    plant_id: str
    material: str
    target_tons: Decimal
    offer_price: Decimal
    max_moisture_pct: Decimal
    delivery_day: int


@dataclass(frozen=True)
class Confirmation:
    party_id: str
    role: str  # "plant" | "farmer" | "contractor"
    name: str
    confirmed: bool
    confirmed_at: str | None
    baling_day: int | None
    haul_day: int | None


@dataclass(frozen=True)
class ShortfallDecision:
    shortfall_tons: Decimal
    state: str  # "pending" | "resolved"
    resolution: str | None  # "plant_accepts" | "source_more"
    remaining_to_source_tons: Decimal | None


@dataclass(frozen=True)
class Lot:
    lot_id: str
    order: Order
    status: Status
    revision: int
    selected_plot_ids: tuple[str, ...] = ()
    bale_slot_id: str | None = None
    haul_slot_id: str | None = None
    moisture_overrides: Mapping[str, Decimal] = field(default_factory=dict)
    confirmations: tuple[Confirmation, ...] = ()
    actual_tons: Decimal | None = None
    shortfall: ShortfallDecision | None = None


# ------------------------------------------------------------- formatting


def format_tons(value: Decimal | int | str) -> str:
    """At most 2 decimals, no trailing zeros: 10.40 -> '10.4', 12.00 -> '12'."""
    d = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    text = format(d, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


# ---------------------------------------------------------- serialization


def _dec(d: Decimal | None) -> str | None:
    return None if d is None else str(d)


def lot_to_json(lot: Lot) -> str:
    """Serialize a Lot. Decimals are strings, keys are sorted."""
    o = lot.order
    data: dict[str, Any] = {
        "lot_id": lot.lot_id,
        "order": {
            "order_id": o.order_id,
            "plant_id": o.plant_id,
            "material": o.material,
            "target_tons": _dec(o.target_tons),
            "offer_price": _dec(o.offer_price),
            "max_moisture_pct": _dec(o.max_moisture_pct),
            "delivery_day": o.delivery_day,
        },
        "status": lot.status.value,
        "revision": lot.revision,
        "selected_plot_ids": list(lot.selected_plot_ids),
        "bale_slot_id": lot.bale_slot_id,
        "haul_slot_id": lot.haul_slot_id,
        "moisture_overrides": {k: _dec(v) for k, v in lot.moisture_overrides.items()},
        "confirmations": [
            {
                "party_id": c.party_id,
                "role": c.role,
                "name": c.name,
                "confirmed": c.confirmed,
                "confirmed_at": c.confirmed_at,
                "baling_day": c.baling_day,
                "haul_day": c.haul_day,
            }
            for c in lot.confirmations
        ],
        "actual_tons": _dec(lot.actual_tons),
        "shortfall": None
        if lot.shortfall is None
        else {
            "shortfall_tons": _dec(lot.shortfall.shortfall_tons),
            "state": lot.shortfall.state,
            "resolution": lot.shortfall.resolution,
            "remaining_to_source_tons": _dec(lot.shortfall.remaining_to_source_tons),
        },
    }
    return json.dumps(data, sort_keys=True, ensure_ascii=False)


def _bad(msg: str) -> ValueError:
    return ValueError(f"malformed lot JSON: {msg}")


def _str(d: Any, key: str, optional: bool = False) -> str | None:
    v = d.get(key) if isinstance(d, dict) else None
    if v is None and optional and isinstance(d, dict) and key in d:
        return None
    if not isinstance(v, str):
        raise _bad(f"{key} must be a string")
    return v


def _int(d: Any, key: str, optional: bool = False) -> int | None:
    v = d.get(key) if isinstance(d, dict) else None
    if v is None and optional and isinstance(d, dict) and key in d:
        return None
    if not isinstance(v, int) or isinstance(v, bool):
        raise _bad(f"{key} must be an integer")
    return v


def _bool(d: Any, key: str) -> bool:
    v = d.get(key) if isinstance(d, dict) else None
    if not isinstance(v, bool):
        raise _bad(f"{key} must be a boolean")
    return v


def _to_dec(v: Any, key: str) -> Decimal:
    if not isinstance(v, str):
        raise _bad(f"{key} must be a decimal string")
    try:
        d = Decimal(v)
    except InvalidOperation:
        raise _bad(f"{key} is not a decimal") from None
    if not d.is_finite():
        raise _bad(f"{key} must be finite")
    return d


def _decf(d: Any, key: str, optional: bool = False) -> Decimal | None:
    if not isinstance(d, dict) or key not in d:
        raise _bad(f"{key} missing")
    if d[key] is None and optional:
        return None
    return _to_dec(d[key], key)


def lot_from_json(text: str) -> Lot:
    """Restore a Lot. Raises ValueError on any malformed input."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise _bad("not valid JSON") from exc
    if not isinstance(data, dict):
        raise _bad("top level must be an object")
    try:
        od = data.get("order")
        if not isinstance(od, dict):
            raise _bad("order must be an object")
        order = Order(
            order_id=_str(od, "order_id"),
            plant_id=_str(od, "plant_id"),
            material=_str(od, "material"),
            target_tons=_decf(od, "target_tons"),
            offer_price=_decf(od, "offer_price"),
            max_moisture_pct=_decf(od, "max_moisture_pct"),
            delivery_day=_int(od, "delivery_day"),
        )
        try:
            status = Status(data.get("status"))
        except ValueError:
            raise _bad("unknown status") from None

        plot_ids = data.get("selected_plot_ids")
        if not isinstance(plot_ids, list) or not all(isinstance(p, str) for p in plot_ids):
            raise _bad("selected_plot_ids must be a list of strings")

        mo = data.get("moisture_overrides")
        if not isinstance(mo, dict):
            raise _bad("moisture_overrides must be an object")
        overrides = {str(k): _to_dec(v, "moisture_overrides") for k, v in mo.items()}

        raw_conf = data.get("confirmations")
        if not isinstance(raw_conf, list):
            raise _bad("confirmations must be a list")
        confs = []
        for c in raw_conf:
            if not isinstance(c, dict):
                raise _bad("confirmation must be an object")
            confs.append(
                Confirmation(
                    party_id=_str(c, "party_id"),
                    role=_str(c, "role"),
                    name=_str(c, "name"),
                    confirmed=_bool(c, "confirmed"),
                    confirmed_at=_str(c, "confirmed_at", optional=True),
                    baling_day=_int(c, "baling_day", optional=True),
                    haul_day=_int(c, "haul_day", optional=True),
                )
            )

        sd = data.get("shortfall")
        shortfall = None
        if sd is not None:
            if not isinstance(sd, dict):
                raise _bad("shortfall must be an object or null")
            shortfall = ShortfallDecision(
                shortfall_tons=_decf(sd, "shortfall_tons"),
                state=_str(sd, "state"),
                resolution=_str(sd, "resolution", optional=True),
                remaining_to_source_tons=_decf(sd, "remaining_to_source_tons", optional=True),
            )

        return Lot(
            lot_id=_str(data, "lot_id"),
            order=order,
            status=status,
            revision=_int(data, "revision"),
            selected_plot_ids=tuple(plot_ids),
            bale_slot_id=_str(data, "bale_slot_id", optional=True),
            haul_slot_id=_str(data, "haul_slot_id", optional=True),
            moisture_overrides=overrides,
            confirmations=tuple(confs),
            actual_tons=_decf(data, "actual_tons", optional=True),
            shortfall=shortfall,
        )
    except (TypeError, AttributeError) as exc:
        raise _bad(str(exc)) from exc
