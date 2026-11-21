"""Browser checks at mobile viewports (task 7.4).

Dev-only: needs Playwright for Python and the system Chrome. The whole module is
skipped when either is missing. The app runs in a background thread on an
ephemeral port (port 0), so nothing else on the machine is touched.
"""

from __future__ import annotations

import dataclasses
import itertools
import os
import threading
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server

import pytest

sync_api = pytest.importorskip("playwright.sync_api")
if not os.path.exists("/usr/bin/google-chrome"):
    pytest.skip("system Chrome not available", allow_module_level=True)

import lot_planning  # noqa: E402
import lot_service  # noqa: E402
import webapp  # noqa: E402
from matching import MATERIALS, PILOT_PROVINCES, find_biomass_buyers  # noqa: E402

VIEWPORTS = [(360, 640), (430, 932)]
CLOSING_LINE = "ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน"
NO_RESULT = "ไม่พบโรงงานที่ตรงเงื่อนไข"


class _ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class _Running:
    def __init__(self) -> None:
        self.server = make_server(
            "127.0.0.1", 0, webapp.create_app(), server_class=_ThreadedServer,
            handler_class=webapp.QuietHandler,
        )
        self.url = f"http://127.0.0.1:{self.server.server_port}/"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> "_Running":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


@pytest.fixture
def app_url():
    with _Running() as running:
        yield running.url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as pw:
        try:
            b = pw.chromium.launch(channel="chrome", args=["--no-sandbox"])
        except Exception as exc:  # Chrome missing or not launchable
            pytest.skip(f"Chrome could not be launched: {exc}")
        yield b
        b.close()


def new_page(browser, width: int, height: int):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    page.set_default_timeout(10000)
    return ctx, page


# ------------------------------------------------------------------ helpers

def open_lot_tab(page, url: str) -> None:
    page.goto(url)
    page.click("#tab-lot")
    page.wait_for_selector("#lot-order-form")


def create_order(page, price: str = "1500") -> None:
    page.fill("#lot-price", price)
    with page.expect_response("**/api/orders"):
        page.click("#lot-order-form button[type=submit]")
    page.wait_for_selector("#lot-root .status-badge")


def click_primary(page, text: str, api: str) -> None:
    with page.expect_response(f"**/api/lots/*/{api}"):
        page.click(f".primary-action:has-text('{text}')")


def to_proposal(page) -> None:
    click_primary(page, "เสนอชุดแปลง", "proposal")
    page.wait_for_selector(".primary-action:has-text('ไปขั้นรอยืนยัน')")


def to_ready(page) -> None:
    click_primary(page, "ไปขั้นรอยืนยัน", "submit")
    page.wait_for_selector(".primary-action:has-text('บันทึกว่ายืนยันแล้ว')")
    for _ in range(10):
        loc = page.locator(".primary-action:has-text('บันทึกว่ายืนยันแล้ว')")
        if not loc.count():
            break
        with page.expect_response("**/confirmations"):
            loc.first.click()
        page.wait_for_timeout(50)
    page.wait_for_selector("#lot-weight")


def to_closed(page, weight: str = "10.4") -> None:
    page.fill("#lot-weight", weight)
    with page.expect_response("**/weight"):
        page.click(".primary-action:has-text('บันทึกน้ำหนักชั่งจริง')")
    page.wait_for_selector("#lot-summary")


def measure(page) -> dict:
    return page.evaluate(
        """() => {
          const small = [];
          for (const e of document.querySelectorAll("button,input,select,summary,[role=tab]")) {
            const r = e.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.width < 43.5 || r.height < 43.5)
              small.push(`${e.tagName}#${e.id}.${e.className} ${(e.textContent||e.name||'').slice(0,20)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
          }
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, small };
        }"""
    )


def assert_layout(page, tag: str) -> None:
    m = measure(page)
    assert m["sw"] <= m["iw"], f"{tag}: horizontal scroll {m['sw']} > {m['iw']}"
    assert not m["small"], f"{tag}: targets under 44x44: {m['small']}"


def assert_one_primary(page, tag: str) -> None:
    n = page.locator("#lot-root .primary-action:visible").count()
    assert n == 1, f"{tag}: {n} visible primary actions"


# -------------------------------------------------------------------- tests

@pytest.mark.parametrize("width,height", VIEWPORTS)
def test_layout_and_touch_targets_through_all_states(browser, app_url, width, height):
    """No horizontal scroll and 44x44 targets on form, proposal, ready, closed (14.2-14.4)."""
    ctx, page = new_page(browser, width, height)
    try:
        page.goto(app_url)
        assert_layout(page, "search tab")
        page.click("#tab-lot")
        page.wait_for_selector("#lot-order-form")
        assert_layout(page, "order form")

        if (width, height) == (360, 640):
            box = page.locator("#lot-order-form button[type=submit]").bounding_box()
            assert page.evaluate("scrollY") == 0
            assert box["y"] + box["height"] <= 640, box
            assert page.get_by_role("button", name="สร้างออเดอร์").bounding_box()["y"] + box["height"] <= 640

        create_order(page)
        assert page.locator("#lot-root .status-badge").count() == 1
        assert_one_primary(page, "draft")
        assert_layout(page, "draft")

        to_proposal(page)
        assert_one_primary(page, "proposal")
        assert_layout(page, "proposal")

        to_ready(page)
        assert page.locator("#lot-root .status-badge").inner_text()
        assert_one_primary(page, "ready")
        assert_layout(page, "ready")

        to_closed(page)
        assert_one_primary(page, "closed")
        assert_layout(page, "closed")
    finally:
        ctx.close()


def test_status_badge_and_primary_action_inside_640_viewport(browser, app_url):
    """Status badge and the one primary action are visible without scrolling (14.4)."""
    ctx, page = new_page(browser, 360, 640)
    try:
        open_lot_tab(page, app_url)
        create_order(page)
        for tag in ("draft", "proposal"):
            if tag == "proposal":
                to_proposal(page)
            badge = page.locator("#lot-root .status-badge").bounding_box()
            action = page.locator("#lot-root .primary-action:visible").bounding_box()
            assert badge["y"] + badge["height"] <= 640, tag
            assert action["y"] + action["height"] <= 640, tag
    finally:
        ctx.close()


def test_markup_in_owner_name_is_rendered_literally(browser, monkeypatch):
    """Server strings are text, never markup (14.10)."""
    fx = lot_service._fixtures()
    plots = tuple(
        dataclasses.replace(p, owner_name="<b>x</b>") if p.plot_id == "P001" else p
        for p in fx.plots
    )
    patched = dataclasses.replace(fx, plots=plots)
    monkeypatch.setattr(lot_service, "_FIXTURES", patched)
    # build_view() falls back to lot_planning.default_fixtures() (lot_body passes None),
    # so patch that too or the response views keep the original owner names.
    monkeypatch.setattr(lot_planning, "default_fixtures", lambda: patched)
    with _Running() as running:
        ctx, page = new_page(browser, 360, 640)
        try:
            open_lot_tab(page, running.url)
            create_order(page)
            to_proposal(page)
            text = page.locator("#lot-root").inner_text()
            assert "<b>x</b>" in text
            assert page.locator("#lot-root b").count() == 0
        finally:
            ctx.close()


def _combo(has_results: bool) -> tuple[str, str]:
    for material, province in itertools.product(sorted(MATERIALS), sorted(PILOT_PROVINCES)):
        found = find_biomass_buyers(material, 5, province)["matches"]
        if bool(found) == has_results:
            return material, province
    pytest.skip("no suitable sample data combination")


def _search(page, material: str, province: str, qty: str = "5") -> None:
    page.select_option("select[name=material]", value=material)
    page.select_option("select[name=province]", value=province)
    page.fill("input[name=quantity_tons]", qty)
    page.click("#submit")


def test_f3_retry_after_failure_and_no_result_text(browser, app_url):
    """Failed search shows a retry; unrouting and retrying works without reload (2.x, 14.7)."""
    ok_material, ok_province = _combo(True)
    ctx, page = new_page(browser, 360, 640)
    try:
        page.goto(app_url)
        sync_api.expect(page.locator("#submit")).to_be_enabled()
        page.evaluate("window.__marker = 1")

        page.route("**/api/matches", lambda route: route.abort())
        _search(page, ok_material, ok_province)
        page.wait_for_selector("#retry:visible")
        assert page.locator("#status").inner_text() == "โหลดผลไม่ได้"
        assert page.locator("#results li").count() == 0
        assert page.input_value("input[name=quantity_tons]") == "5"

        page.unroute("**/api/matches")
        page.click("#retry")
        page.wait_for_selector("#results li")
        assert page.locator("#results li").count() >= 1
        assert page.evaluate("window.__marker") == 1  # no reload

        # No match: an unreasonably large minimum is not a filter here, so use a combo with no buyer.
        none_material, none_province = _combo(False)
        _search(page, none_material, none_province)
        sync_api.expect(page.locator("#status")).to_have_text(NO_RESULT)
        assert page.locator("#results li").count() == 0
    finally:
        ctx.close()


def test_scenario_a_through_the_ui_reaches_closing_line(browser, app_url):
    """Preset 10 t, estimate 12 t, weigh 10.4 t, closing line (16.1)."""
    ctx, page = new_page(browser, 360, 640)
    try:
        open_lot_tab(page, app_url)
        assert page.input_value("#lot-target") == "10"
        create_order(page)
        to_proposal(page)
        assert "12" in page.locator(".tons-card .estimate").inner_text()
        to_ready(page)
        assert page.locator("#lot-root .status-badge").get_attribute("data-status") == "ready"
        to_closed(page, "10.4")
        assert page.locator("#lot-root .status-badge").get_attribute("data-status") == "closed"
        assert page.locator("#lot-summary").inner_text().strip() == CLOSING_LINE
    finally:
        ctx.close()
