# Test report: straw lot planning demo

Run date: 2026-11-17 (system clock 12:32 UTC, workspace timezone +0700).
Environment: Linux, Python via `uv`, local HTTP only (`127.0.0.1`).

**Scope statement (first run, 2026-11-17 ~12:32 UTC).** No HTTPS endpoint and no LIFF ID were available. Testing stopped at local HTTP, driven by a Python script that sends real HTTP requests to `webapp.py`. No browser was available (no Chromium or Chrome on the machine, `playwright` is not installed), so no viewport check was run. The page was not opened in LINE.

**Update (second run, 2026-11-17 ~13:16 UTC, task 9.2 re-run).** After the R16.2 fix, the new `tests/test_scenarios.py` and the UI pass, I re-ran pytest, the HTTP checks and a real headless Google Chrome (`/usr/bin/google-chrome`, Playwright via `playwright-core` in `/tmp/shot`). Results are in section 5. Sections 1 to 4 are the earlier records and are kept as written, except where marked "superseded".

## Verified results

### 1. Automated test suite (first run, superseded by section 5.1)

Command: `uv run --locked pytest -q`

| Passed | Failed | Skipped | Exit code |
|---|---|---|---|
| 0 | 0 | 0 | 5 (no tests collected) |

Output:

```
no tests ran in 0.08s
```

`tests/` contains only `__init__.py`, `conftest.py` and `strategies.py`. All optional test sub-tasks (property tests, HTTP tests, scenario tests, safety tests, browser tests) were not implemented, so the suite proves nothing. R16.8 (automated tests for requirements 1 to 13, property tests with at least 100 cases) is **not met**.

### 2. Scripted HTTP checks against the running server

Command: start `PORT=<free port> python3 webapp.py` (printed `http://127.0.0.1:<port>`), run a Python script that uses `http.client` with one session cookie per scenario, then stop the server. The script was a throwaway file in `/tmp`, not saved in the project. The command was run several times while the script was being fixed; the last run had 29 checks.

| Passed | Failed | Skipped |
|---|---|---|
| 28 | 1 | 0 |

Checks that passed (each observed in the final run):

- **F3 (R1, R2.1, R2.2, scenario c):** `POST /api/matches` with 2 t rice straw (ฟางข้าว), Nakhon Sawan (นครสวรรค์) returned 200 with B02 (80 km, 1100) then B01 (35 km, 950). The order matches price descending. Invalid input returned 422 with one message per field. A body that is not a JSON object returned 400.
- **Scenario (a), R16.1 over HTTP:**
  - Preset order of 10 t was created as a draft.
  - Proposal selected plots of 4, 3 and 5 t, with Estimated_Tons 12 and a queue assigned (bale 2026-11-19, haul 2026-11-21).
  - Submit gave status «รอยืนยัน» with 5 confirmations (plant, 3 farmers, contractor).
  - Recording all 5 gave «พร้อมดำเนินงาน» with 5/5.
  - Weight 10.4 gave «ปิดล็อต» with `actual_tons` 10.4.
  - A closed lot was still readable, and a further weight returned 409.
- **Scenario (b), R16.2, no plots:** submit with no plots returned 422 with the shortfall (ขาด 10 ตัน). 
- **Scenario (b), R16.3:** with 4 of 5 confirmations, the response listed exactly one pending party (ผู้รับจ้างตัวอย่าง C01) and the lot stayed «รอยืนยัน». A repeated confirmation returned 200 with the count unchanged. An unknown party returned 404. A stale revision returned 409.
- **R16.4:** after all 5 confirmations, a `set_price` edit returned the lot to «รอยืนยัน» with 0/5 confirmed and a `reset_notice` naming the changed field (`offer_price`) and the 5 reset parties.
- **R16.5 / R12:** weight 8.5 against target 10 kept the lot «พร้อมดำเนินงาน» with a pending shortfall decision (1.5 t) and next action `decide_shortfall`. Weights 0, 101, `"9"` and `null` each returned 422. Decision `source_more` closed the lot with 1.5 t to source. The response data carries the shortfall. That the UI shows «ขาด X ตัน» and both option labels was not observed (no browser).
- **Other:** a lot created in one session returned 404 in another session. A wrong method returned 405 and an unknown path returned 404. An invalid `sid` cookie returned `session_reset: true`. `GET /` returned 200 with a Content-Security-Policy header.

Check that failed in the first run (now fixed, see "Re-run after fix" below):

- **FAIL (first run), scenario (b) queue failure, R16.2 on the submit response.** Order with delivery date 3 days after session start, proposal, then submit. The proposal named the first violation (`delivery_date`, slot S004, «ช่องขนส่ง S004: วันขน 4 เกินวันส่งมอบ 3»), but submit returned 422 with `slots: {bale: "missing", haul: "missing"}`, `violations: []` and `first_violation: null`. The lot stayed «ร่าง» with no confirmations.
- Cause: `_classify_queue` in `lot_service.py` treated a lot with no assigned queue as "missing" without looking at why propose_queue assigned none.

Output (last 20 lines of the final run, each line cut to 330 characters; the first lines show the server URL and the F3 checks):

```
PASS (a) 5 confirmations -> ready | พร้อมดำเนินงาน 5/5
PASS (a) weight 10.4 -> closed | 200 ปิดล็อต actual=10.4 summary_in_response=None
PASS (a) closed lot readable
PASS closed lot rejects weight 409 | 409
  proposal(delivery+3d): queue_assigned=False violations=[{"code": "delivery_date", "subject_type": "slot", "subject_id": "S004", ...
FAIL (b) infeasible queue: submit 422, first violation named, still draft, no confirmations | 422 first_violation=null ...
PASS (b) lot unchanged: draft, 0 confirmations
PASS (b) submit with no plots rejected 422 | 422 {"errors": {"estimated_tons": "ขาด 10 ตัน ส่งให้ยืนยันไม่ได้"} ...
PASS (b) exactly one pending party listed, lot stays awaiting | 4/5 pending=["ผู้รับจ้างตัวอย่าง C01"]
PASS repeat confirmation is idempotent (200, count unchanged) | 200
PASS unknown party -> 404 | 404
PASS stale revision -> 409 | 409
PASS all confirmed -> ready
PASS edit after confirmations resets to รอยืนยัน, 0 confirmed, reset_notice | 200 รอยืนยัน 0/5 ...
PASS weight 8.5 < 10: stays ready, shortfall 1.5, decision pending | 200 พร้อมดำเนินงาน ...
PASS invalid weight 101 -> 422 | 422
PASS shortfall decision source_more closes lot | 200 ปิดล็อต ... "remaining_to_source_tons": 1.5
PASS session isolation: lot created in session 5 (L002) is 404 in another session
PASS 405 on wrong method
PASS 404 unknown path
SUMMARY checks passed=28 failed=1 total=29
```

The closing summary line «ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน» (R11.6) is not in the API response (`summary_in_response=None`); it can only come from the front end, which was not run.

### 2a. Re-run after fix (2026-11-17, ~13:00 UTC)

Fix: in `lot_service.py` `_classify_queue`, when the lot has no bale or haul slot and Plots are selected, it calls `propose_queue`. If that finds no feasible pair, submit reports the violations of the best failed pair (`violations` in CHECK_ORDER, `first_violation` = element 0, slots marked "infeasible"). "missing" remains only when there are no violations to report. `matching.py`, `agent.py` and `check_bedrock.py` were not touched.

Method: a throwaway script (`/tmp/rerun.py`, not saved in the project) calls `webapp.application` directly as a WSGI app, one session cookie per scenario. Result: 0 failed.

```
proposal 200 queue_assigned False {"code": "delivery_date", "subject_type": "slot", "subject_id": "S004", "message_th": "ช่องขนส่ง S004: วันขน 4 เกินวันส่งมอบ 3", ...}
submit 422 {"slots": {"haul": "infeasible"}, "violations": [{"code": "delivery_date", ..., "subject_id": "S004", "message_th": "ช่องขนส่ง S004: วันขน 4 เกินวันส่งมอบ 3"}], "first_violation": {same as violations[0]}, "errors": {"haul_slot_id": "คิวขนส่งใช้ไม่ได้"}}
PASS queue failure: 422
PASS violations non-empty, first_violation == violations[0]
PASS first violation names slot and constraint | ช่องขนส่ง S004: วันขน 4 เกินวันส่งมอบ 3
PASS violations in CHECK_ORDER
PASS matches proposal violations
PASS lot still draft, no confirmations | draft rev=1
PASS delivery+2: 422 with violations
PASS shortfall: 422 ขาด 10 ตัน | {"estimated_tons": "ขาด 10 ตัน ส่งให้ยืนยันไม่ได้"}
PASS submit 200 awaiting, 5 confirmations | 200 awaiting_confirmation 5
PASS second submit 409 | 409
PASS 5 confirmations -> ready | ready
PASS weight 10.4 -> closed | 200 closed 10.4
SUMMARY failed = 0
```

Missing slot after a manual clear (service level, not HTTP, because no HTTP edit clears slots): a draft lot with the preset plots and both slot ids set to None returned 422, `slots: {bale: "missing", haul: "missing"}`, `violations: []`, `first_violation: null`. Unchanged behavior.

The earlier 29-check run above is kept as the record of the first run; the queue-failure check in it now passes.

### 3. Frozen files (matching.py, agent.py, check_bedrock.py)

Command: `git status --short`

```
fatal: not a git repository (or any of the parent directories): .git
```

The workspace is not a git repository, so "no diff" **could not be verified**. File modification times only (not proof of content):

```
2026-11-17 16:25:43 +0700 matching.py
2026-11-17 16:27:10 +0700 agent.py
2026-11-15 17:15:59 +0700 check_bedrock.py
```

`matching.py` and `agent.py` were modified on the same day as the other work; whether that was before or after the spec started is not known. This task did not modify any of the three files.

### 4. Code reading only (not run)

- F3 retry (R2.5 to R2.7, R16.7): `web/app.js` contains the «โหลดผลไม่ได้» text, a `retry` control that is shown on failure and hidden on success, an `AbortController` timeout helper, and a click handler that resubmits the form. This was read, not executed.

### 5. Second run (task 9.2 re-run, 2026-11-17 ~13:16 UTC)

#### 5.1 Automated test suite

Command: `uv run --locked pytest -q`

| Passed | Failed | Skipped | Exit code |
|---|---|---|---|
| 5 | 0 | 0 | 0 |

Output:

```
.....                                                                    [100%]
5 passed in 0.12s
```

All 5 tests are in `tests/test_scenarios.py` and run through the WSGI app with a fake clock, no network:
`test_delivery_plus_3_days_is_rejected_at_submit`, `test_normal_close_with_ten_point_four_tons`, `test_missing_confirmation_stays_awaiting`, `test_edit_after_all_confirmations_resets_to_awaiting`, `test_weight_below_target_gives_pending_shortfall`.

#### 5.2 HTTP checks against a live server

Port 8766 was already in use by another `python3` process (pid 355938), and 8000 by pid 351624 (the default-port demo). I did not touch either. I started `PORT=8777 uv run --locked python webapp.py`, ran a throwaway script (`/tmp/http92.py`, not saved in the project), then stopped only my own server. Afterwards `ss` showed 8000 and 8766 still listening and 8777 closed.

Result: 9 checks, 0 failed.

- F3 `POST /api/matches` (2 t ฟางข้าว, นครสวรรค์): 200, B02 (80 km, 1100) then B01 (35 km, 950). Invalid input: 422.
- Scenario (a): order 201; proposal Estimated_Tons 12; submit gave «รอยืนยัน» with 5 confirmations; 5 confirmations gave «พร้อมดำเนินงาน» 5/5; weight 10.4 gave «ปิดล็อต» with `actual_tons` 10.4.
- Delivery +3 days: submit returned 422 with `first_violation` code `delivery_date`, subject S004, «ช่องขนส่ง S004: วันขน 4 เกินวันส่งมอบ 3». The lot stayed «ร่าง» with no confirmations.

#### 5.3 Browser checks (headless Google Chrome, Playwright)

Setup: `/usr/bin/google-chrome` with `playwright-core` already present in `/tmp/shot` (no reinstall was needed). The measuring script is a copy of `docs/screenshots/shoot.js` with the URL set to port 8777, screenshots written to `/tmp`, and the weight changed to 10.4 (copies in `/tmp/shot/measure.js` and `/tmp/shot/retry.js`, not saved in the project). Each run used a fresh browser context and the page at `http://127.0.0.1:8777/`, tab «วางแผนล็อต», offer price changed to 1100, other fields at their defaults.

| Measure | 360x640 | 430x640 |
|---|---|---|
| Horizontal scroll (scrollWidth vs innerWidth) at order form, proposal, ready, closed | 360 vs 360, none | 430 vs 430, none |
| Bottom edge of «สร้างออเดอร์» (viewport height 640, scrollY 0) | 621.3 px (top 573.3) | 620.5 px (top 572.5) |
| Buttons, inputs, selects and summary elements under 44x44 px (order form, proposal, ready, closed) | none | none |

- Scenario (a) click-through ended with the closed summary line, read from `#lot-summary`: «ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน» at both 360 and 430.
- F3 retry, 360x640: with `/api/matches` aborted by a Playwright route, submit showed «โหลดผลไม่ได้», 0 results, and the retry control became visible. After removing the route and clicking «ลองใหม่», the status read «พบ 2 โรงงาน», the retry control was hidden, and the two results were B (80 km, 1,100) and A (35 km, 950). A first attempt of my script used ซังข้าวโพด, which has no match (status «ไม่พบโรงงานที่ตรงเงื่อนไข»); that was a wrong input in my script, not a defect.
- Not measured: the viewport check of the shortfall view and the other states was not repeated; the touch-target scan covers only the four states listed.

Screenshots from the earlier UI pass are in `docs/screenshots/`: `before-*` (order form, proposal, ready, shortfall, closed, and full-page variants) and `after-*` with the same names, at 360x640. I did not regenerate them in this run and did not compare them pixel by pixel; they are referenced, not re-verified.

### 6. LINE / LIFF (three separate entries)

**(a) Reported by Codex (not re-run by me).** Codex reported that it opened the LIFF link in Chrome and reached the «วางแผนล็อต» page. I have no logs or screenshots of that and did not repeat it.

**(b) Reported by the user (not re-run by me).** The user reported that the LIFF link opens. I did not repeat it.

**(c) Not tested.** The full flow inside the LINE app on a phone (order, confirmations, weight). No result exists for it.

No LIFF ID and no endpoint URL were provided to me, and I did not open any LIFF link myself. My browser runs used the local HTTP server only. In those runs the LIFF SDK script is requested from the internet; I did not check whether it loaded.

### 7. R16.8 status (superseded by section 7a)

Four checkpoint tasks (3, 5, 8, 10) are not done (marked `[~]` in `tasks.md`). The optional property-test, HTTP-test, safety-test and browser-test tasks are not done. What exists is `tests/test_scenarios.py` (5 tests, listed above), plus `tests/conftest.py` and `tests/strategies.py`. R16.8 (automated tests for requirements 1 to 13 and property tests with at least 100 cases) is therefore only partly met.

### 8. Third run: full suite, checkpoints 3, 5, 8 and 10 (2026-11-17, ~20:50 to 20:55 +0700)

Command (run twice from the project root): `uv run --locked pytest -q`

| Run | Passed | Failed | Skipped | Warnings | Duration | Exit code |
|---|---|---|---|---|---|---|
| 1 | 146 | 0 | 0 | none shown | 36.96 s | 0 |
| 2 (with `-rs --durations=3`) | 146 | 0 | 0 | none shown | 28.04 s | 0 |

Output of run 1 (complete):

```
........................................................................ [ 49%]
........................................................................ [ 98%]
..                                                                       [100%]
146 passed in 36.96s
```

Run 2 printed the same dots, no skip lines, and the slowest calls: `test_create_order_props.py::test_valid_payload_creates_one_draft_lot` 4.62 s, `test_lifecycle_stateful.py::TestLifecycleInvariants::runTest` 2.25 s, `test_browser.py::test_layout_and_touch_targets_through_all_states[360-640]` 0.96 s. I ran the suite twice only; no flakiness showed in those two runs. That does not rule it out.

Tests collected per file (`pytest --collect-only`; parametrized cases count separately):

| File | Tests | Property |
|---|---|---|
| test_matching_props.py | 3 | 1 |
| test_search_validation_props.py | 6 | 2 |
| test_create_order_props.py | 3 | 3 |
| test_eligibility_props.py | 3 | 4 |
| test_queue_check_props.py | 2 | 5 |
| test_proposal_props.py | 5 | 6 |
| test_delivered_cost_props.py | 6 | 7 |
| test_add_remove_props.py | 1 | 8 |
| test_rejected_write_props.py | 2 | 9 |
| test_set_queue_props.py | 1 | 10 |
| test_edit_idempotence_props.py | 3 | 11 |
| test_lifecycle_stateful.py | 1 | 12 (RuleBasedStateMachine) |
| test_submit_parties_props.py | 2 | 13 |
| test_confirm_idempotence_props.py | 2 | 14 |
| test_contractor_dates_props.py | 2 | 15 |
| test_reset_props.py | 2 | 16 |
| test_weight_props.py | 5 | 17 |
| test_shortfall_decision_props.py | 3 | 18 |
| test_format_tons_props.py | 3 | 19 |
| test_session_isolation_props.py | 5 | 20 |
| test_serialization_props.py | 6 | 21 |
| test_session_expiry_props.py | 5 | 22 |
| test_http_api.py | 38 | none (example tests) |
| test_safety.py | 26 | none (example tests) |
| test_scenarios.py | 5 | none (acceptance scenarios) |
| test_browser.py | 6 | none (browser) |
| **Total** | **146** | 22 of 22 properties have a file |

The property number per file comes from the `# Feature: ... Property N` header comment in each file. Whether every property has at least 100 generated cases: I saw `max_examples=300` and `max_examples=100` in `test_eligibility_props.py` only. I did not check the settings of the other files in this run, so the "at least 100 cases" part of R16.8 is **not confirmed** here.

Browser tests (`tests/test_browser.py`, 6 tests): all ran, none skipped. They launch Chrome through Playwright with `channel="chrome"`, which used the system Chrome at `/usr/bin/google-chrome` (confirmed to exist; the test file skips itself if Chrome or Playwright is missing, and no skip occurred). Tests: layout and touch targets through all states (parametrized by viewport, includes 360x640), status badge and primary action inside the 640 px viewport, markup in an owner name rendered literally, F3 retry and the no-result text, scenario (a) through the UI to the closing line.

Frozen files: `tests/test_safety.py::test_cli_files_match_recorded_digest` (3 cases) compares `matching.py`, `agent.py` and `check_bedrock.py` with sha256 values recorded when the test was written. I re-computed the three digests by hand now and they equal the recorded ones. This guards against edits made after the test was written. It is **not** proof about earlier history, and the workspace is still not a git repository (`.git` does not exist), so "no diff against the original" remains unverifiable.

Observations from the test authors, confirmed by reading `tests/test_browser.py` lines 216 to 219:

- `lot_service.lot_body` calls `build_view(lot, None, ...)`, which falls back to `lot_planning.default_fixtures()` and not to `lot_service._FIXTURES`. Both return the same data, so there is no runtime effect. Tests that substitute fixtures therefore patch both `lot_service._FIXTURES` and `lot_planning.default_fixtures`.

On `tests/test_eligibility_props.py` (a sub-agent suspected it pre-existed). What I found:

- `ls tests/` shows 26 test files plus `__init__.py`, `conftest.py`, `strategies.py`.
- File birth time is 2026-11-17 20:25:20.306 +0700, modified 20:25:20.307. Its `.pyc` in `__pycache__` is stamped 20:25:20.715. The sibling files from the same batch were born between 20:24:59 and 20:25:21 (`test_format_tons_props.py`, `test_serialization_props.py`, `test_matching_props.py`, `test_queue_check_props.py`). Only `conftest.py`, `__init__.py`, `strategies.py` (18:42) and `test_scenarios.py` (20:06) are earlier.
- So the file has the same creation time as its batch and no earlier one. A file that was deleted and re-created would also show a new birth time, so these timestamps cannot exclude that an older version existed. I found no evidence that it did.

### 7a. R16.8 status after the third run

Checkpoint tasks 3, 5, 8 and 10 are satisfied by the two green runs above (146 passed, 0 failed, 0 skipped). R16.8 is now **met for requirements 1 to 13** in the sense that automated tests exist and pass for each of the 22 properties plus HTTP, scenario, safety and browser tests, with these limits:

- The 100-case minimum per property is confirmed for one file only (see above).
- I did not map each individual requirement 1 to 13 to a test in this run; the property headers list the requirements they validate, I did not audit them.
- The sha256 frozen-file guard is not proof about history (see above).
- LIFF/LINE items in section 6 are unchanged and not covered by any automated test.

## Assumptions

- The throwaway HTTP script reflects the intended contract; its assertions were written from `requirements.md` and the observed response shapes.
- The 28 passing HTTP checks show server behavior on the stated inputs only. They do not stand in for the property tests in tasks 1.4 to 6.6.
- `matching.py`, `agent.py` and `check_bedrock.py` are unchanged by this work. This is stated by the task rules and was not verified (no git).
- Local HTTP responses behave the same as they would behind an HTTPS front end. The `Secure` cookie flag on HTTPS was not exercised.

## Untested items

Verified earlier (section 5): mobile 360x640 and 430 checks for horizontal scroll, the «สร้างออเดอร์» bottom edge and 44 px targets; the closing summary line (R11.6) in the browser; the F3 retry flow (R2.5 to R2.7, R16.7); the +3-day rejection, scenario (a) and F3 over HTTP.

Now covered by automated tests in section 8 (I saw the test names, not every assertion):

- Markup rendered literally: `test_safety.py::test_markup_in_owner_name_stays_literal_in_api_json`, `test_web_scripts_use_no_html_sinks`, and `test_browser.py::test_markup_in_owner_name_is_rendered_literally` (R14.10).
- Session expiry after 24 hours and reset flag: `test_session_expiry_props.py` (Property 22), `test_http_api.py::test_expired_cookie_flags_reset_and_issues_new_cookie`, `test_bogus_cookie_flags_reset_and_issues_new_cookie` (R13.8).
- Caps: 500 sessions (`test_default_session_cap_500`) and 20 lots per session (`test_lot_cap_409`) (R13.9).
- Cookie flags and token length: `test_http_api.py::test_demo_sets_cookie_with_flags_and_long_token`, `test_cookie_secure_over_https_scheme`, `test_cookie_secure_with_forwarded_proto`. The `Secure` flag is tested with an https scheme and a forwarded-proto header in-process; no real HTTPS server was used.
- Session isolation: `test_session_isolation_props.py` (Property 20) (R13.2, R13.4, R13.10).
- Shortfall: `test_shortfall_decision_props.py` (Property 18) and `test_scenarios.py::test_weight_below_target_gives_pending_shortfall` cover the data and decision rules. The UI wording «ขาด X ตัน» with both options is **not** asserted in `test_browser.py` (a grep for "ขาด" and "shortfall" in that file found nothing), so the wording in the browser is still untested.
- Standard-library-only imports (R15.3), start without AWS credentials (R15.1), no LINE/payment/carbon routes, fixtures free of phone-like numbers and LINE ids (R16.9): `test_safety.py`.
- Weight validation, contractor dates, reset after edit, and the other lifecycle rules: Properties 9 to 18.

Still untested:

- Opening the page inside LINE, LIFF initialization with a real `LIFF_ID`, and any HTTPS endpoint (see section 6). **The full flow inside the LINE app on a phone: Not tested.**
- Browser rendering of «ขาด X ตัน» with the two decision options, the session reset notice in the UI, and one primary action visible without scrolling in states other than the one covered by `test_status_badge_and_primary_action_inside_640_viewport` (I did not read which state that test uses).
- At least 100 generated cases per property for every file (only `test_eligibility_props.py` was checked).
- Whether `matching.py`, `agent.py` and `check_bedrock.py` differ from their original content (no git; the sha256 guard covers only edits after it was written).
- Plot-ready-after-clear-date case over HTTP: not constructible. P008 (the only such Plot) is rejected by `add_plot` and by propose, and no edit over HTTP clears a queue slot, so submit cannot be reached with it.

## Navigation bar redesign (task 7.1 reopened)

Change: compact top bar (short name «AgriCarbon Match», badge «ข้อมูลจำลอง», one-line section title that follows the active tab) and a fixed bottom navigation bar with two items (inline SVG icon above label «ค้นหาโรงงาน» / «วางแผนล็อต»). Ids `#tab-search`, `#tab-lot`, classes `.tab` / `.tab-panel`, and `role="tab"` / `aria-selected` are unchanged. The `<title>` is now «AgriCarbon Match». The title bar that LINE draws above the LIFF view is set by LINE (LIFF app name, view size in LIFF settings) and is not changed by this page. The top bar shows only the section title, not the lot status, because `lot.js` was left untouched.

Observed with real headless Chrome (Playwright, app on an ephemeral port that was shut down afterwards). Screenshots: `docs/screenshots/nav-before-*.png` and `nav-after-*.png` (search, order form, proposal, ready at 360×640).

| Check | Before | After |
|---|---|---|
| Horizontal scroll (scrollWidth vs innerWidth) at 360 and 430 | none | none |
| «สร้างออเดอร์» bottom edge at 360×640, scrollY=0 | 621 px | 570 px (bottom bar starts at 583 px) |
| Same at 430 wide, 640 high | 620 px | 569 px |
| Targets under 44×44 (button, input, select, summary, tab) | none | none |
| Bottom bar vs last content when scrolled to the end (ready state, 360) | not applicable (tabs at top) | last content bottom 537 px, bar top 583 px, no overlap |
| `.primary-action` count in ready state | 1 | 1 |

Full suite: `uv run --locked pytest -q` gave 146 passed on the second run. The first run had 1 failure in `tests/test_add_remove_props.py::test_add_then_remove_plot_restores_derived_values` (a Hypothesis property test on Python code that this change does not touch). It passed on the rerun and I did not investigate the cause. No test selectors were changed.

Visual check of `nav-after-order-form-360x640.png` and `nav-after-ready-360x640.png`: dark green top bar with the name on the left, the badge on the right and the section title below. The bottom bar has two equal halves. The active half has a pale green background, a dark green label, a layered icon with a tinted fill and a green indicator on its top edge. The inactive half has a grey magnifier icon and label. The indicator looks slightly merged with the bar's top border, which is a minor visual detail.

Not tested: opening the page inside the LINE app (real LIFF view, its title bar, or a phone with a real safe-area inset).
