# Changelog

## 2026-11-22

- Added encrypted institution customer and beneficiary records with environment scoping, masked payout destinations, pending-verification defaults, and API-key scoped endpoints. No customer is marked verified and no payout is initiated without provider evidence.
- Added institutional sandbox quote and transaction-request workflows, monthly operational usage visibility, and customer/beneficiary workspace pages. Usage is explicitly not a billing statement.

- Closed transaction lifecycle bypasses so funded transactions must enter compliance review before approval, and transactions under review cannot move directly to approval or execution.
- Added durable outbox events for transaction status changes.
- Made transaction idempotent replays report the transaction's current status instead of always returning `CREATED`.
- Added content fingerprinting for ledger postings; an identical retry returns the original posted journal, while a conflicting reuse is rejected.
- Added focused state-machine regression tests.
- Added institution- and environment-scoped operational account provisioning, tenant-scoped account reads, raw posted debit/credit totals, and active hold totals.
- Added account creation audit/outbox records and deterministic duplicate-create behavior.
- Applied migrations 008 and 009 to the local PostgreSQL database.
- Added tenant/environment-scoped recent transaction listing and lifecycle history reads.
- Verified account create/list/replay and transaction create/list/history/current-state replay over the local HTTP API; verified the database rejects a direct `FUNDED` to `APPROVED` transition.
- Added short-lived sandbox-only quotes with configured integer ratios, tenant/environment isolation, audit/outbox records, and atomic single-use quote consumption into a `QUOTED` transaction. Production quoting returns unavailable until a real provider is configured.
- Verified sandbox quote creation and quote consumption over the local HTTP API.
- Added an append-only compliance decision record and a database trigger requiring a decision that matches the transaction environment before approval.
- Added a sandbox-only funding/compliance simulation endpoint; outcomes are explicitly simulated, configurable, and default to `REVIEW`.
- Added a durable outbox fan-out worker, webhook endpoint management, one-time HMAC signing secrets encrypted at rest, allowlisted HTTPS destinations, retry/backoff, and delivery logs.
- Added owner/admin API key listing, creation, one-time token reveal, and revocation endpoints with transactional audit logging.
- Applied migrations 010, 011, and 012 to the local PostgreSQL database; verified the outbox worker drains pending events when no endpoints are configured.
- Verified sandbox simulated compliance approval passes the database gate and records lifecycle history.
- Added account normal-balance semantics, available balance calculation, balance-backed idempotent holds, atomic hold capture, release, and linked journal reversals.
- Added a disposable-database ledger integration test covering balances, hold replay, overspend rejection, capture, reversal, and replay.
- Applied migration 013 to the local PostgreSQL database and verified the ledger integration test against a fresh migrated PostgreSQL database.
- Added provider attempt and reconciliation batch/observation schemas plus an idempotent reconciliation matcher for matched, variance, unmatched, and pending evidence.
- Strengthened compliance enforcement so the newest decision supersedes older decisions and production requires latest live ALLOW decisions for all mandatory check types before approval and execution.
- Added disposable-database compliance and reconciliation integration tests; migrations 014 through 016 are applied locally.
- Added authenticated dashboard data for institution overview, account balances, transaction history, active environment, team, and API credential counts.
- Added institutional API credential management UI with one-time secret reveal and revocation.
- Added owner/admin sandbox webhook endpoint and delivery management UI; dashboard-only webhook routes bind to the active sandbox environment.
- Updated project documentation to reflect the implemented sandbox infrastructure and remaining live-provider work.
- Verified the NestJS app boots and reports PostgreSQL readiness on a non-default port; the default port was already occupied by another local process.
- Added normalized provider contracts for banking, FX/liquidity, custody, blockchain, and compliance operations. No concrete live adapter is registered; the registry fails closed without one.
- Added separately scoped internal administrator grants, privileged grant/revoke commands, audited operational views, and provider metadata configuration that stores secret references only.
- Added internal platform operations and developer guide pages to the dashboard application.
- Applied migration 017 and reran all state-machine, ledger, compliance, and reconciliation tests successfully against the migrated disposable PostgreSQL database.
- Added an authenticated transaction operations workspace with scoped search, status filters, pagination, exact minor-unit display, and lifecycle/compliance/provider/ledger/reconciliation detail.
- Added institution team invitation and revocation UI, invitation link handoff, and a shared responsive dashboard navigation shell with sign-out.
- Refined brand tokens to the agreed charcoal, cloud white, electric lime, and selective hot pink; reduced dashboard card elevation and removed decorative gradient grids.
- Added an institution-authenticated accounts API for dashboard list/detail and owner/admin provisioning, plus account balance and ledger-total screens.
- Fixed the overview navigation links for accounts and team; rebuilt the overview with a shared shell, compact workspace summary, recent activity, and direct operational links.
- Added a developer sandbox console for configured quotes and idempotent transaction request creation, with API keys entered per operation and no key persistence.
- Added BFF routes for the account and sandbox developer workflows.
- Added transaction activity report exports with date filtering and explicit 100-record coverage limits.
- Separated the externally documented API origin from the dashboard’s internal API service URL for production developer instructions.
- Extended restricted platform operations with a recent cross-institution transaction view.
- Added a tenant-scoped compliance review screen that lists each transaction and its latest append-only check decisions.

## 2026-11-19

- Added initial product architecture and delivery plan for the empty repository.
- Selected NestJS as the primary API, PostgreSQL as the database per the opening project direction, and Python only for bounded supporting workloads.
- Recorded the brand palette hierarchy: Ink Black foundation, Lime for important actions and positive/active states, and Hot Pink for selective highlights.
- Added the preferred TREAD tagline: “Move money. Without borders.”
- Bootstrapped the NestJS API with environment validation, `/v1` routing, non-production OpenAPI, security headers, PostgreSQL readiness, and initial domain module boundaries.
- Added local PostgreSQL Compose configuration and developer startup instructions.
- Added PostgreSQL migrations for institutions, environments, memberships, API credentials, assets, transaction lifecycle, idempotency, ledger, holds, audit, and outbox records.
- Added guarded transaction lifecycle transitions, a balanced immutable ledger posting service, scoped API key authentication, and sandbox transaction create/read endpoints.
- Added a development-only sandbox institution/key seed command; transaction requests remain records and are not executed or settled.
- Added request IDs and a consistent API error response envelope.
- Added public institution application intake, manual review state, development approval/invitation utility, scrypt password hashes, user login, session-backed access tokens, refresh rotation/reuse revocation, and current-institution endpoint.
- Added API root status and no-content favicon routes to avoid browser 404/CSP errors when opening the API origin.
- Added owner/admin team member and invitation management with role-specific invite permissions, tenant scoping, revocation, and audit records.
- Added the first responsive Next.js institutional dashboard preview and a live institution onboarding form using the NestJS API.
- Added a dependency-free static preview on port 3001 after the local Next.js native runtime exited with a bus error in both build modes.
