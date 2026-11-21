# Implementation Plan: Agrimatch MVP

## Overview

Language: TypeScript (Node.js/Express API and worker, Next.js Dashboard), PostgreSQL 16, Vitest + fast-check. The Python demo (`webapp.py`, `lot_planning.py`, `lot_service.py`, `lot_state.py`, `web/`, `agent.py`) is not touched.

Decisions confirmed by the user on 18 Nov 2026 (see `design.md`): one receiver acceptance completes an offer; insufficient quantity at accept returns `409 INSUFFICIENT_QUANTITY` and the offer stays `PENDING`; the 80 km cap is a hard filter on routes 1, 2, 4 and distance is still scored; the web app and API are same-origin through a Next.js `/api/*` rewrite.

Rules for every task:

- Build the real LINE client, Bedrock Converse adapter and S3 store behind the existing ports. They stay disabled by `ENABLE_REAL_LINE`, `ENABLE_REAL_BEDROCK` and `ENABLE_REAL_S3` (default `false`).
- Develop and test with fakes, mocks and local Docker Postgres. Never create or change any AWS or LINE resource. Never claim a real integration works until the user has verified it.
- Each task carries a priority tag: **P0** (demo by 21 Nov), **P1** (if time), **P2** (after MVP). Tasks after the first checkpoint are listed so that the cut order reads from the bottom: cut task 20 first (CUT 1), then 19 (CUT 2), 18 (CUT 3), 17 (CUT 4), 16 (CUT 5). Tasks 21 and 22 are never cut.
- Property tests for the core safety properties (quantity control, permissions, idempotency, state machines, matching filters, webhook signature and dedup, assistant authority, units) are required. Only secondary tests are marked optional.
- Properties marked [DB] run against Docker Postgres with fewer runs. Pure properties use at least 100 runs and a tag comment `// Feature: agrimatch-mvp, Property N: <title>`.

## Tasks

- [x] 1. Monorepo scaffold and tooling [P0]
  - [x] 1.1 Create the workspace layout [P0]
    - Add root `package.json` with npm workspaces for `apps/api`, `apps/web`, `packages/contracts`, a base `tsconfig`, and `.gitignore` additions (local media directory, `.env`, build output)
    - Add `docker-compose.yml` with `postgres:16`, `.env.example` with fake values only, and root scripts `test`, `test:db`, `migrate`, `dev:api`, `dev:web`
    - Do not edit any existing Python file
    - _Requirements: 17.2, 18.6_
  - [x] 1.2 Create the API skeleton and config guards [P0]
    - `apps/api/src/server.ts`, `worker.ts`, Express app factory, Pino with redaction paths (authorization, cookie, x-line-signature, password, channel secrets, tokens, link codes, message text)
    - `config/env.ts` (Zod) and `config/guards.ts`: reject model IDs starting with `global.` or `apac.`, reject regions outside the allow-list, refuse mock adapters when `NODE_ENV=production`, default all `ENABLE_REAL_*` flags to false
    - `GET /healthz` prints each adapter `kind` (real or mock) and no secrets
    - _Requirements: 4.2, 4.3, 17.1, 17.2, 18.5, 18.7_
  - [x] 1.3 Configure test and lint tooling [P0]
    - Vitest and fast-check config (`npm test` for pure and unit, `npm run test:db` for Docker Postgres), ESLint, and dependency-cruiser (or eslint-plugin-boundaries) rules: `matching/` and `domain/` import nothing from `repos/`, `adapters/`, `http/`; only `services/` calls `authorize()` and opens transactions; routes, channels and assistant tools call services, not repos
    - _Requirements: 18.3_
  - [x] 1.4 Create the web skeleton and contracts package [P0]
    - Next.js App Router + Tailwind in `apps/web`; `next.config` rewrite `/api/:path*` to `${API_INTERNAL_URL}/:path*`; `WEB_ORIGIN` and `API_INTERNAL_URL` env; dev setup web `localhost:3000`, API `localhost:4000`
    - `packages/contracts` with shared Zod DTOs and the API error shape
    - _Requirements: 3.8, 16.7_
  - [ ]* 1.5 Write unit tests for the config guards [P0]
    - **Property 20: Adapter limits and config guard** (guard part)
    - For any model ID string, config loading fails iff it starts with `global.` or `apac.`; mock adapter refused in production; flags default to false
    - **Validates: Requirements 4.3, 18.7**

- [x] 2. Pure domain modules [P0]
  - [x] 2.1 Implement `domain/units` and distance [P0]
    - `Kg` and `Money` as branded `decimal.js` values, `toKg` for `kg` and `ton` only, `fromDb`/`toDb`, `normalizePriceToThbPerKg` (BALE and unknown units return null), Haversine (radius 6371.0088 km), `ROUND_HALF_UP`
    - _Requirements: 6.2, 6.3, 6.9, 9.7_
  - [x] 2.2 Write property test for units and decimals [P0]
    - **Property 1: Unit and decimal round trip**
    - **Validates: Requirements 6.2, 6.3, 6.9**
  - [ ]* 2.3 Write property test for Haversine [P0]
    - **Property 2: Haversine distance is a metric-like function**
    - **Validates: Requirements 9.7**
  - [x] 2.4 Implement `domain/permissions` [P0]
    - Capability matrix as data from spec section 4, `authorize(actor, capability, resource)` with ownership, receiver and published-view rules; cross-org returns not-found, role violation returns forbidden; service registry that records each service's declared capability
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_
  - [x] 2.5 Write property test for permissions [P0]
    - **Property 14: Permission checks hold for every actor, resource and channel** (pure matrix part; the database-unchanged part is in task 6.4)
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 14.4**
  - [x] 2.6 Implement state-machine tables [P0]
    - `domain/state/offer.ts` (PENDING to ACCEPTED, REJECTED, WITHDRAWN, EXPIRED), `draft.ts` (DRAFT, AWAITING_REVIEW, PUBLISHED, PAUSED, CLOSED, CANCELLED), `agreement.ts`; pure `next(state, event)`; no DELIVERED, PAID or COMPLETED state
    - _Requirements: 5.7, 11.3, 12.10, 13.4, 19.4_
  - [x] 2.7 Write property test for the offer state machine [P0]
    - **Property 11: Offer state machine and expiry**
    - **Validates: Requirements 11.2, 11.3, 11.6, 11.7, 11.8**
  - [x] 2.8 Write property test for the draft state machine [P0]
    - **Property 12: Draft and listing state machine with versions** (pure part; the publish idempotence part is in task 6.3)
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 14.6**

- [x] 3. Matching engine (pure) [P0]
  - [x] 3.1 Define matching types and rule config [P0]
    - `matching/types.ts`, `matching/rules/v1.ts` (weights from spec, `maxTransportKm=80`, version string), Zod validation at startup (weights non-negative and each group sums to 1)
    - _Requirements: 10.1, 10.2, 10.3, 9.11_
  - [x] 3.2 Implement the filter stage [P0]
    - Ordered exclusion codes: NOT_PUBLISHED, NO_REMAINING, SAME_ORG, MATERIAL_MISMATCH (OTHER excluded), FORM_MISMATCH, BELOW_MIN_LOT, WINDOW_NO_OVERLAP, AREA_MISMATCH, OVER_RADIUS, OVER_MAX_TRANSPORT (routes 1, 2, 4 only, hard exclusion when both coordinates known)
    - Missing input never excludes; it yields `NEEDS_CONFIRMATION(field)` or `DISTANCE_UNVERIFIED` and tier 1
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8, 9.11, 6.7_
  - [x] 3.3 Implement scoring, ranking and explanations [P0]
    - Trade and baling components with renormalized weights, `weightCoverage`, NEGOTIABLE price as unknown, ranking by (tier, score desc, stable id), `reasons[]` in fixed order, Thai renderer saying "ระยะเส้นตรง", all four routes
    - _Requirements: 9.7, 9.9, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [x] 3.4 Write property test for filters and the 80 km cap [P0]
    - **Property 3: Filter soundness and cap**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.11, 6.7**
  - [x] 3.5 Write property test for missing data [P0]
    - **Property 4: Missing data never counts as a pass**
    - **Validates: Requirements 9.6, 9.8, 10.5**
  - [ ]* 3.6 Write property test for scoring [P0]
    - **Property 5: Scoring equals an independent renormalized weighted sum**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.8, 6.5**
  - [ ]* 3.7 Write property test for determinism and ranking [P0]
    - **Property 6: Matching is deterministic and order independent, and ranks complete pairs first**
    - **Validates: Requirements 10.5, 10.6**
  - [ ]* 3.8 Write property test that the engine fabricates nothing [P0]
    - **Property 7: The engine fabricates nothing**
    - **Validates: Requirements 9.9, 9.10, 14.9, 17.5**
  - [ ]* 3.9 Write property test for rule config validity [P0]
    - **Property 8: Rule config validity**
    - **Validates: Requirements 10.3**

- [x] 4. Database, migrations and repositories [P0]
  - [x] 4.1 Write identity and auth migrations [P0]
    - node-pg-migrate SQL: `organizations`, `users`, `memberships`, `sessions` (token hash only), `line_identities`, `line_link_codes` (code hash only), with the constraints in `design.md`
    - _Requirements: 1.5, 3.1, 3.5, 3.7, 17.1_
  - [x] 4.2 Write business-table migrations [P0]
    - `material_listings`, `purchase_demands`, `baling_services`, `baling_requests`, `drafts`, `offers`, `agreements`, `quantity_ledger`, `resale_allocations`, `media`, `image_assessments`, `matches`, `conversations`, `messages`, `idempotency_keys`; CHECK constraints for quantity balance, price shape, resale cap, kind/status; no float columns; `is_demo` flags
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.8, 7.1, 7.3, 7.4, 12.5, 14.5_
  - [x] 4.3 Write infrastructure-table migrations [P0]
    - `webhook_events` (unique channel and event ID), `jobs`, `notification_outbox` (unique dedupe key), `audit_logs` with append-only trigger and revoked update/delete
    - _Requirements: 2.4, 2.5, 2.9, 15.1, 15.5, 17.3_
  - [x] 4.4 Implement the pg pool, transaction helper and repositories [P0]
    - Parameterized SQL only, Zod row schemas, decimals as strings, `withTransaction` retrying on `40P01` and `40001` up to 3 times, lock helpers ordered by (table, id)
    - _Requirements: 12.3, 12.5, 17.7_
  - [x] 4.5 Build the DB integration test harness [P0]
    - Uses `TEST_DATABASE_URL` from the Docker Postgres, applies migrations from scratch, isolates tests, exposes helpers to open several pool connections
    - _Requirements: 18.3_
  - [x] 4.6 Write database backstop tests [P0]
    - With raw SQL (bypassing services) assert that CHECK and UNIQUE constraints reject: unbalanced quantity, negative remaining, duplicate agreement per offer, duplicate ledger row, resale over-allocation, update or delete on `audit_logs`
    - _Requirements: 12.5, 12.8, 14.5, 17.3_

- [x] 5. Authentication, sessions and link codes [P0]
  - [x] 5.1 Implement login, sessions and CSRF [P0]
    - Argon2id with a dummy verify for unknown emails, in-memory rate limit, random 256-bit session token stored as sha256, cookie `agrimatch_sid` HttpOnly, SameSite=Lax, Secure when `NODE_ENV=production`, `GET /me` with `csrf_secret`, CSRF middleware (Origin equals `WEB_ORIGIN` plus `X-CSRF-Token`), `trust proxy`; webhook routes exempt
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 17.1_
  - [x] 5.2 Implement link codes and actor resolution [P0]
    - Code generation (8 chars, unambiguous alphabet, hash only, TTL from config), atomic redemption, identical generic failure for wrong channel, expired, used and unknown; actor built only from a session or a verified channel and `line_identities`; unlinked identities get no organization rights
    - _Requirements: 1.5, 1.6, 1.7, 3.1, 3.2, 3.3, 3.4_
  - [ ]* 5.3 Write property test for link code redemption [P0]
    - **Property 18: Link code redemption**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [ ]* 5.4 Write unit tests for cookie flags, CSRF and same-origin [P0]
    - Cookie attributes in production and development, missing or wrong Origin rejected, missing token rejected, the rewrite config forwards `/api/*`, no password or code in logs
    - _Requirements: 3.5, 3.6, 3.7, 3.8_

- [x] 6. Service layer: drafts, publishing and CRUD [P0]
  - [x] 6.1 Create the service foundation [P0]
    - `Result<T, AppError>` with stable error codes, `authorize`-first wrapper, audit log helper, idempotency-key store, service registry check that fails when a service has no capability
    - _Requirements: 1.1, 5.1, 17.3_
  - [x] 6.2 Implement draft, listing, demand, baling service and baling request services [P0]
    - Draft create/patch with `expectedVersion`, completeness check, `AWAITING_REVIEW`, publish with version check and idempotent result, creation of listing, demand, baling service or request from a draft, pause, close, open; enqueue `recompute_matches`; NEGOTIABLE stored as NULL price; OTHER material kept out of matching
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.5, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 6.3 Write property test for publish versions and idempotence [P0]
    - **Property 12: Draft and listing state machine with versions** (service part against Postgres)
    - Publishing a stale version creates nothing; publishing the same version twice yields one row
    - **Validates: Requirements 5.4, 5.5, 5.8, 14.6**
  - [x] 6.4 Write permission integration tests across services [P0]
    - **Property 14: Permission checks hold for every actor, resource and channel** (database part)
    - Every registered service is called by every role and from channels web, LINE and assistant; denied calls leave the database unchanged; cross-org ids look the same as missing ids
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 14.4**
  - [x] 6.5 Expose REST routes for drafts, listings, demands and baling [P0]
    - Zod-validated bodies, decimals as strings, error shape `{ error: { code, message_th } }`, `Idempotency-Key` on publish
    - _Requirements: 7.2, 16.1, 16.2_

- [x] 7. Match persistence [P0]
  - [x] 7.1 Implement the `recompute_matches` job [P0]
    - SQL pre-filter by status, material and remaining quantity, call the pure engine, upsert on `(route, supply_id, demand_id, rule_version)`, delete pairs that no longer pass, store `supply_version` and `demand_version`, hide stale rows
    - _Requirements: 7.7, 9.1, 10.3, 14.10_
  - [ ]* 7.2 Write property test for recompute idempotence [P0]
    - **Property 22: Recompute idempotence** [DB]
    - **Validates: Requirements 7.7**
  - [x] 7.3 Implement `GET /matches` with the visibility mapper [P0]
    - Returns only the actor's side and published counterparty fields; no contact data, exact private address or farmer identity; includes components, reasons, missing data, rule version and the demo-weights label
    - _Requirements: 9.10, 10.7, 14.9, 16.4, 17.5_
  - [ ]* 7.4 Write unit tests for the match response mapper [P0]
    - Counterparty contact and identity fields never appear in the payload
    - _Requirements: 9.10, 17.5_

- [x] 8. Offers, accept transaction and agreements [P0]
  - [x] 8.1 Implement the offer service [P0]
    - Create with listing and demand version snapshots, transport cost stored separately from the total, default expiry from config, reject, withdraw, edit as withdraw plus create in one transaction, expiry sweeper, outbox rows inside the transaction, audit log
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 15.1_
  - [x] 8.2 Implement the accept-offer transaction [P0]
    - Lock offer then supply and demand rows by (table, id); repeat accept returns the existing agreement; re-check expiry, versions, remaining quantity, minimum lot and receiver rights; insert agreement, ledger rows, update committed and remaining, close at 0, outbox rows, audit; one receiver acceptance completes the offer for every kind; insufficient quantity returns `409 INSUFFICIENT_QUANTITY` and the offer stays `PENDING`; `BALING_SERVICE` offers write no quantity
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 8.3 Write property test for quantity conservation [P0]
    - **Property 9: Quantity conservation under any accept sequence** [DB]
    - **Validates: Requirements 6.8, 12.3, 12.5, 12.6, 12.7, 12.9, 13.2**
  - [x] 8.4 Write property test for accept idempotence [P0]
    - **Property 10: Accept is idempotent** [DB]
    - **Validates: Requirements 12.8, 13.5**
  - [x] 8.5 Write concurrency and atomicity tests [P0]
    - `Promise.all` accepts over separate connections never oversell; insufficient quantity leaves the offer `PENDING`; fault injection after the ledger insert persists nothing; two accepts in opposite lock order do not deadlock permanently
    - _Requirements: 12.4, 12.5, 12.7_
  - [ ]* 8.6 Write unit tests for offer edge cases [P0]
    - Expiry boundary, edit creates a new offer, transport cost excluded from total, stale listing version
    - _Requirements: 11.2, 11.6, 11.7, 12.3_
  - [x] 8.7 Expose REST routes for offers and agreements [P0]
    - `POST /offers`, `GET /offers`, accept, reject, withdraw, `GET /agreements`, `GET /agreements/:id`; state-changing routes need CSRF
    - _Requirements: 11.4, 12.11, 16.5_

- [x] 9. LINE gateway, jobs and outbox [P0]
  - [x] 9.1 Implement the jobs runner, outbox sender and `LineClient` port [P0]
    - `SKIP LOCKED` pickup with lease, attempts and backoff with jitter, terminal `DEAD`; outbox sender with dedupe key and `X-Line-Retry-Key`; `FakeLineClient` recording channel, token and body; sender never changes offers or agreements
    - _Requirements: 2.8, 2.9, 15.2, 15.3, 15.4, 15.5_
  - [ ]* 9.2 Write property test for retry behaviour [P0]
    - **Property 17: Job and outbox retry behaviour**
    - **Validates: Requirements 2.9, 15.3, 15.4, 15.5**
  - [x] 9.3 Implement the webhook routes [P0]
    - `/webhooks/line/farmer|baler|factory`, `express.raw` before JSON, HMAC-SHA256 base64 with `timingSafeEqual`, 401 on bad or missing signature with no parse and no insert, Zod parse, one transaction inserting `webhook_events` and `jobs`, 200 on duplicates and on empty `events`, no Bedrock call in the request
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 9.4 Write property test for webhook signatures [P0]
    - **Property 15: Webhook signature round trip and tamper detection**
    - **Validates: Requirements 2.2**
  - [x] 9.5 Write property test for webhook dedup [P0]
    - **Property 16: Webhook deduplication** [DB], including concurrent delivery
    - **Validates: Requirements 2.5**
  - [x] 9.6 Implement the postback codec and message builders [P0]
    - `encodePostback`/`decodePostback` with Zod and size limit; builders for draft review (confirm, edit, keep draft), offer card (quantity, price, price unit, transport, accept and reject), agreement notice with the "not payment, delivery or quality" text, estimate labels
    - _Requirements: 5.2, 11.9, 12.11, 19.2_
  - [ ]* 9.7 Write property test for the postback codec [P0]
    - **Property 23: LINE postback codec round trip**
    - **Validates: Requirements 11.9, 2.4**
  - [x] 9.8 Implement the farmer channel handler [P0]
    - `follow` creates the identity and the personal FARMER organization (default A7); text routes to the assistant job; postbacks call services with the actor; role allow-list; replies only through the channel's own client; a farmer completes list, offer and accept entirely in LINE
    - _Requirements: 1.5, 2.6, 2.7, 2.8, 16.9_
  - [x] 9.9 Implement `HttpLineClient` (real, disabled) [P0]
    - Messaging API reply and push with per-channel token, retry key and 429 handling; selected only when `ENABLE_REAL_LINE=true` and all secrets and tokens are present; unit tests with a stubbed HTTP layer only; no network call to LINE
    - _Requirements: 2.8, 15.5, 18.7_
  - [x] 9.10 Implement minimal baler and factory handlers [P0]
    - Link-code prompt for unlinked users, offer notifications, accept and reject postbacks, text fallback to the assistant; full menus come in task 18
    - _Requirements: 1.5, 3.2, 11.9, 15.2_

- [x] 10. Assistant and Bedrock port [P0]
  - [x] 10.1 Define the Bedrock port, mock adapter and output schemas [P0]
    - `BedrockPort` with `kind`, `AssistantTurnSchema` (strict), per-draft-kind patch whitelist, quantity patches limited to `kg` and `ton`, mock adapter exported only from test-support with scripted responses (malformed JSON, injection text, timeout, unsupported image)
    - _Requirements: 4.2, 4.5, 4.6, 4.10_
  - [x] 10.2 Implement the assistant orchestrator [P0]
    - Context loaded by actor only, closed draft-only tool set (no publish, send, accept, confirm or cancel), user text and history only in user turns, one repair retry then a clarifying question, Baler ambiguity question, history window from config, match explanations rendered from backend `reasons[]`, "unknown" when no data
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.12, 5.1, 19.3_
  - [x] 10.3 Write property test for assistant output validation [P0]
    - **Property 19: Assistant output validation and authority**
    - **Validates: Requirements 4.5, 4.6, 4.10, 5.1**
  - [x] 10.4 Implement the real Bedrock adapter (disabled) [P0]
    - `ConverseCommand` in `ap-southeast-1`, `maxTokens` and timeout on every call, SDK `maxAttempts=1` plus own bounded retry for timeout, throttle and 5xx only, no retry for access denied or unsupported model; used only when `ENABLE_REAL_BEDROCK=true`; tested with a stubbed SDK client; no AWS call
    - _Requirements: 4.2, 4.3, 4.4, 18.7_
  - [x] 10.5 Implement the degraded step-form mode [P0]
    - Fixed question lists per draft kind, quick replies for enums, deterministic parsers for amounts such as "5 ตัน", automatic switch when `AI_MODE=disabled` or Bedrock fails after retries; matching and offers unaffected
    - _Requirements: 4.11, 6.9, 16.9_
  - [ ]* 10.6 Write property test for adapter limits [P0]
    - **Property 20: Adapter limits and config guard** (retry, token limit, history window)
    - **Validates: Requirements 4.3, 4.4, 4.12**

- [x] 11. Dashboard pages [P0]
  - [x] 11.1 Build the web foundation [P0]
    - Server-side API client forwarding the cookie through `/api`, CSRF header helper, mobile-first layout at 360 px with card lists instead of wide tables, `Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok' })`, shared components for estimate label, demo-weights label and disclaimers
    - _Requirements: 6.4, 16.1, 16.7, 19.2_
  - [x] 11.2 Build `/login` and `/settings/line` [P0]
    - Login form, logout, link-code generation with expiry display
    - _Requirements: 3.1, 3.5_
  - [x] 11.3 Build demand and baling service forms [P0]
    - `/demands`, `/demands/new`, `/demands/[id]` for BALER and BUYER_FACTORY; `/services` for BALER; demand and service shown separately
    - _Requirements: 7.2, 7.5, 16.2, 16.3_
  - [x] 11.4 Build match pages [P0]
    - `/matches`, `/matches/[id]` with reasons, component scores, missing data, "ระยะเส้นตรง" and the demo-weights label
    - _Requirements: 9.7, 10.7, 16.4_
  - [x] 11.5 Build offer and agreement pages [P0]
    - `/offers`, `/offers/[id]` (send, accept, reject, history), `/agreements`, `/agreements/[id]` with the "not payment, delivery or quality" notice and correct remaining quantity
    - _Requirements: 12.11, 16.5, 19.4_
  - [ ]* 11.6 Write component tests for notices and labels [P0]
    - Estimate label, demo-weights label, agreement notice, assessment disclaimer present in rendered output
    - _Requirements: 8.6, 10.7, 12.11, 19.2_

- [x] 12. Baling service story (story 2) [P0]
  - [x] 12.1 Implement the baling offer and agreement flow [P0]
    - Provider and request publishing from the Dashboard, route 3 matching, `BALING_SERVICE` offer, single receiver acceptance creates `SERVICE_CONFIRMED`, no ownership change, no quantity change, kept apart from purchase agreements in data and screens
    - _Requirements: 7.3, 7.4, 7.6, 9.1, 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ]* 12.2 Write unit tests for the baling flow [P0]
    - Repeat accept returns the same agreement, listing and demand quantities unchanged, farmer can still sell directly
    - _Requirements: 7.6, 13.2, 13.5_

- [x] 13. Image upload and assessment, farmer path [P0]
  - [x] 13.1 Implement the `MediaStore` port and adapters [P0]
    - `LocalFsMediaStore` (git-ignored directory, app-signed short-lived URLs, refuses production) and `S3MediaStore` (private, SSE, presigned GET, role credentials) written but used only when `ENABLE_REAL_S3=true`; storage keys never returned to clients
    - _Requirements: 8.2, 17.6, 18.7_
  - [x] 13.2 Implement upload and assessment [P0]
    - Owner check, magic-byte sniffing for JPEG and PNG, size limit, sha256, `assess_image` job, `ImageAssessor` on the Bedrock vision port (mock by default, `VISION_ENABLED=false`), result schema without moisture, heating value or grade, post-validator that strips such claims, statuses OK, UNASSESSABLE, UNAVAILABLE, FAILED, fixed `disclaimer_th`, listing publishable in every status
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_
  - [x] 13.3 Add the farmer LINE image path [P0]
    - Image event downloads through the channel client, stores, attaches to the active draft, and shows the assessment with the disclaimer in LINE
    - _Requirements: 8.1, 8.6, 8.8_
  - [ ]* 13.4 Write property test for image constraints [P0]
    - **Property 21: Image upload and assessment constraints**
    - **Validates: Requirements 8.1, 8.4, 8.6, 8.7**

- [x] 14. Seed data and stories 1 and 2 end to end [P0]
  - [x] 14.1 Write the repeatable demo seed [P0]
    - `db/seeds`: at least 2 farmers, 1 baler, 2 downstream factories, matching and non-matching listings and demands, every row `is_demo=true`, no real names, phones, addresses or LINE IDs
    - _Requirements: 18.1, 18.2_
  - [x] 14.2 Write end-to-end tests for story 1 and story 2 [P0]
    - Run through the webhook with locally signed payloads, `FakeLineClient` and the mock Bedrock: direct sale with partial quantity, offer rejection, price mismatch, no coordinates, stale draft version, baling service agreement
    - _Requirements: 18.3, 18.4_

- [ ] 15. Checkpoint - core safety floor
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Resale story (story 3) [P0, CUT 5: last cut in the P0 group]
  - [x] 16.1 Implement resale draft and allocation [P0]
    - Only a BALER of the agreement's buyer organization can create the draft; lock the source agreement, check `resale_reserved_kg + requested <= qty`, upsert `resale_allocations`, release on discard, close or cancel; own location, no farmer contact copied
    - _Requirements: 14.1, 14.2, 14.4, 14.5, 14.9_
  - [x] 16.2 Write property test for resale allocation [P0]
    - **Property 13: Resale allocation never exceeds the source agreement** [DB]
    - **Validates: Requirements 14.4, 14.5, 14.11**
  - [x] 16.3 Implement resale publishing, route 4 and downstream accept [P0]
    - `pending_material` with required `expected_ready_at`, assistant questions for resale fields, publish triggers route 4, buyer must send `ack_pending_material=true`, downstream accept creates a new `PURCHASE` agreement referencing the source agreement, no automatic received or baled status
    - _Requirements: 14.2, 14.3, 14.6, 14.7, 14.8, 14.10, 14.11, 14.12_
  - [x] 16.4 Build the resale Dashboard pages and LINE button [P0]
    - `/resale`, `/resale/[draftId]`, "สร้างประกาศขายต่อ" on agreements of a BALER buyer in the Dashboard and LINE
    - _Requirements: 14.1, 16.3_
  - [x] 16.5 Write the end-to-end test for story 3 [P0]
    - Farmer sells to a baler, baler creates and publishes a resale draft, downstream factory accepts with acknowledgement; asserts quantities, allocation and linked agreements
    - _Requirements: 14.12, 18.4_

- [ ] 17. Baling request through the assistant chat [P0, CUT 4]
  - [ ] 17.1 Add the `baling_request` conversational flow [P0]
    - Assistant tool patches a baling-request draft; confirmation buttons in LINE; on cut, keep the Dashboard provider side and the step-form questions only
    - _Requirements: 4.1, 4.7, 7.4_
  - [ ]* 17.2 Write unit tests for the baling-request flow [P0]
    - Ambiguous baler intent triggers a question, no draft is created before the answer
    - _Requirements: 4.7_

- [ ] 18. Full LINE menus for BUYER_FACTORY [P0, CUT 3]
  - [ ] 18.1 Implement the factory menu flows [P0]
    - Text and quick-reply menus for demand creation, matches and offers per spec 5.3; unfinished entries are not shown as usable
    - _Requirements: 16.8, 16.9_
  - [ ]* 18.2 Write unit tests for the factory menus [P0]
    - Menu items map to existing services and use the factory channel only
    - _Requirements: 2.8, 16.8_

- [ ] 19. Image assessment for other roles [P1, CUT 2]
  - [ ] 19.1 Extend the image path to BALER and BUYER_FACTORY [P1]
    - Reuse the upload and assessment services; show source and time for any pre-baling image on a resale listing
    - _Requirements: 8.1, 14.8_

- [ ] 20. Remaining P1 and P2 features [P1/P2, CUT 1: first to cut]
  - [ ] 20.1 Dashboard overview and organization and member settings [P1]
    - `/`, `/settings/org`, `/settings/members`
    - _Requirements: 3.1, 16.1_
  - [ ] 20.2 Assistant page on the Dashboard [P1]
    - `/assistant` with the same actor and data scope as LINE
    - _Requirements: 16.6_
  - [ ] 20.3 Rich menu and Flex Message builders [P1]
    - Builders and a setup script that does not run against LINE by default
    - _Requirements: 16.8_
  - [ ] 20.4 Conversation summary [P1]
    - Summarize history beyond the window and send the summary instead of old messages
    - _Requirements: 4.12_
  - [ ] 20.5 Source-agreement cancellation handling [P1]
    - Pause dependent resale listings, mark downstream agreements `NEEDS_REVIEW`, queue notifications, delete nothing
    - _Requirements: 14.13_
  - [ ] 20.6 Map and filters [P2]
    - Leaflet map and match filters on the Dashboard
    - _Requirements: 16.4_

- [ ] 21. Acceptance report, infrastructure for review and hand-over [P0]
  - [x] 21.1 Write the acceptance report script [P0]
    - Prints each checklist item of spec section 17 as `PASS (real)`, `PASS (mock)` or `NOT DONE`, reading each value from the adapter `kind`; lists every cut task; a mock-backed pass is never reported as real
    - _Requirements: 18.5, 18.6_
  - [ ] 21.2 Write the S3 and IAM infrastructure file for review [P0]
    - `infra/` CloudFormation (or CDK) for a private S3 bucket in `ap-southeast-1` (block public access, SSE, lifecycle) and a least-privilege IAM policy for the media prefix and `bedrock:InvokeModel` on `anthropic.claude-sonnet-5`; follow `aws.md` and the AWS skill before writing; validate locally only (lint or synth); do NOT deploy and do not call AWS create or update APIs
    - _Requirements: 17.6, 17.8, 18.8_
  - [x] 21.3 Write `docs/HANDOVER.md` [P0]
    - Checklist of exactly what the user must connect, with exact names:
      - each LINE OA channel secret and access token (farmer, baler, factory) and the webhook URL per role (`/webhooks/line/farmer|baler|factory`)
      - public HTTPS URL for the API and for the web origin, `WEB_ORIGIN`, `API_INTERNAL_URL`, and the same-origin `/api/*` rewrite in production
      - `DATABASE_URL`, `SESSION_SECRET`, and every env var name in `.env.example`
      - AWS role or credentials, region `ap-southeast-1`, Bedrock model ID `anthropic.claude-sonnet-5`, the vision model check (`BEDROCK_VISION_MODEL_ID`, `VISION_ENABLED`), never `global.` or `apac.`
      - S3 bucket name, the reviewable IaC file from 21.2 and the IAM policy; the user reviews and deploys; owner and approver is an open hand-over item
      - how to flip `ENABLE_REAL_LINE`, `ENABLE_REAL_BEDROCK`, `ENABLE_REAL_S3`
      - smoke-test commands for `/healthz`, LINE signature check, one Converse call, one S3 put and presign
      - status table: each feature marked verified with fakes, verified against Docker Postgres, or not verified against the real service; list of cut tasks; open items (privacy policy, LIFF not used, `packages/contracts` default)
    - Do not claim any real integration works
    - _Requirements: 18.5, 18.6, 18.7, 18.8_

- [ ] 22. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Match notifications, no-match farmer flow and retiring demo postings [P0]
  - [x] 23.1 Add in-app notifications (bell) for Dashboard organizations [P0]
    - Migration `notifications` with a unique constraint per org, kind, supply and demand
    - Create rows in the matching recompute for NEW match pairs only (existing pairs never notify again)
    - API `GET /notifications`, mark-read and read-all, each behind permission checks scoped to the caller's organization
    - Web bell in the top bar with unread badge, 30 s polling, panel, mark-read, navigation to `/matches/:id`
    - _Requirements: 9, 15, 16_
  - [x] 23.2 Send the farmer LINE result after publish [P0]
    - One outbox push per listing version: matches > 0 gives a summary; matches = 0 gives «ยังไม่มีผู้รับซื้อที่ตรงเงื่อนไข» with up to 3 deterministic tips built from the listing's own data
    - Postback quick replies «เปิดประกาศไว้» and «ปิดประกาศ»; closing goes through the lifecycle service and is idempotent
    - A later new match sends one farmer push per pair
    - _Requirements: 2, 5, 9, 15_
  - [x] 23.3 Retire demo postings without deleting [P0]
    - Script that closes seed-created listings, demands, baling services and requests (`seed.demo` markers, `is_demo`), never touches user rows or accounts, and is repeatable
    - Hosted one-off task mode `retire-demo` and its commands in `infra/hosting/aws-runtime.py`
    - Replace the wording «ค่าเริ่มต้นสำหรับเดโม» with «น้ำหนักคะแนนเริ่มต้น» and keep «ประมาณการ»
    - _Requirements: 18, 19_
  - [x] 23.4 Write tests for 23.1 to 23.3 and run full local verification [P0]
    - Use `FakeLineClient`, `MockBedrock`, the DB harness and a web component test for the bell
    - Run the full local test suite, typecheck and lint
    - _Requirements: 9, 18_

- [x] 24. Dashboard forms use pick lists instead of free text [P0]
  - [ ] 24.1 Replace free-text fields with dropdowns or checkboxes on every Dashboard posting form [P0]
    - Demand, sale and resale listing, baling service and baling request forms (new and edit)
    - Province: dropdown of the 77 Thai provinces from the existing province data; pilot provinces (อุตรดิตถ์, นครสวรรค์, กำแพงเพชร) listed first
    - District: dropdown that depends on the chosen province, with district lists for the 3 pilot provinces; other provinces show a disabled «ไม่ระบุ» option because no district data exists yet
    - Radius: dropdown 10, 20, 30, 40, 50, 60, 70, 80 km (80 km hard cap)
    - Accepted and service provinces: multi-select checkboxes from the province list (max 10), not comma text
    - Keep typed inputs only for prices and quantity numbers; units stay as dropdowns
    - Existing saved values that are not in a list still display and save unchanged
    - Component tests for each changed form; run lint, typecheck, web and API tests
    - _Requirements: 1, 3, 20_

- [x] 25. Role chooser before login [P0]
  - [x] 25.1 Add a farmer or factory choice in front of the Dashboard login form [P0]
    - `/login` first shows two large icon buttons «เกษตรกร» and «โรงงาน / ผู้รับซื้อ»
    - Farmer: QR code and add-friend button for the farmer LINE OA (`https://line.me/R/ti/p/@642ctpqm`), short steps, no login form
    - Factory: QR code and add-friend button for the factory LINE OA (`https://line.me/R/ti/p/@241sxehz`) plus the existing email login form on the same screen
    - QR rendered locally as SVG (no third-party QR web service); OA IDs come from config with these defaults
    - Back button to the choice; a `?role=` query keeps the choice on reload; the existing login, redirect and CSRF behaviour are unchanged
    - Component tests for both paths; run lint, typecheck, web and API tests
    - _Requirements: 14, 20_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required property tests cover quantity control (9, 10, 13), permissions (14), idempotency (10, 16), state machines (11, 12), matching filters (3, 4), webhook signature (15), assistant authority (19) and units (1).
- Each task references specific requirements for traceability. Tasks 16 to 20 are in reverse cut order: if time runs out, cut 20, then 19, 18, 17, 16. Record every cut in the acceptance report (task 21.1) and `docs/HANDOVER.md`.
- Properties 9, 10, 13, 16 and 22 run against Docker Postgres. All other properties are pure.
- The existing Python demo and its tests stay unchanged.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "2.1", "2.4", "2.6", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.7", "2.8", "3.2", "4.2", "4.3"] },
    { "id": 4, "tasks": ["3.3", "4.4", "4.5", "10.1"] },
    { "id": 5, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "4.6", "5.1", "10.4", "13.1"] },
    { "id": 6, "tasks": ["5.2", "5.4", "6.1", "9.1", "9.6", "10.6"] },
    { "id": 7, "tasks": ["5.3", "6.2", "9.2", "9.3", "9.7", "11.1", "13.2"] },
    { "id": 8, "tasks": ["6.3", "6.4", "6.5", "7.1", "8.1", "9.4", "9.5", "9.9", "10.2", "11.2", "13.4"] },
    { "id": 9, "tasks": ["7.2", "7.3", "8.2", "10.3", "10.5", "11.3", "14.1"] },
    { "id": 10, "tasks": ["7.4", "8.3", "8.4", "8.5", "8.6", "8.7", "9.8", "11.4", "16.1"] },
    { "id": 11, "tasks": ["9.10", "11.5", "12.1", "13.3", "16.2", "16.3"] },
    { "id": 12, "tasks": ["11.6", "12.2", "14.2", "16.4", "17.1", "18.1", "20.1", "20.2", "20.5", "20.6"] },
    { "id": 13, "tasks": ["16.5", "17.2", "18.2", "19.1", "20.3", "20.4"] },
    { "id": 14, "tasks": ["21.1", "21.2"] },
    { "id": 15, "tasks": ["21.3"] },
    { "id": 16, "tasks": ["23.1", "23.3"] },
    { "id": 17, "tasks": ["23.2"] },
    { "id": 18, "tasks": ["23.4"] }
  ]
}
```
