# Feature: straw-lot-planning-demo, Property 12: Lifecycle invariants hold across arbitrary operation sequences
"""Stateful lifecycle test: arbitrary operation sequences against one Session.

**Validates: Requirements 8.1, 8.2, 8.3, 8.5, 9.1, 9.4, 9.5, 9.6, 10.1, 10.3,
10.4, 11.2, 12.2, 13.3, 13.5**
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from hypothesis import settings, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, precondition, rule

import lot_service
from lot_planning import build_view, default_fixtures
from lot_state import Lot, Status

from .conftest import FAKE_CLOCK_START, FakeClock

PLOT_IDS = st.sampled_from(["P001", "P002", "P003", "P004", "P005", "P006", "P007", "P008", "PXX"])
SLOT_IDS = st.sampled_from(["S001", "S002", "S003", "S004", "S005", "S006", "SXX"])
PRICES = st.sampled_from([0, -1, 1, 900, 1500, 1800, 100000, 100001, "x", None, True])
MOISTURES = st.sampled_from([-5, 0, 5, 12, 18.5, 25, 35, 100, 101, "x", None])
WEIGHTS = st.sampled_from([0, -1, 0.004, 5, 9.99, 10, 10.4, 12, 100, 101, "a", None, True])
CHOICES = st.sampled_from(["plant_accepts", "source_more", "bogus", None])
TARGETS = st.sampled_from([10] * 12 + [1, 5, 15, 20, 50, 0, 101, "x"])
INDEX = st.sampled_from([0] * 6 + [1, 2])
STALE = st.sampled_from([False, False, False, False, True])
DELTA = st.sampled_from([-1, 1, 5])

FX = default_fixtures()

# Allowed status moves per operation (design: draft->awaiting->ready->closed,
# or back to awaiting/draft through edits).
ALLOWED_MOVES = {
    "propose": {(Status.DRAFT, Status.DRAFT), (Status.DRAFT, Status.AWAITING)},
    "edit": {
        (Status.DRAFT, Status.DRAFT),
        (Status.AWAITING, Status.AWAITING),
        (Status.AWAITING, Status.DRAFT),
        (Status.READY, Status.READY),
        (Status.READY, Status.AWAITING),
        (Status.READY, Status.DRAFT),
    },
    "submit": {(Status.DRAFT, Status.AWAITING)},
    "confirm": {(Status.AWAITING, Status.AWAITING), (Status.AWAITING, Status.READY)},
    "weight": {(Status.READY, Status.READY), (Status.READY, Status.CLOSED)},
    "decide": {(Status.READY, Status.CLOSED)},
}


class LifecycleMachine(RuleBasedStateMachine):
    def __init__(self) -> None:
        super().__init__()
        self.clock = FakeClock()
        self.session = lot_service.Session("test-session", FAKE_CLOCK_START, self.clock)
        self.lot_ids: list[str] = []
        self.last: dict[str, dict[str, Any]] = {}  # last response lot per lot id
        self.max_rev: dict[str, int] = {}

    # ------------------------------------------------------------ helpers

    def _lot(self, idx: int) -> str:
        return self.lot_ids[idx % len(self.lot_ids)]

    def _stored(self, lot_id: str) -> Lot:
        return self.session.lots[lot_id]

    def _write(self, kind: str, idx: int, stale: bool, call) -> tuple[Any, Lot, Lot]:
        """Run one write with the current (or a stale) revision and check the step."""
        lot_id = self._lot(idx)
        pre = self._stored(lot_id)
        revision = pre.revision + (-1 if stale else 0)
        res = call(lot_id, revision)
        post = self._stored(lot_id)

        if stale:
            assert not res.ok and res.http_status == 409, res
            assert res.body["code"] == "revision_conflict"
        if pre.status is Status.CLOSED:  # terminal: every write is 409 (13.5)
            assert not res.ok and res.http_status == 409, (kind, res)

        changed = post != pre
        if not res.ok:
            assert not changed, (kind, res.body)  # rejected: no state change
        elif res.body.get("changed", True) is False:
            assert not changed, (kind, res.body)  # accepted no-op
        else:
            assert changed, (kind, res.body)
        # revision: +1 per accepted change, 0 otherwise, never decreases
        assert post.revision == pre.revision + (1 if changed else 0), (kind, pre.revision, post.revision)

        assert (pre.status, post.status) in {(s, s) for s in Status} | ALLOWED_MOVES[kind], (
            kind, pre.status, post.status)
        if post.actual_tons != pre.actual_tons:
            assert pre.status is Status.READY  # weight only recorded in ready (11.2)
        if res.ok and "lot" in res.body:
            self.last[lot_id] = res.body["lot"]
        return res, pre, post

    # -------------------------------------------------------------- rules

    @precondition(lambda self: len(self.lot_ids) < 3)
    @rule(
        tons=TARGETS,
        offer=st.sampled_from([1500] * 8 + [1800, 0]),
        days=st.sampled_from([4] * 8 + [2, 3, 5, 6, 8, -1]),
        plant=st.sampled_from(["B01"] * 8 + ["B02", "B03", "B04", "ZZZ"]),
    )
    def create_order(self, tons, offer, days, plant) -> None:
        before = len(self.session.lots)
        delivery = (self.session.start_date + timedelta(days=days)).isoformat()
        res = lot_service.create_order(
            self.session,
            {
                "plant_id": plant,
                "material": "ฟางข้าว",
                "target_tons": tons,
                "offer_price": offer,
                "max_moisture_pct": 20,
                "delivery_date": delivery,
            },
        )
        if res.ok:
            lot = res.body["lot"]
            assert res.http_status == 201 and lot["status"] == "draft" and lot["revision"] == 0
            assert len(self.session.lots) == before + 1
            self.lot_ids.append(lot["lot_id"])
            self.last[lot["lot_id"]] = lot
        else:
            assert len(self.session.lots) == before

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE)
    def propose(self, idx, stale) -> None:
        self._write("propose", idx, stale, lambda l, r: lot_service.propose(self.session, l, r))

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, plot=PLOT_IDS)
    def add_plot(self, idx, stale, plot) -> None:
        self._edit(idx, stale, {"type": "add_plot", "plot_id": plot})

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, plot=PLOT_IDS)
    def remove_plot(self, idx, stale, plot) -> None:
        self._edit(idx, stale, {"type": "remove_plot", "plot_id": plot})

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, price=PRICES)
    def set_price(self, idx, stale, price) -> None:
        self._edit(idx, stale, {"type": "set_price", "offer_price": price})

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, plot=PLOT_IDS, value=MOISTURES)
    def set_moisture(self, idx, stale, plot, value) -> None:
        self._edit(idx, stale, {"type": "set_moisture", "plot_id": plot, "moisture_pct": value})

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, bale=SLOT_IDS, haul=SLOT_IDS)
    def set_queue(self, idx, stale, bale, haul) -> None:
        self._edit(idx, stale, {"type": "set_queue", "bale_slot_id": bale, "haul_slot_id": haul})

    def _edit(self, idx: int, stale: bool, edit: dict[str, Any]) -> None:
        self._write("edit", idx, stale, lambda l, r: lot_service.apply_edit(self.session, l, r, edit))

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE)
    def submit(self, idx, stale) -> None:
        res, pre, post = self._write(
            "submit", idx, stale, lambda l, r: lot_service.submit(self.session, l, r)
        )
        if res.ok:  # 8.1: one pending Confirmation per party
            assert pre.status is Status.DRAFT and post.status is Status.AWAITING
            assert post.confirmations and not any(c.confirmed for c in post.confirmations)

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, pick=INDEX, mode=st.sampled_from(["valid", "valid", "bad_date", "bad_party"]))
    def confirm(self, idx, stale, pick, mode) -> None:
        lot_id = self._lot(idx)
        stored = self._stored(lot_id)
        view = lot_service.get_lot(self.session, lot_id).body["lot"]
        confs = stored.confirmations
        if confs:
            party = confs[pick % len(confs)]
            party_id = party.party_id
            is_contractor = party.role == "contractor"
        else:
            party_id, is_contractor = "F01", False
        bale_date, haul_date = view["bale_date"], view["haul_date"]
        if mode == "bad_party":
            party_id = "NOPE"
        elif mode == "bad_date" and is_contractor:
            bale_date, haul_date = "2000-01-01", None
        elif mode == "bad_date":
            bale_date = "garbage"  # ignored for non-contractors
        res, pre, post = self._write(
            "confirm",
            idx,
            stale,
            lambda l, r: lot_service.confirm(self.session, l, r, party_id, bale_date, haul_date),
        )
        if res.ok and res.body.get("changed"):
            assert sum(c.confirmed for c in post.confirmations) == sum(
                c.confirmed for c in pre.confirmations
            ) + 1
        if mode == "bad_party" and pre.status is Status.AWAITING and not stale:
            assert not res.ok
        if mode == "bad_date" and is_contractor and pre.status is Status.AWAITING and not stale:
            assert not res.ok and res.http_status == 422

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX)
    def confirm_next(self, idx) -> None:
        """Valid confirmation of the first pending party (drives lots toward ready)."""
        lot_id = self._lot(idx)
        stored = self._stored(lot_id)
        view = lot_service.get_lot(self.session, lot_id).body["lot"]
        pending = [c for c in stored.confirmations if not c.confirmed]
        if not pending:
            return
        c = pending[0]
        dates = (view["bale_date"], view["haul_date"]) if c.role == "contractor" else (None, None)
        res, pre, post = self._write(
            "confirm",
            idx,
            False,
            lambda l, r: lot_service.confirm(self.session, l, r, c.party_id, *dates),
        )
        if pre.status is Status.AWAITING:
            assert res.ok and res.body["changed"] is True, res.body

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, tons=st.sampled_from([5, 5, 9.99, 10.4]), choice=st.sampled_from(["plant_accepts", "source_more"]))
    def advance(self, idx, tons, choice) -> None:
        """One sensible, valid step toward closing (keeps sequences deep enough)."""
        stored = self._stored(self._lot(idx))
        if stored.status is Status.DRAFT:
            if stored.selected_plot_ids and stored.bale_slot_id:
                self._write("submit", idx, False, lambda l, r: lot_service.submit(self.session, l, r))
            else:
                self._write("propose", idx, False, lambda l, r: lot_service.propose(self.session, l, r))
        elif stored.status is Status.AWAITING:
            self.confirm_next(idx)
        elif stored.status is Status.READY:
            if stored.shortfall is not None:
                self._write("decide", idx, False, lambda l, r: lot_service.decide_shortfall(self.session, l, r, choice))
            else:
                self._write("weight", idx, False, lambda l, r: lot_service.record_weight(self.session, l, r, tons))

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX)
    def fast_forward(self, idx) -> None:
        """Run valid steps until the lot is ready (or no step applies)."""
        for _ in range(10):
            if self._stored(self._lot(idx)).status in (Status.READY, Status.CLOSED):
                break
            self.advance(idx, 10, "plant_accepts")

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, tons=st.sampled_from([5, 5, 9.99, 10.4]), choice=st.sampled_from(["plant_accepts", "source_more"]))
    def advance_again(self, idx, tons, choice) -> None:
        self.advance(idx, tons, choice)

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, tons=st.sampled_from([5, 5, 9.99, 10.4]), choice=st.sampled_from(["plant_accepts", "source_more"]))
    def advance_more(self, idx, tons, choice) -> None:
        self.advance(idx, tons, choice)

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, tons=WEIGHTS)
    def record_weight(self, idx, stale, tons) -> None:
        res, pre, post = self._write(
            "weight", idx, stale, lambda l, r: lot_service.record_weight(self.session, l, r, tons)
        )
        if res.ok:
            assert pre.status is Status.READY and post.actual_tons is not None
            if post.actual_tons >= post.order.target_tons:
                assert post.status is Status.CLOSED and post.shortfall is None
            else:
                assert post.status is Status.READY and post.shortfall.state == "pending"

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX, stale=STALE, choice=CHOICES)
    def decide_shortfall(self, idx, stale, choice) -> None:
        res, pre, post = self._write(
            "decide", idx, stale, lambda l, r: lot_service.decide_shortfall(self.session, l, r, choice)
        )
        if res.ok:
            assert pre.shortfall is not None and pre.shortfall.state == "pending"
            assert post.status is Status.CLOSED and post.shortfall.state == "resolved"

    @precondition(lambda self: self.lot_ids)
    @rule(idx=INDEX)
    def get_lot(self, idx) -> None:
        lot_id = self._lot(idx)
        before = self._stored(lot_id)
        res = lot_service.get_lot(self.session, lot_id)
        assert res.ok and res.http_status == 200  # reads work in every status
        assert self._stored(lot_id) == before
        self.last[lot_id] = res.body["lot"]

    # ---------------------------------------------------------- invariants

    @invariant()
    def lot_invariants(self) -> None:
        for lot_id in self.lot_ids:
            lot = self._stored(lot_id)
            confs = lot.confirmations
            done = sum(c.confirmed for c in confs)

            # revision never decreases
            assert lot.revision >= self.max_rev.get(lot_id, 0)
            self.max_rev[lot_id] = lot.revision

            if lot.status is Status.DRAFT:
                assert done == 0
            elif lot.status is Status.AWAITING:
                assert confs and done < len(confs)
            elif lot.status in (Status.READY, Status.CLOSED):
                assert confs and done == len(confs)

            if lot.status in (Status.AWAITING, Status.READY):
                view = build_view(lot, FX)
                assert view.shortfall_tons == 0 and view.queue_assigned and not view.violations

            if lot.shortfall is not None and lot.shortfall.state == "pending":
                assert lot.status is Status.READY
                assert lot.actual_tons is not None and lot.actual_tons < lot.order.target_tons
            if lot.actual_tons is not None:
                assert lot.status in (Status.READY, Status.CLOSED)
            if lot.status is Status.READY:
                assert lot.actual_tons is None or (
                    lot.shortfall is not None and lot.shortfall.state == "pending"
                )
            if lot.status is Status.CLOSED:
                assert lot.actual_tons is not None
                assert lot.actual_tons >= lot.order.target_tons or (
                    lot.shortfall is not None and lot.shortfall.state == "resolved"
                )

            # reload equals the last response; counts are real
            reloaded = lot_service.get_lot(self.session, lot_id)
            assert reloaded.ok
            assert reloaded.body["lot"] == self.last[lot_id]
            assert reloaded.body["lot"]["confirmed_count"] == done
            assert reloaded.body["lot"]["confirmation_total"] == len(confs)


LifecycleMachine.TestCase.settings = settings(
    max_examples=100, stateful_step_count=30, deadline=None
)
TestLifecycleInvariants = LifecycleMachine.TestCase
