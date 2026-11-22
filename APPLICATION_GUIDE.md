# TREAD Application Guide

This guide explains what the application does today, how its parts fit together, how operators use it, and how to run and maintain it. It reflects the implementation in this repository as of 22 November 2026.

## 1. What TREAD is

TREAD is a multi-tenant financial infrastructure platform for institutions. It provides a versioned REST API and an institutional dashboard for onboarding, access control, account records, quotes, transaction requests, compliance evidence, customer and beneficiary records, webhooks, and internal operations.

The core platform is being focused on a KES ↔ USDC off-ramp for fintechs and payment companies. It has a deterministic sandbox lifecycle simulator, but does **not** connect to a live bank, FX/liquidity desk, custodian, blockchain service, or KYC/AML provider. Transaction requests are platform records, not payment instructions or proof of settlement. Sandbox outcomes are labeled simulated. No funds move through the current application.

## 2. Application components

| Component | Implementation | Responsibility |
|---|---|---|
| Institutional dashboard | Next.js, React, TypeScript | Human sign-in, institution workspaces, operator views, API credential and webhook controls |
| API | NestJS, Node.js 22, TypeScript | Authentication, authorization, validation, business rules, workflows, audit, and API responses |
| Database | PostgreSQL | Authoritative institution, identity, transaction, ledger, compliance, provider, webhook, and audit records |
| Outbox and delivery worker | NestJS worker in the API deployment | Reads durable domain events and performs signed webhook delivery with retries |
| Container runtime | Docker Compose locally; production Compose topology provided | Starts services, orders dependencies, checks health, and restarts long-running containers |

The API is a modular monolith. Its principal modules cover identity, institutions, accounts, ledger, quotes, transactions, webhooks, reconciliation, providers, customer records, and internal administration. PostgreSQL is the source of truth for internal records; Redis or caches must never be treated as authoritative balances or transaction outcomes.

## 3. How a request moves through the system

1. A dashboard request is made by a signed-in human, or an integration calls the versioned API with an institution API key.
2. The API validates the request DTO, authenticates the caller, and checks the institution, environment, role, scope, and resource ownership.
3. The service applies the business rule. Financial create operations use idempotency keys and database uniqueness constraints where supported.
4. PostgreSQL commits the business record, lifecycle/audit data, and applicable outbox event together. Ledger posting also locks affected accounts, checks exact integer amounts, and enforces balanced entries.
5. The API returns a result and request correlation ID. Asynchronous lifecycle events may later be delivered to configured webhook endpoints; delivery is at least once, so receiving systems should deduplicate by event ID.
6. Provider operation and attempt records support a deterministic sandbox lifecycle and unknown-outcome reconciliation. The mock KES ↔ USDC adapter cannot move funds. No live provider adapter is registered.

The database and application both protect important state transitions. Posted journals are immutable; corrections are represented by linked reversals. The latest environment-matched compliance decision governs approval checks. Sandbox decisions are explicitly simulated; production execution requires live `ALLOW` decisions, but provider-backed execution itself is not available yet.

## 4. Environments and authentication

### Institution environments

Institution data is scoped by both `institution_id` and `environment_id`. The sandbox and production environments have separate credentials and records. Dashboard routes select an active environment using the institution service rules; sandbox is preferred where both are active. Do not assume a dashboard record in sandbox exists in production.

### Human dashboard access

Institution users sign in with an email, password, and institution ID. Passwords are stored as scrypt hashes. Owner and admin access requires TOTP MFA; recovery codes are stored as hashes and consumed once. Access tokens are short-lived; refresh tokens are stored as hashes, rotate once per use, and reuse revokes the session. The dashboard uses server-side routes and HTTP-only session cookies to call the API; browser components call dashboard BFF routes instead of receiving API secrets from server configuration.

Institution roles include owner, admin, operator, compliance, and viewer. Sensitive controls are role-limited. For example, owners/admins manage API credentials and webhooks; customer and beneficiary registration is available to permitted operators; disabling those records is owner/admin only.

### Institution API keys

API credentials are environment-specific and scope-limited. Their plaintext is returned only when created; PostgreSQL stores a hash and display prefix. Revoke credentials that are no longer needed. Use separate sandbox and production keys and grant only the scopes needed by each integration.

### Internal platform access

Internal administrator grants are separate from institution roles. Grants carry platform scopes, and internal reads/configuration changes are audited. Grant/revoke utilities require a privileged database connection. Institution approval records a reviewer decision and reason; a different internal administrator must confirm activation. The dashboard’s `/dashboard/admin` page is intended for authorized platform staff; ordinary institution users do not gain access merely by being institution owners.

## 5. Dashboard guide

The dashboard is served locally at `http://localhost:3001`. Its shared shell displays the institution, environment, page navigation, and sign-out control.

| Route | Purpose and current behavior |
|---|---|
| `/` | Public product landing page |
| `/login` | Human sign-in |
| `/onboarding` | Submit an institution application; it remains pending manual review |
| `/accept-invitation` | Accept an expiring one-time invitation and set a password |
| `/dashboard` | Institution summary, balances/activity, and workspace navigation |
| `/dashboard/transactions` | Tenant/environment-scoped transaction search, status filtering, and pagination |
| `/dashboard/transactions/{id}` | Lifecycle, compliance, provider-attempt, ledger, and reconciliation evidence for a transaction |
| `/dashboard/liquidity` | Request explicitly configured sandbox quotes and create transaction request records; no settlement occurs |
| `/dashboard/accounts` | List institution operational accounts, balances, holds, and account records |
| `/dashboard/accounts/{id}` | Account detail and ledger-derived balance information |
| `/dashboard/customers` and `/dashboard/beneficiaries` | Existing encrypted-record screens, deferred from the pilot surface until integrated with the source-of-funds workflow. New records remain unverified; no payout or provider verification is available. |
| `/dashboard/compliance` | Review the latest recorded compliance checks for transactions in the active environment |
| `/dashboard/team` | List members, issue role-limited invitations, and revoke pending invitations |
| `/dashboard/reports` | Limited transaction activity CSV, deferred from the pilot surface; not a settlement statement |
| `/dashboard/usage` | Informational counts, deferred from the pilot surface; not billable metering |
| `/dashboard/developers` | API guide and sandbox quote/request console. Integrator-facing API and generated OpenAPI reference remain the product surface. |
| `/dashboard/api-keys` | Create, list, and revoke scoped institution API credentials |
| `/dashboard/webhooks` | Manage active-sandbox webhook endpoints and inspect delivery history |
| `/dashboard/admin` | Restricted platform operations and provider metadata configuration |

The UI is intentionally explicit about unsupported states. A configured provider record means metadata and a secret reference are recorded; it does not mean the provider is connected, healthy, licensed, or allowed to execute.

## 6. Financial and operational workflows

### Institution onboarding

1. An applicant submits institution and contact details through onboarding.
2. The institution and sandbox environment are created in pending/disabled status.
3. A separately scoped internal reviewer records an approval or rejection with a reason. Approval remains pending until a different internal administrator confirms it.
4. Approval activates the institution’s sandbox and creates a one-time owner invitation.
5. The invitee accepts the invitation and sets a password, then signs in.

Invitations use a durable outbox and provider-neutral email interface. Development uses a console sender; production fails closed until an email sender is configured.

### Quotes and transaction requests

Sandbox quotes are generated only from explicitly configured integer ratios. For example, `SANDBOX_RATES_JSON` may map `KES:USD` to a numerator and denominator. A quote is short-lived, marked simulated, and can be consumed once. Consuming it creates a `QUOTED` transaction request with idempotency protection. It does not call a bank, debit an account, or settle currency.

The transaction state machine prevents invalid transitions. The sandbox-only mock simulates quote, funding confirmation, compliance, conversion, payout, failure, retryable failure, unknown outcome, and reversal. Provider operations and attempts are idempotent and persisted; unknown results require reconciliation and are not retried. This is currently a synchronous sandbox service, not an isolated durable provider worker. Production compliance requires live `ALLOW` outcomes, but no production execution path is connected.

### Accounts, ledger, and holds

Institutions can provision operational accounts for enabled assets. The account view reports posted and available balances from ledger entries and active holds. A newly created account starts with no funding. Ledger postings require at least two entries, exact amounts, and balanced debit/credit totals. Account locks and database transactions protect contested operations. A hold reserves available funds; it can be released or captured through a matching ledger posting. A posted journal can be corrected only through a linked reversal, not by editing the original.

These controls provide internal accounting behavior; they are not a bank account connection or evidence of external funds.

### Customers and beneficiaries

Customer profile fields and beneficiary destination details are encrypted with AES-256-GCM using a versioned key ID. List views return selected display fields and masked beneficiary values. New customers and beneficiaries start pending verification. Verification events are append-only. There is no endpoint or screen that allows an institution to mark a record verified without a provider decision, and no payout instruction is available.

### Compliance

Compliance records are append-only and tied to an institution, environment, transaction, check type, decision mode, provider code, and evidence/reason fields. The dashboard shows the newest checks. In sandbox, decisions are explicitly simulated. In production, the database gate requires recent, matching, live allow decisions before approval/execution transitions; real screening vendors and policies must still be integrated.

### Webhooks and outbox

Business changes write outbox events in the same database transaction. A worker claims pending events and creates deliveries for configured endpoints. Delivery attempts include an HMAC signature and retry/backoff state. Stored signing secrets are encrypted and are shown only once at creation. Targets must use HTTPS and an exact configured hostname allowlist; each attempt resolves and pins a public IPv4 address, verifies TLS for the hostname, rejects redirects, and has a deadline/response limit. Webhook delivery is at least once, so consumers need event-ID deduplication and signature/timestamp verification.

### Provider configuration and reconciliation

Normalized contracts describe bank, FX/liquidity, custody, blockchain, and compliance capabilities. The registry checks adapter capability and environment. The only concrete adapter is a sandbox mock. Provider configuration stores managed-secret references. Reconciliation accepts a statement-feed interface and classifies matched, variance, unmatched, or pending evidence; no live feed is connected. Durable asynchronous step execution, provider webhook normalization, transaction limits, and maker-checker transfer approval remain pre-live work.

## 7. Local operation

### Start

Requirements: Docker Compose. From the repository root:

```sh
docker compose up --build -d
```

The local Compose stack starts PostgreSQL, runs the migration one-shot container, starts the API, and then starts the dashboard after the API is healthy. Services bind to loopback: dashboard `127.0.0.1:3001`, API `127.0.0.1:3000`, PostgreSQL `127.0.0.1:5432`. The Compose file uses local-only credentials and a deterministic local encryption key; these must never be reused in any shared or production environment.

Long-running API and dashboard containers use `restart: unless-stopped` and health checks. They restart when the Docker daemon restarts unless explicitly stopped. For restart after machine boot, the Docker service itself must be enabled at boot. The migration container exits after success and is not a daemon.

### Check status and logs

```sh
docker compose ps
docker compose logs -f api dashboard
curl -i http://localhost:3000/v1/health/ready
curl -i http://localhost:3001/
```

Readiness reports database connectivity. The dashboard HTTP check only confirms the web process responds; sign-in and authenticated data calls also require a healthy API and database.

### Seed local access

Create a local sandbox owner login using:

```sh
docker compose exec api node dist/database/seed-dev-user.js
```

The command prints a generated email/password and institution ID. Treat them as local-only credentials and keep them out of source control. A separate sandbox API-key seed utility is available in the compiled API image. Do not run seed utilities in production.

### Stop, restart, and reset

```sh
docker compose restart api dashboard
docker compose down
```

`docker compose down` stops/removes containers but keeps the named PostgreSQL volume. To intentionally erase all local database state, `docker compose down -v` removes that volume; this is destructive and cannot be undone without a backup.

### Build and verification commands

```sh
npm run build
npm run typecheck
npm --prefix apps/dashboard run typecheck
npm run test:state-machine
```

The ledger, compliance, and reconciliation integration suites use a disposable PostgreSQL database. They create persistent accounting/audit data and must only be run against a dedicated test database, never against production or a valuable local dataset.

## 8. Production operations

The production Compose topology is in `deploy/compose.production.yml`; it expects an external managed PostgreSQL service and managed secrets. It is a deployment baseline, not a complete hosted production environment. Before deployment:

1. Provision the cloud account/network, managed PostgreSQL with TLS, backups and point-in-time recovery, domain, TLS termination, and a container registry.
2. Create production secrets in a KMS/secrets manager: database URL, unique JWT signing secret, webhook encryption key, customer/beneficiary encryption keyring and current key ID, approved webhook hostnames, CORS origins, and public API origin.
3. API throttling uses PostgreSQL-backed shared storage with separate IP and hashed API-key trackers. Monitor database capacity and configure gateway limits as defense in depth.
4. Configure trusted proxy CIDRs if deployed behind a reverse proxy. Do not trust arbitrary forwarded IP headers.
5. Deploy versioned images, take a database backup, run the migration one-shot using the intended release, and check API/dashboard health and logs.
6. Configure central logs, alerts, backups, restore drills, incident/on-call ownership, RPO/RTO, and reconciliation operations.
7. Keep production transfer execution disabled until provider, compliance, licensing, security, reconciliation, and operational gates have been completed and approved.

See [deploy/PRODUCTION.md](deploy/PRODUCTION.md) for the release checklist and operational controls. Production database migrations are forward-only; use reviewed compatibility and rollback plans.

## 9. Current limitations and required external dependencies

The present build is not a production financial execution system. It does not include live bank rails, FX/liquidity routing, custody, blockchain signing/broadcast, KYC/KYB, sanctions screening, travel-rule exchange, live payouts, deposits, billing/invoice settlement, production SSO, configured production email, or a live reconciliation feed. Usage counts are not invoice-grade metering. MFA and dual-control onboarding are implemented; transfer limits and maker-checker approvals are not. Audit rows remain in the business database without external anchoring or a hash chain.

To implement a live corridor, the product owner must select the target countries/currencies and provide the selected providers’ sandbox documentation and credentials through a secrets manager. The institution must also establish its licensing/jurisdiction approach, settlement and custody model, risk limits, compliance policy, operational review process, support/on-call arrangements, cloud/domain/database/KMS/email services, and production monitoring/backup requirements. Never send production credentials in chat or commit them to the repository.

## 10. Related documentation

- [README](README.md): project overview and quick start
- [Architecture](ARCHITECTURE.md): module boundaries and invariants
- [Database design](DATABASE.md): schema, tenant isolation, ledger, and retention
- [API reference](API.md): routes, auth, scopes, and idempotency
- [Security requirements](SECURITY.md): security and release gates
- [Production operations](deploy/PRODUCTION.md): deploy and runbook baseline
- [Development roadmap](DEVELOPMENT_ROADMAP.md): implementation status and outstanding work
