# Implementation Plan: Straw Lot Planning Demo

## Overview

Implementation language: Python 3.12 (standard library only at runtime) for the server and rules, plain JavaScript for the web UI. Tests use pytest and Hypothesis as dev-only dependencies.

The plan builds bottom-up: state and fixtures, pure planning rules, the stateful lot service, the HTTP layer, the front end (including the fixes to the existing F3 page), then the README, deployment steps, and test report. `matching.py`, `agent.py`, and `check_bedrock.py` must not be changed.

## Tasks

- [x] 1. Set up foundations: dev tooling, fixtures, state model
  - [x] 1.1 Add dev dependencies and test scaffold
    - Add a dev-only dependency group (`pytest`, `hypothesis`) to `pyproject.toml` without changing the runtime dependency list, then run `uv lock`
    - Create `tests/__init__.py`, `tests/conftest.py` with a fake clock fixture, and `tests/strategies.py` with generators for Decimals (0-2 places), distances near 80, day offsets, Plots, Orders, Slots, Lots in each status, and invalid-value generators (booleans, strings, NaN, infinity, huge ints, out-of-range numbers)
    - _Requirements: 15.3, 16.8_

  - [x] 1.2 Create `lot_fixtures.py`
    - Define constants: straw price 300, baling 250, haul 5 per ton-km, slot capacity 15, buffer 120, default max moisture 20
    - Define synthetic mock Plots (eligible 4, 3, 5 t plus an extra 2 t Plot; one with unknown moisture; excluded Plots for moisture, distance above 80 km, non-rice material, and ready day after last clearing day), bale slots on days 2-4, haul slots on days 4-6 (at least one with booked tons leaving under 12 t), and Contractor `C01`
    - Use only synthetic names and ids, with no phone numbers, LINE ids, or coordinates
    - _Requirements: 5.2, 16.9, A1, A2, A3, A4, A10, A12_

  - [x] 1.3 Create `lot_state.py`
    - Add frozen dataclasses (`Plot`, `Slot`, `Order`, `Confirmation`, `ShortfallDecision`, `Lot`), the `Status` enum with Thai labels, and `format_tons`
    - Add `lot_to_json` and `lot_from_json` (Decimal as string, sorted keys, `ValueError` on malformed input)
    - _Requirements: 11.7, 13.7_

  - [x]* 1.4 Write property test for tons formatting
    - **Property 19: Tons formatting is exact and has no trailing zeros**
    - File: `tests/test_format_tons_props.py`, at least 100 examples
    - **Validates: Requirements 7.3, 11.7**

  - [x]* 1.5 Write property test for Lot serialization round trip
    - **Property 21: Lot serialization round trip**
    - File: `tests/test_serialization_props.py`, at least 100 examples
    - **Validates: Requirements 12.7, 13.7**

  - [x]* 1.6 Write property test for F3 search eligibility and ordering
    - **Property 1: Search results match the eligibility model and ordering**
    - File: `tests/test_matching_props.py`, covering distances of exactly 80.0 and 80.1 km and idempotence; call `find_biomass_buyers` without modifying `matching.py`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

- [x] 2. Implement pure planning rules in `lot_planning.py`
  - [x] 2.1 Implement `plot_eligibility`
    - Check material, distance (80.0 passes, 80.1 fails), moisture (unknown sets `moisture_pending`), baling window, and haul window, with ordered Thai reasons that cite the numbers or names
    - Use `Decimal` and integer day offsets, with no I/O or clock access
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10, 15.7_

  - [x] 2.2 Implement `check_queue_pair` and `propose_queue`
    - Return all `Violation`s sorted by `(CHECK_ORDER index, subject_id)` with inclusive date bounds
    - `propose_queue` scans pairs in `(bale_day, bale_slot_id, haul_day, haul_slot_id)` order, returns the first feasible pair, otherwise no queue plus the best failed pair and its violations (a `none` capacity violation when a slot kind is empty)
    - _Requirements: 4.6, 4.7, 5.3, 5.7, 8.3, 16.2, 15.7_

  - [x] 2.3 Implement `select_plots`, `delivered_cost`, and `build_view`
    - `select_plots` sorts by `(distance, ready_day, plot_id)` and stops at 120% of target using exact Decimal comparison
    - `delivered_cost` applies the formula with half-up rounding to whole baht and returns `None` for zero tons
    - `build_view` derives estimated tons, shortfall, cost, per-Plot eligibility, excluded list, queue result, confirmation counts, `status_label`, `next_action`, and the Thai order conditions
    - _Requirements: 3.2, 5.1, 5.2, 5.4, 5.5, 5.6, 5.9, 6.1, 6.2, 6.6, 7.3, A6, A7, A13_

  - [x]* 2.4 Write property test for Plot eligibility
    - **Property 4: Plot eligibility follows the rules**
    - File: `tests/test_eligibility_props.py`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.10**

  - [x]* 2.5 Write property test for the queue check
    - **Property 5: The queue check returns ordered violations and matches the constraints**
    - File: `tests/test_queue_check_props.py`
    - **Validates: Requirements 4.6, 4.7, 5.3, 5.7, 8.3, 16.2**

  - [x]* 2.6 Write property test for proposals
    - **Property 6: Proposals select by rule and are deterministic**
    - File: `tests/test_proposal_props.py`
    - **Validates: Requirements 5.1, 5.3, 5.6, 5.7, 5.8, 5.9, 7.3, 15.7**

  - [x]* 2.7 Write property test for delivered cost
    - **Property 7: Delivered cost matches the formula and its lower bound**
    - File: `tests/test_delivered_cost_props.py`
    - **Validates: Requirements 6.1, 6.2, 6.6, 6.7**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the lot service and session store in `lot_service.py`
  - [x] 4.1 Implement `SessionStore` and `Session`
    - Inject `clock` and `token_factory` (`secrets.token_urlsafe(24)`), use a per-session lock, expire sessions idle 24 hours or more on `resolve` and `sweep`, cap 500 sessions and 20 Lots per session
    - Report `was_reset` when a token was sent but not valid; never key by LINE userId
    - _Requirements: 13.1, 13.2, 13.4, 13.8, 13.9, 13.10, A8_

  - [x] 4.2 Implement request validation, `create_order`, and `get_lot`
    - Accept JSON numbers only (reject booleans, strings, NaN, infinity), convert delivery date to a day offset, report every invalid field in one 422, reject unknown, closed, or non-straw plants
    - Enforce the check order 404, 409 revision, 409 status, 422 values; `get_lot` works in every status
    - _Requirements: 3.1, 3.3, 3.4, 7.10, 13.5, A12_

  - [x] 4.3 Implement `propose` and `apply_edit`
    - Handle `add_plot`, `remove_plot`, `set_price`, `set_moisture`, `set_queue` through the pipeline: validate, build candidate, normalize (drop ineligible Plots, keep a feasible queue pair, otherwise re-propose), no-op detection, derive status, bump revision once
    - Reject plan edits with 409 while a shortfall decision is pending; return `reset_notice` only when confirmations were reset
    - Commit by a single assignment under the session lock
    - _Requirements: 4.10, 4.11, 5.1, 5.3, 6.3, 7.1, 7.2, 7.5, 7.6, 7.7, 7.8, 7.9, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 13.6_

  - [x] 4.4 Implement `submit` and `confirm`
    - `submit` checks tons and queue (reporting missing versus infeasible per slot), then builds exactly one pending Confirmation per Plant, distinct Farmer owner, and Contractor
    - `confirm` is idempotent, validates contractor dates against the selected slots, returns the `confirmed_count` out of total, and moves to `ready` on the last confirmation
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9, A14_

  - [x] 4.5 Implement `record_weight` and `decide_shortfall`
    - Accept weights only in `ready` for finite values in (0, 100], round half-up to 2 decimals, close when at or above target, otherwise keep `ready` with a pending decision that a later weight can replace
    - `plant_accepts` and `source_more` close the Lot and record tons to source; reject choices with 409 when no decision is pending
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.4, 12.5, 12.6, A11_

  - [x]* 4.6 Write property test for order creation
    - **Property 3: Order creation is all-or-nothing**
    - File: `tests/test_create_order_props.py`
    - **Validates: Requirements 3.1, 3.3, 3.4**

  - [x]* 4.7 Write property test for session isolation
    - **Property 20: Sessions are isolated**
    - File: `tests/test_session_isolation_props.py`
    - **Validates: Requirements 13.2, 13.4, 13.10**

  - [x]* 4.8 Write property test for session expiry
    - **Property 22: Idle Sessions expire at 24 hours**
    - File: `tests/test_session_expiry_props.py`, using the fake clock
    - **Validates: Requirements 13.8**

  - [x]* 4.9 Write property test for add then remove Plot
    - **Property 8: Adding then removing a Plot restores the derived values**
    - File: `tests/test_add_remove_props.py`
    - **Validates: Requirements 6.3, 7.1**

  - [x]* 4.10 Write property test for rejected writes
    - **Property 9: A rejected write leaves the Lot unchanged**
    - File: `tests/test_rejected_write_props.py`
    - **Validates: Requirements 4.11, 7.2, 7.6, 7.8, 7.9, 9.9, 10.6, 13.6**

  - [x]* 4.11 Write property test for queue choice
    - **Property 10: A queue choice is accepted exactly when it is feasible**
    - File: `tests/test_set_queue_props.py`
    - **Validates: Requirements 7.5, 7.6**

  - [x]* 4.12 Write property test for edit idempotence
    - **Property 11: Repeating an edit is a no-op**
    - File: `tests/test_edit_idempotence_props.py`
    - **Validates: Requirements 10.5**

  - [x]* 4.13 Write stateful property test for lifecycle invariants
    - **Property 12: Lifecycle invariants hold across arbitrary operation sequences**
    - File: `tests/test_lifecycle_stateful.py`, Hypothesis `RuleBasedStateMachine` with `max_examples=100` and `stateful_step_count=30`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 9.1, 9.4, 9.5, 9.6, 10.1, 10.3, 10.4, 11.2, 12.2, 13.3, 13.5**

  - [x]* 4.14 Write property test for submit confirmations
    - **Property 13: Submit creates exactly one Confirmation per required party**
    - File: `tests/test_submit_parties_props.py`
    - **Validates: Requirements 8.4**

  - [x]* 4.15 Write property test for repeated confirmation
    - **Property 14: Recording a Confirmation twice changes nothing**
    - File: `tests/test_confirm_idempotence_props.py`
    - **Validates: Requirements 9.7**

  - [x]* 4.16 Write property test for contractor dates
    - **Property 15: Contractor dates must equal the selected slots**
    - File: `tests/test_contractor_dates_props.py`
    - **Validates: Requirements 9.2, 9.3**

  - [x]* 4.17 Write property test for reset after confirmation
    - **Property 16: An accepted edit after confirmation resets all parties**
    - File: `tests/test_reset_props.py`
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [x]* 4.18 Write property test for weight outcome
    - **Property 17: Weight outcome depends only on status and value**
    - File: `tests/test_weight_props.py`
    - **Validates: Requirements 11.1, 11.3, 11.4, 11.5, 12.1, 12.2**

  - [x]* 4.19 Write property test for shortfall decisions
    - **Property 18: Shortfall decisions resolve and close the Lot**
    - File: `tests/test_shortfall_decision_props.py`
    - **Validates: Requirements 12.4, 12.5, 12.6**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend the WSGI server in `webapp.py`
  - [x] 6.1 Add routing infrastructure, session cookie, and headers
    - Add a router with 404 and 405 (`Allow`) handling, a JSON body reader (at most 4096 bytes, JSON object, Thai 400 message), and `GET /api/demo` (plants, preset `target_tons: 10`, rates labeled «ประมาณการ», Lot summaries, `session_reset`, `today`, `liff_id` from `LIFF_ID`)
    - Set the cookie `sid` (`HttpOnly; SameSite=Lax`, plus `Secure` on HTTPS), add `X-Content-Type-Options: nosniff` and a Content-Security-Policy allowing LIFF hosts, keep `Referrer-Policy`, and log only method, path, status, and duration
    - Keep `GET /api/config` and `POST /api/matches` backward compatible, with no Session created for static files or those two endpoints; return 500 with a generic Thai message and no stack trace
    - _Requirements: 1.6, 2.2, 13.1, 13.9, 13.10, 14.6, 15.1, 15.3_

  - [x] 6.2 Add lot endpoints
    - Wire `POST /api/orders`, `GET /api/lots/{id}`, and `POST /api/lots/{id}/` `proposal`, `edits`, `submit`, `confirmations`, `weight`, `shortfall-decision` to the lot service, mapping results to the status codes and error bodies in the design
    - Include `first_violation` (element 0 of `violations`) in responses and require `revision` on every write
    - _Requirements: 3.1, 5.7, 7.1, 7.9, 8.2, 8.3, 9.1, 11.1, 12.1, 13.5, 13.6, 16.2_

  - [x]* 6.3 Write property test for invalid search input
    - **Property 2: Invalid search input yields one error per invalid field**
    - File: `tests/test_search_validation_props.py`, calling `application(environ, start_response)` directly
    - **Validates: Requirements 2.1**

  - [x]* 6.4 Write HTTP example tests
    - File: `tests/test_http_api.py`; cover the F3 contract (`GET /api/config`, `POST /api/matches`, 400 and 422 cases), cookie flags and token length of at least 16 bytes, session reset flag, 404 and 405, and each lot endpoint status code
    - _Requirements: 1.6, 2.1, 2.2, 13.1, 13.10_

  - [x]* 6.5 Write acceptance scenario tests
    - File: `tests/test_scenarios.py`; scenario (a) preset 10 t through close with «ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน»; scenario (b) first failing condition naming the Plot or slot with no Confirmation created, and exactly one missing Confirmation listed by name; edit after all confirmations resets to «รอยืนยัน»; weight below target shows shortfall and both options; scenario (c) F3 results
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 11.6, 5.2_

  - [x]* 6.6 Write safety and smoke tests
    - File: `tests/test_safety.py`; markup in a mock owner name stays literal in API data, runtime modules import only the standard library, the app starts with no AWS credentials, no route sends LINE messages, payments, or carbon claims, fixtures contain no phone-number-like digits or LINE id prefixes, and `matching.py`, `agent.py`, `check_bedrock.py` have no git diff
    - _Requirements: 14.10, 15.1, 15.3, 15.4, 15.6, 16.9_

- [x] 7. Build the front end
  - [x] 7.1 Fix the existing F3 page and add tabs (`web/index.html`, `web/app.js`)
    - Add the tabs «ค้นหาโรงงาน» and «วางแผนล็อต», a lot-planning container, and a `lot.js` script tag
    - Fix gaps in `app.js`: option-load failure text «โหลดผลไม่ได้» with retry; no-result text exactly «ไม่พบโรงงานที่ตรงเงื่อนไข»; LIFF failure text «เชื่อมต่อ LINE ไม่สำเร็จ คุณยังใช้งานผ่านเว็บได้»; `AbortController` timeouts (10 s search and option load, 15 s elsewhere); treat HTTP 400 as a Thai message without retry; retain entered values and clear the stale result list on failure; successful retry shows results without reload; render with `textContent` only
    - _Requirements: 1.4, 2.3, 2.4, 2.5, 2.6, 2.7, 14.1, 14.6, 14.7, 14.8, 14.10, 16.7_

  - [x] 7.2 Create `web/lot.js`
    - Build the order form (preset 10 t), conditions list, status badge with exactly one primary action from `next_action`, selected and excluded Plot lists with reasons, queue and violations, separate «ราคาที่โรงงานเสนอ» and «ต้นทุนส่งถึงโรงงาน (ประมาณการ)» elements, confirmation list labeled «บันทึกโดยผู้ประสานงาน» with "N/M", reset notice, weight form, shortfall «ขาด X ตัน» with the two decision options, and the closing summary line
    - Handle `session_reset` with a blocking dismissible notice, send `revision` on every write, show 409 messages, apply retry and 15 s timeout for failed requests, closed Lots offer only «ดูผล» and «เริ่มออเดอร์ใหม่», and show no profit or income figure and no text implying a message was sent
    - _Requirements: 3.2, 3.5, 3.6, 4.2, 4.3, 4.9, 5.4, 5.5, 6.4, 6.5, 6.6, 7.3, 7.4, 9.4, 9.8, 10.2, 11.6, 11.7, 11.8, 12.3, 12.7, 13.3, 13.10, 14.3, 14.8, 14.9, 14.10_

  - [x] 7.3 Update `web/style.css`
    - Single-column mobile-first layout that does not scroll horizontally at 360-430 px, with `overflow-wrap: anywhere`; `min-height` and `min-width` of 44 px for buttons and form controls; status badge and primary action visible within a 640 px high viewport
    - _Requirements: 14.2, 14.3, 14.4_

  - [x]* 7.4 Write browser checks at mobile viewport
    - File: `tests/test_browser.py` (Playwright, dev-only, skipped when unavailable); check 360×640 no horizontal scroll, touch target sizes, one primary action visible, markup rendered literally, retry flow after simulated failure, and scenario (a) through the UI
    - _Requirements: 14.2, 14.3, 14.4, 14.10, 16.1, 16.7_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Documentation deliverables
  - [x] 9.1 Update `README.md`
    - State the local run command, Python 3.12 minimum, full local URL (host and port), and the expected page behavior with no `LIFF_ID`
    - Describe one HTTPS deployment method for the WSGI app with start command, the `LIFF_ID` variable and where to set it, and the steps to set the LIFF Endpoint URL (must start with `https://`) in the LINE Developers Console
    - State that the web demo uses server-side rules and mock data, that the CLI agent is separate, and that the CLI agent needs Bedrock access in ap-southeast-1
    - _Requirements: 15.5, 17.1, 17.2, 17.3, 17.8_

  - [x] 9.2 Run the test suite and write `docs/test-report.md`
    - Run `uv run --locked pytest -q` and any browser check, then record each command, passed, failed, and skipped counts, run date, and up to 20 lines of actual output per command
    - Use headings «Verified results», «Assumptions», and «Untested items»; list any failed test by name with its failure summary; if no HTTPS endpoint or `LIFF_ID` is available, state that testing stopped at local HTTP and browser or viewport checks and that the page was not opened inside LINE
    - _Requirements: 16.8, 17.4, 17.5, 17.6, 17.7_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Each property test is its own sub-task with at least 100 generated cases, and carries the comment `# Feature: straw-lot-planning-demo, Property N: <title>`
- Do not change `matching.py`, `agent.py`, or `check_bedrock.py`
- Task 9.2 reports only what was actually run; it must not claim LINE or HTTPS testing that did not happen

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "1.5", "1.6", "2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4", "2.5", "2.6", "2.7", "4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["4.3"] },
    { "id": 9, "tasks": ["4.4"] },
    { "id": 10, "tasks": ["4.5"] },
    { "id": 11, "tasks": ["4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15", "4.16", "4.17", "4.18", "4.19", "6.1", "7.1", "7.3"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3", "6.4", "6.5", "6.6", "7.2"] },
    { "id": 14, "tasks": ["7.4", "9.1"] },
    { "id": 15, "tasks": ["9.2"] }
  ]
}
```
