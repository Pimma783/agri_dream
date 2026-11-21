# Feature: straw-lot-planning-demo, Property 9: A rejected write leaves the Lot unchanged
"""Property 9: a rejected write leaves the Lot unchanged.

For Lots in every status, any write that returns a non-2xx result leaves
`lot_to_json(lot)` (revision and Confirmations included) identical, and
`get_lot` still returns data for a closed Lot.

**Validates: Requirements 4.11, 7.2, 7.6, 7.8, 7.9, 9.9, 10.6, 13.6**
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from lot_fixtures import CONTRACTOR_ID, EXCLUDED_PLOT_IDS
from lot_planning import default_fixtures
from lot_service import (
    SessionStore,
    apply_edit,
    confirm,
    create_order,
    decide_shortfall,
    get_lot,
    propose,
    record_weight,
    submit,
)
from lot_state import Status, lot_to_json

SETTINGS = settings(max_examples=100, deadline=None)

_START = datetime(2025, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
_FX = default_fixtures()
_SLOTS = {s.slot_id: s for s in (*_FX.bale_slots, *_FX.haul_slots)}
_PLOT_IDS = [p.plot_id for p in _FX.plots]
_EXCLUDED = sorted(EXCLUDED_PLOT_IDS.values())
_BALE_IDS = [s.slot_id for s in _FX.bale_slots]
_HAUL_IDS = [s.slot_id for s in _FX.haul_slots]

STATES = (
    "draft",
    "draft_planned",
    "awaiting",
    "ready",
    "ready_pending",
    "closed",
    "closed_decided",
)


# ---------------------------------------------------------------- helpers


def _new_session():
    store = SessionStore(lambda: _START)
    session, _ = store.resolve(None)
    return session


def _lot(session, lot_id):
    with session.lock:
        return session.lots[lot_id]


def _snap(session, lot_id) -> str:
    return lot_to_json(_lot(session, lot_id))


def _make_lot(session, state: str, confirmed_first: int):
    """Drive the real service to put one Lot in the requested state."""
    delivery = (session.start_date + timedelta(days=4)).isoformat()
    res = create_order(
        session,
        {
            "plant_id": "B01",
            "material": "ฟางข้าว",
            "target_tons": 10,
            "offer_price": 1500,
            "max_moisture_pct": 20,
            "delivery_date": delivery,
        },
    )
    assert res.ok, res.body
    lid = res.body["lot"]["lot_id"]
    if state == "draft":
        return lid

    def step(res):
        assert res.ok, res.body

    step(propose(session, lid, _lot(session, lid).revision))
    if state == "draft_planned":
        return lid
    step(submit(session, lid, _lot(session, lid).revision))
    if state == "awaiting":
        others = [
            c.party_id for c in _lot(session, lid).confirmations if c.role != "contractor"
        ]
        for pid in others[:confirmed_first]:
            step(confirm(session, lid, _lot(session, lid).revision, pid))
        return lid
    for c in _lot(session, lid).confirmations:
        lot = _lot(session, lid)
        kw = {}
        if c.role == "contractor":
            kw = {
                "bale_date": (session.start_date + timedelta(days=_SLOTS[lot.bale_slot_id].day)).isoformat(),
                "haul_date": (session.start_date + timedelta(days=_SLOTS[lot.haul_slot_id].day)).isoformat(),
            }
        step(confirm(session, lid, lot.revision, c.party_id, **kw))
    assert _lot(session, lid).status is Status.READY
    if state == "ready":
        return lid
    if state in ("ready_pending", "closed_decided"):
        step(record_weight(session, lid, _lot(session, lid).revision, 5))
        if state == "closed_decided":
            step(decide_shortfall(session, lid, _lot(session, lid).revision, "plant_accepts"))
        return lid
    step(record_weight(session, lid, _lot(session, lid).revision, 10))
    return lid


def _status_of(state: str) -> Status:
    return {
        "draft": Status.DRAFT,
        "draft_planned": Status.DRAFT,
        "awaiting": Status.AWAITING,
        "ready": Status.READY,
        "ready_pending": Status.READY,
        "closed": Status.CLOSED,
        "closed_decided": Status.CLOSED,
    }[state]


# -------------------------------------------------------------- operations

_STALE = [1, 2, 3, 5, 99, -1, -2]
_BAD_REV = ["1", None, 1.5, True, [], {}]
_BAD_PRICE = [0, -5, 100001, "a", None, True, float("nan"), float("inf"), [], 1e12]
_BAD_MOISTURE = [-1, -0.01, 100.01, 101, "x", None, True, float("nan"), float("-inf"), {}]
_BAD_WEIGHT = [0, -1, 100.01, 101, "x", None, True, float("nan"), 0.004, []]


def _writer_call(session, lid, rev, writer: str):
    if writer == "propose":
        return propose(session, lid, rev)
    if writer == "submit":
        return submit(session, lid, rev)
    if writer == "confirm":
        return confirm(session, lid, rev, "B01")
    if writer == "weight":
        return record_weight(session, lid, rev, 10)
    if writer == "decide":
        return decide_shortfall(session, lid, rev, "plant_accepts")
    if writer == "add_plot":
        return apply_edit(session, lid, rev, {"type": "add_plot", "plot_id": "P004"})
    if writer == "remove_plot":
        return apply_edit(session, lid, rev, {"type": "remove_plot", "plot_id": "P001"})
    if writer == "set_price":
        return apply_edit(session, lid, rev, {"type": "set_price", "offer_price": 1700})
    raise AssertionError(writer)


_WRITERS = (
    "propose",
    "submit",
    "confirm",
    "weight",
    "decide",
    "add_plot",
    "remove_plot",
    "set_price",
)


def _value_ops(state: str) -> list[str]:
    """Value-validation rejections; reachable where edits pass the status gate."""
    if _status_of(state) is Status.CLOSED or state == "ready_pending":
        return []
    return [
        "excluded_plot",
        "unknown_plot",
        "bad_edit_type",
        "bad_moisture",
        "bad_price",
        "unknown_slot",
        "infeasible_queue",
    ]


def _status_ops(state: str) -> list[str]:
    st_ = _status_of(state)
    ops = ["stale", "bad_rev_type", "unknown_lot"]
    if st_ is Status.CLOSED or state == "ready_pending":
        ops += ["edit_blocked"]
    if st_ is not Status.DRAFT:
        ops += ["wrong_propose", "wrong_submit"]
    if st_ is not Status.AWAITING:
        ops += ["wrong_confirm"]
    if st_ is not Status.READY:
        ops += ["wrong_weight", "wrong_decide"]
    if st_ is Status.AWAITING:
        ops += ["unknown_party", "contractor_date_mismatch"]
    if st_ is Status.READY:
        ops += ["bad_weight"]
    if state == "ready":
        ops += ["decide_without_pending"]
    if state == "ready_pending":
        ops += ["bad_choice", "bad_weight_pending"]
    if state == "draft":
        ops += ["draft_submit_shortfall"]
    return ops


def _run(session, lid: str, state: str, op: str, d: dict):
    """Return (Result, allowed_http_statuses)."""
    lot = _lot(session, lid)
    rev = lot.revision
    if op == "stale":
        return _writer_call(session, lid, rev + d["stale_rev"], d["writer"]), {409}
    if op == "bad_rev_type":
        return _writer_call(session, lid, d["bad_rev"], d["writer"]), {422}
    if op == "unknown_lot":
        return _writer_call(session, d["unknown_id"], rev, d["writer"]), {404}
    if op == "edit_blocked":
        # Closed Lot, or a Lot with a pending shortfall decision (D3).
        return apply_edit(session, lid, rev, {"type": "set_price", "offer_price": 1700}), {409}
    if op == "wrong_propose":
        return propose(session, lid, rev), {409}
    if op == "wrong_submit":
        return submit(session, lid, rev), {409}
    if op == "wrong_confirm":
        return confirm(session, lid, rev, "B01"), {409}
    if op == "wrong_weight":
        return record_weight(session, lid, rev, 10), {409}
    if op == "wrong_decide":
        return decide_shortfall(session, lid, rev, "plant_accepts"), {409}
    if op == "draft_submit_shortfall":
        return submit(session, lid, rev), {422}
    if op == "unknown_party":
        return confirm(session, lid, rev, d["party"]), {404}
    if op == "contractor_date_mismatch":
        good_b = (session.start_date + timedelta(days=_SLOTS[lot.bale_slot_id].day)).isoformat()
        good_h = (session.start_date + timedelta(days=_SLOTS[lot.haul_slot_id].day)).isoformat()
        bale, haul = d["bale_date"], d["haul_date"]
        if bale == good_b and haul == good_h:
            bale = "2099-01-01"
        return confirm(session, lid, rev, CONTRACTOR_ID, bale, haul), {422}
    if op == "bad_weight":
        return record_weight(session, lid, rev, d["bad_weight"]), {422}
    if op == "bad_weight_pending":
        return record_weight(session, lid, rev, d["bad_weight"]), {422}
    if op == "decide_without_pending":
        return decide_shortfall(session, lid, rev, d["choice"]), {409}
    if op == "bad_choice":
        return decide_shortfall(session, lid, rev, d["bad_choice"]), {422}
    # value ops
    if op == "excluded_plot":
        return apply_edit(session, lid, rev, {"type": "add_plot", "plot_id": d["excluded"]}), {422}
    if op == "unknown_plot":
        return apply_edit(session, lid, rev, {"type": d["plot_edit"], "plot_id": "P999"}), {422}
    if op == "bad_edit_type":
        return apply_edit(session, lid, rev, {"type": d["bad_type"]}), {422}
    if op == "bad_moisture":
        return apply_edit(session, lid, rev, {"type": "set_moisture", "plot_id": d["plot"], "moisture_pct": d["bad_moisture"]}), {422}
    if op == "bad_price":
        return apply_edit(session, lid, rev, {"type": "set_price", "offer_price": d["bad_price"]}), {422}
    if op == "unknown_slot":
        return apply_edit(session, lid, rev, {"type": "set_queue", "bale_slot_id": d["bad_slot"], "haul_slot_id": d["haul"]}), {422}
    if op == "infeasible_queue":
        # S002 (10 t free) and S005 (7 t free) cannot take the 12 t selection;
        # a Lot without Plots rejects any queue edit.
        return apply_edit(session, lid, rev, {"type": "set_queue", "bale_slot_id": "S002", "haul_slot_id": d["haul"]}), {422}
    raise AssertionError(op)


@st.composite
def _cases(draw):
    state = draw(st.sampled_from(STATES))
    op = draw(st.sampled_from(_status_ops(state) + _value_ops(state)))
    d = {
        "writer": draw(st.sampled_from(_WRITERS)),
        "stale_rev": draw(st.sampled_from(_STALE)),
        "bad_rev": draw(st.sampled_from(_BAD_REV)),
        "unknown_id": draw(st.sampled_from(["L999", "", "x", "L000", 5, None])),
        "party": draw(st.sampled_from(["Z99", "", "F99", None, 7])),
        "bale_date": draw(st.sampled_from(["", "2025-01-01", "2025-02-30", "bad", None, 3, "2025-01-03", "2025-01-05"])),
        "haul_date": draw(st.sampled_from(["", "2025-01-01", "2025-02-30", "bad", None, 3, "2025-01-05", "2025-01-06"])),
        "bad_weight": draw(st.sampled_from(_BAD_WEIGHT)),
        "choice": draw(st.sampled_from(["plant_accepts", "source_more", "x"])),
        "bad_choice": draw(st.sampled_from(["", "x", None, 3, "PLANT_ACCEPTS"])),
        "excluded": draw(st.sampled_from(_EXCLUDED)),
        "plot": draw(st.sampled_from(_PLOT_IDS)),
        "plot_edit": draw(st.sampled_from(["add_plot", "remove_plot", "set_moisture"])),
        "bad_type": draw(st.sampled_from(["", "nope", None, 3, "ADD_PLOT"])),
        "bad_moisture": draw(st.sampled_from(_BAD_MOISTURE)),
        "bad_price": draw(st.sampled_from(_BAD_PRICE)),
        "bad_slot": draw(st.sampled_from(["", "S999", "S004", None, 1])),
        "haul": draw(st.sampled_from(_HAUL_IDS + ["S001"])),
        "confirmed_first": draw(st.integers(0, 3)),
    }
    return state, op, d


# -------------------------------------------------------------- properties


@SETTINGS
@given(_cases())
def test_rejected_write_leaves_lot_unchanged(case):
    state, op, d = case
    session = _new_session()
    lid = _make_lot(session, state, d["confirmed_first"])
    assert _lot(session, lid).status is _status_of(state)

    before = _snap(session, lid)
    order_before = list(session.lot_order)
    count_before = len(session.lots)
    all_before = {k: lot_to_json(v) for k, v in session.lots.items()}

    result, allowed = _run(session, lid, state, op, d)

    assert not result.ok, (state, op, result.body)
    assert not (200 <= result.http_status < 300)
    assert result.http_status in allowed, (state, op, result.http_status, result.body)
    assert _snap(session, lid) == before
    assert {k: lot_to_json(v) for k, v in session.lots.items()} == all_before
    assert list(session.lot_order) == order_before and len(session.lots) == count_before

    # Reads still work, including for a closed Lot, and are unaffected.
    read = get_lot(session, lid)
    assert read.ok and read.http_status == 200
    assert read.body["lot"]["lot_id"] == lid
    assert read.body["lot"]["revision"] == _lot(session, lid).revision
    assert read.body["lot"]["status"] == _status_of(state).value


@SETTINGS
@given(st.sampled_from(("closed", "closed_decided")), st.sampled_from(_WRITERS), st.integers(1, 5))
def test_closed_lot_rejects_every_write_with_409_and_stays_readable(state, writer, bump):
    session = _new_session()
    lid = _make_lot(session, state, 0)
    before = _snap(session, lid)
    first_read = get_lot(session, lid)
    rev = _lot(session, lid).revision

    for r in (rev, rev + bump):  # current and stale revisions are both rejected
        res = _writer_call(session, lid, r, writer)
        assert not res.ok
        assert res.http_status == 409
        assert _snap(session, lid) == before

    again = get_lot(session, lid)
    assert again.ok and again.body == first_read.body
