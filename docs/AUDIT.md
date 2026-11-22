# Security and Tenant-Isolation Audit

**Audit date:** 22 November 2026  
**Scope:** NestJS API, PostgreSQL queries/migrations, Next.js dashboard and BFF routes, operational scripts, and claims in the application/security documentation. This is a source review, not a penetration test or a production configuration review.

## Documents reviewed

The requested `docs/APPLICATION_GUIDE.md` does not exist in this checkout. The application guide is at `APPLICATION_GUIDE.md` in the repository root. I read that file together with `ARCHITECTURE.md`, `DATABASE.md`, and `SECURITY.md` before reviewing code.

## Severity summary

| Severity | Count | Status |
|---|---:|---|
| Critical | 0 | None confirmed in this source review |
| High | 3 | All three initial findings remediated in source; integration verification below |
| Medium | 4 | M-01–M-04 remediated in source; regression tests added |
| Low / informational | 3 | Documented below |

Severity describes the potential impact in a deployment that uses the affected path. Findings do not establish that an incident has occurred.

The detailed H/M findings, route inventory, and claim table below record the initial audit snapshot. Current dispositions and verification are in the remediation status section.

## Remediation status (22 November 2026)

The findings below document the original code state. The following fixes are now present in the working tree:

| Finding | Status and evidence |
|---|---|
| H-01 webhook environment fan-out | Fixed by migration 020 and an environment-scoped worker query. Disposable PostgreSQL integration test verifies sandbox, production, and global events do not cross environments. |
| H-02 development CLI database guard | Fixed by explicit local-database opt-in and host/name checks in `dev-database-guard.ts`; scripts no longer override `NODE_ENV`. The one-person onboarding approval utility was removed. Unit tests cover production mode, remote hosts, prod-named databases, and opt-in. |
| H-03 owner/admin MFA | TOTP setup/challenge, encrypted TOTP secret, hashed one-time recovery codes, replay prevention, and owner/admin session enforcement are implemented. RFC TOTP and disposable PostgreSQL MFA integration tests pass. |
| M-01 transaction transition environment scope | Fixed: transition now requires environment ID in read and write predicates; compliance integration test uses the updated signature. |
| M-02 sandbox transition predicates | Fixed: helper updates repeat tenant/environment predicates and assert a single row was changed. |
| M-03 institution read-role policy | Resolved by policy: account/transaction summary reads remain available to authenticated members; customer PII and compliance decisions are OWNER/ADMIN/COMPLIANCE; transaction detail evidence is OWNER/ADMIN/OPERATOR/COMPLIANCE. |
| M-04 shared rate limits | Fixed with PostgreSQL-backed Nest throttler storage and independent IP and hashed API-key trackers. A two-pool integration test verifies shared enforcement. Before horizontal scale, confirm the shared PostgreSQL pool has capacity for this traffic. |

The source fixes are uncommitted because this workspace has no Git metadata. Commit-by-commit review cannot be represented until the changes are applied in a Git checkout.

## High findings

### H-01 — Webhook fan-out crosses institution environments

**Affected code:** `src/modules/webhooks/webhook-delivery.worker.ts` (`fanOutOutboxEvents`); `database/migrations/001_core_financial_foundation.sql` (`outbox_events`); `database/migrations/012_webhook_delivery.sql` (`webhook_endpoints`, `webhook_deliveries`).

The outbox row has no `environment_id`. Fan-out selects active endpoints by `institution_id` and event type, but does not select the environment of the transaction/event. Consequently, an event emitted in one environment can be queued for every active endpoint of the same institution in another environment. Delivery rows are correctly constrained to match their endpoint environment, but that constraint cannot prove that the source event belongs to that environment.

**Impact:** Sandbox event payloads can reach production-configured endpoints and production event payloads can reach sandbox endpoints. This violates the stated sandbox/production isolation boundary and can disclose transaction or compliance metadata to an unintended destination.

**Required remediation:** Add an environment identity to environment-owned outbox events, backfill or safely classify existing pending events, and filter endpoint fan-out by institution and environment. Preserve explicitly global events as global rather than assigning them an arbitrary environment. Add a PostgreSQL integration test proving cross-environment endpoints receive no event.

### H-02 — Development CLI guards are bypassed by their npm scripts

**Affected code:** `package.json` scripts `dev:seed`, `dev:seed-user`, and `institution:approve`; `src/database/seed-dev.ts`; `src/database/seed-dev-user.ts`; `src/database/approve-onboarding.ts`.

Each script sets `NODE_ENV=development` itself. The scripts then check `NODE_ENV === 'production'` before changing data or printing credentials. That check therefore cannot distinguish a local database from a production database when the command is invoked through the documented npm script. The command also loads `.env`, which can point at any database.

The affected commands can create/activate a seeded institution, issue and print an API key, create an owner account and print its password, or approve an application and print the initial owner invitation token.

**Impact:** An operator with access to a production database URL could accidentally execute a development bootstrap or approval action against production and emit initial-access credentials to terminal/CI logs. This is privileged misuse/error rather than an unauthenticated remote exploit, but it is a direct production safeguard failure.

**Required remediation:** Remove environment assignment from the scripts and make the command itself fail closed using explicit non-production database identity/allowlisting, not only `NODE_ENV`. Prefer removing development approval as a production-capable utility and replacing it with the reviewed internal workflow. Add tests that invoke the actual npm/script entrypoint with production-mode and production-database configuration and assert no writes or credential output.

### H-03 — Owner/admin accounts have no MFA enforcement

**Affected code:** `src/modules/identity/auth.service.ts`, `src/modules/identity/auth.controller.ts`, `src/modules/identity/jwt-auth.guard.ts`, and dashboard login/session routes.

Human authentication currently uses password login and refreshable sessions only. There is no TOTP enrollment/challenge, recovery-code storage, or role-aware MFA requirement. Owner/admin sessions can manage API keys, team invitations, webhook signing secrets, and other institution controls without a second authentication factor.

**Impact:** A compromised owner/admin password or session grants access to high-impact institution controls. This is an explicit production security requirement in the requested work and is not implemented.

**Required remediation:** Implement MFA enrollment and verification, require it for owner/admin operations as specified, store recovery codes hashed, provide audited recovery/rotation behavior, and test enrollment, challenge, recovery, replay, and role enforcement. No production transfer capability is currently connected, which reduces immediate funds-movement risk but does not remove account takeover risk.

## Medium findings

### M-01 — Internal transaction transition service omits environment scope

**Affected code:** `src/modules/transactions/transactions.service.ts`, `transition()`.

The method selects and updates a transaction by `id` and `institution_id`, but accepts no `environment_id`. It has no current HTTP controller caller, so no direct remote exploit path was found. As a service API it can nevertheless mutate a transaction in either environment when called with the institution ID and transaction ID. This is a latent isolation bypass if a future internal/provider caller uses it with sandbox context.

**Required remediation:** Require environment identity in the method signature and constrain both read and write by institution and environment. Add a regression test attempting to transition a production record with sandbox context. Do not expose this method from a future adapter without a capability-bound service boundary.

### M-02 — Sandbox simulation transition writes rely on an earlier scoped lookup

**Affected code:** `src/modules/transactions/sandbox-simulation.service.ts`, `recordTransition()`.

The public sandbox simulation operation first selects and locks the transaction by ID, institution, and environment, and checks that the environment is `SANDBOX`. Its later `UPDATE financial_transactions ... WHERE id = $1` omits the tenant/environment predicates. Under the current transaction and UUID identity, the earlier lock establishes which row is changed, so this was not assessed as a present cross-tenant route exploit. Repeating the scope in the mutation would make the boundary explicit and resilient to refactoring.

**Required remediation:** Pass institution and environment IDs into the helper and include both in the update predicate; assert one row changed.

### M-03 — Transaction read endpoints do not have explicit role policies

**Affected code:** `src/modules/institutions/institutions.controller.ts` and GET routes in `src/modules/accounts/accounts-dashboard.controller.ts`.

These routes require a currently authenticated institution member and their service queries constrain institution/environment. They do not add `InstitutionRolesGuard` policies. Therefore every active role, including `VIEWER`, can read the dashboard transaction list/detail, compliance list, usage counts, and account data. This may be intended, but the repository has no explicit role-to-read-data matrix. Compliance records can expose screening decisions/reasons; customer list routes deliberately return decrypted contact data to authorized `COMPLIANCE` users and API keys with `customers:read`.

**Decision needed:** Define whether viewers and ordinary operators may read compliance reason codes, all transaction evidence, account totals, and customer PII. Then enforce the chosen role/scope policy consistently and test each role.

### M-04 — Rate limiting is process-local and not differentiated by financial route

**Affected code:** `src/modules/identity/identity.module.ts`; `src/modules/identity/auth.controller.ts`; `src/modules/institutions/team.controller.ts`.

The global limiter allows 30 requests/minute per bearer-token hash or unauthenticated client IP; the auth controller has a 5/minute override and team has a 10/minute override. Storage is in-process. It does not share counters between replicas, does not independently apply both API-key and source-IP dimensions to authenticated requests, and has no financial-route-specific policy. `TRUSTED_PROXY_CIDRS` is required for trustworthy client IP tracking behind a proxy.

**Impact:** Limits reset per process and may be bypassed by distributing requests across replicas or credentials. The current product has no live provider execution route, but the limitation remains relevant to login, key abuse, and future execution endpoints.

**Required remediation:** Use the requested shared-store interface, apply per-key and per-IP dimensions to auth and financial endpoints, test multi-instance behavior, and update the deployment guide/gateway requirements.

## Tenant and environment filter review

The following is the complete set of material cross-boundary patterns identified in this source review. Ordinary institution-facing reads/writes in accounts, quotes, transaction reads/idempotency, holds, customer/beneficiary records, webhook management, and reconciliation batch reads generally include both `institution_id` and `environment_id` in their resource predicates. Primary-key-only writes after a tenant/environment-scoped row lock are called out separately below.

| Location | Boundary behavior | Assessment |
|---|---|---|
| `src/modules/webhooks/webhook-delivery.worker.ts::fanOutOutboxEvents` | Global worker reads pending events and intentionally spans tenants. Endpoint lookup filters tenant and event type, but not environment; outbox rows do not carry environment. | **High; H-01.** Cross-environment delivery. |
| `src/modules/transactions/transactions.service.ts::transition` | Resource selection/update use transaction ID and institution but not environment; method is currently not routed. | **Medium; M-01.** Latent same-institution cross-environment mutation. |
| `src/modules/transactions/sandbox-simulation.service.ts::recordTransition` | Scoped, sandbox-only transaction is selected and locked before helper updates by UUID only in the same SQL transaction. | **Medium; M-02.** Current caller is scoped, but mutation does not independently enforce the scope. |
| `src/modules/ledger/ledger.service.ts` journal/hold status writes | Journal and hold records are first selected/locked or inserted with tenant/environment predicates in the same transaction; subsequent status updates use row UUID only. | No bypass found in current call sequence; add tenant/environment predicates as defense in depth. |
| `src/modules/transactions/transactions.service.ts` quote consumption/status update | Quote consumption includes tenant/environment; transaction status update uses the ID returned by a tenant-scoped insert in the same transaction. | No current bypass found; status update should retain explicit scope as defense in depth. |
| `src/modules/reconciliation/reconciliation.service.ts` batch completion update | Batch is created with supplied institution/environment in the same transaction; final update uses the newly generated batch UUID. Reads afterward constrain tenant/environment. | No current bypass found. Keep the service caller internal; there is no public reconciliation controller. |
| `src/modules/webhooks/webhook-delivery.worker.ts` global claim/lease/update operations | A trusted background worker claims rows globally with `FOR UPDATE SKIP LOCKED`; delivery rows reference their tenant/environment endpoint. | Intentional global worker boundary. Audit/monitoring must protect its DB credentials. |
| `src/modules/admin/admin-ops.service.ts` platform operations | Queries span institutions by design and are behind JWT authentication plus a separately granted per-route system scope; reads and provider changes are audited. | Intentional cross-tenant privilege. MFA/dual control are not present. |
| `src/modules/providers/provider-registry.service.ts` registry lookup | Provider integration records are global platform configuration filtered by capability/environment, not institution-owned records. | Intentional global configuration; no provider adapter is registered. |
| `src/modules/identity/auth.service.ts` invitation/user lookups | One-time invitation hash and normalized email are global identity keys; acceptance links the user to the institution recorded in the locked invitation. | Intentional global identity operations. |
| `src/modules/identity/api-key.guard.ts` credential touch | Credential is first looked up by unique prefix and validated; `last_used_at` then updates by credential UUID. | No cross-tenant bypass found in current sequence. |

Internal global queries must remain behind their explicit service boundary. The application does not use PostgreSQL row-level security, so tenant isolation relies on application predicates, relational constraints, authorization guards, and disciplined use of global worker/admin services.

## Route authorization inventory

### Intentionally public routes

- `GET /`, favicon, `/v1/health/live`, and `/v1/health/ready` expose basic service status/readiness.
- `POST /v1/onboarding/institutions` accepts public applications and is throttled.
- `POST /v1/auth/login`, `/auth/accept-invitation`, and `/auth/refresh` are public credential/bootstrap routes and are throttled.
- Swagger is enabled outside production mode.

### Institution API routes

Accounts, quotes, transaction list/create/read/sandbox simulation, webhooks, customers, and beneficiaries use `ApiKeyGuard` plus `InstitutionScopesGuard`, with endpoint-specific read/write scopes. The API key guard checks credential revocation/expiry, active institution/environment, and key/environment prefix agreement. Resource reads/writes are scoped in services. Dashboard BFF routes that proxy these data paths read the HTTP-only access cookie and send a JWT to the API.

### Human and internal routes

Sign-out/current-user routes use JWT validation. Team, API key, and dashboard webhook routes use JWT plus owner/admin role checks. Customer/beneficiary routes use JWT and controller/route role checks, except read fields as described under M-03. Internal admin routes use JWT plus live system-admin grant checks for per-route scopes. No unauthenticated internal-admin controller route was found.

### Missing/unclear authorization policy

`InstitutionsController` dashboard read methods and account dashboard GET methods have JWT authentication and tenant scoping but no explicit institution-role matrix. This is recorded as M-03 rather than an authentication bypass. The BFF does not itself define role policy; it relies on the API.

## Secret and PII exposure review

### Confirmed or intended sensitive outputs

- API credential plaintext is returned only at creation; signing secret is returned once when creating a webhook endpoint. These are expected one-time outputs but callers must avoid response-body logging.
- Team invitation creation returns a one-time invitation token to institution administrators, and the invitation email is queued with an encrypted payload. The development console sender prints the email content, including the invitation link; it is restricted to non-production runtime. Production email delivery remains unconfigured and retries from the encrypted outbox.
- The removed development approval utility printed the owner invitation token; development seed utilities continue to print local sandbox credentials and are protected by the explicit local database guard described in H-02 remediation.
- Customer creation and customer list APIs return decrypted name/contact values to callers with `customers:write` or `customers:read`; the institution API explicitly grants that PII access. Beneficiary lists decrypt display name but expose destination only in masked form.
- Internal provider operations expose the provider `secret_reference` path to users with `providers:read`; actual credential values are not read from this registry or returned.

### Logging and errors

- `ApiExceptionFilter` returns a generic message for 5xx responses and logs the exception stack with request ID, HTTP method, and path. No request body, authorization header, password, API key, refresh token, invitation token, customer profile, or beneficiary details are deliberately logged in the request path. The development email sender is the exception: its explicit console behavior prints invitation message content and must remain disabled in production.
- Database pool errors, webhook worker failures, and top-level development CLI failures log error stacks/messages. Webhook delivery stores only HTTP status or error class name in `last_error`; it does not store request body, signature, or signing secret.
- The database migration runner logs migration filenames. The admin grant CLI may echo allowed scope names in usage errors but does not print a secret.

No confirmed raw production secret is returned by ordinary read endpoints or logged by the inspected API middleware. The one-time credential outputs are expected behavior, but production email/secret delivery and log redaction controls remain operational requirements.

## Application-guide claim check

| Guide statement | Code assessment |
|---|---|
| “No funds move” / transaction request is not a payment instruction | Supported. No live provider adapter or provider execution endpoint is registered. The funding endpoint is sandbox-only and explicitly returns simulated mode. |
| Tenant and environment data separation | Mostly supported by service predicates and composite FKs; **not supported for webhook outbox fan-out** (H-01). Some internal transition mutations also omit environment predicates (M-01/M-02). |
| MFA is absent | Historical finding, remediated. Owner/admin TOTP MFA, hashed one-time recovery codes, replay prevention, and role-aware enforcement are present. |
| Dashboard role/resource authorization | Partly supported. Mutating routes are role-limited; some read routes are only JWT-authenticated (M-03), so the blanket guide statement should not imply a defined per-role read matrix. |
| Database and application protect transaction state transitions | Supported for exposed transaction mutations by database state guards and sandbox-only simulation. `TransactionsService.transition()` is not currently routed and should be environment-scoped before reuse (M-01). |
| Latest environment-matched compliance decision gates approval/execution | Database triggers inspect decision mode, environment, and latest decisions. Sandbox decisions remain simulated. This is a database state gate, not a live provider execution implementation. |
| Ledger is balanced, immutable, and reversed through linked journals | Supported by ledger service and migration constraints/triggers; integration tests exist for the ledger workflow. This audit did not rerun those suites. |
| Customer/beneficiary PII is encrypted and beneficiaries are masked | Supported in service code using AES-256-GCM. Production key management is external; development/test mode can use deterministic local key material. Customer create/list intentionally returns decrypted contact data to authorized scopes. |
| Webhook URLs are HTTPS/allowlisted and requests pin public IPv4, reject redirects, and bound time/response | Mostly supported by code. The IPv4 denylist is hand-maintained rather than a maintained IP classification library; egress firewalling is still necessary. |
| Rate limits are process-local | Historical finding, remediated with PostgreSQL-backed shared storage and separate source-IP and hashed API-key trackers. It is not Redis-backed. |
| Reconciliation matches supplied observations | The matcher consumes a `ProviderStatementFeed` interface and classifies matched, variance, unmatched, and pending observations. No live feed or public reconciliation route is connected. |
| Institution approval is development-only and internal production review is missing | Historical finding, remediated. Review with reason followed by confirmation from a different internal administrator is implemented and audited; the old approval utility was removed. |
| Audit history is append-only | Database triggers protect audit logs, lifecycle transitions, compliance decisions, verification events, and reconciliation observations. Provider attempt rows are not generally append-only: their status is updated as attempts progress. |

## Low / informational findings

### L-01 — No PostgreSQL row-level security

The database guide presents RLS as a consideration, not an implemented control. Current isolation depends on the application and database constraints. Consider RLS as defense in depth after the query/session-context design is established; do not enable a partial policy that breaks pooled connections or background work.

### L-02 — Webhook public-address classification is custom code

`isPublicIpv4()` blocks common private, loopback, link-local, carrier-grade NAT, multicast, and documented ranges but is a hand-maintained classifier. Keep outbound egress restricted to approved destinations and consider a maintained special-purpose address registry. Exact hostname allowlisting alone is not a complete SSRF boundary.

### L-03 — Production operational controls remain deployment prerequisites

The code/repository does not demonstrate production KMS integration, centralized logs/alerts, restore drills, live provider connectivity, or a live reconciliation feed. MFA and shared throttling exist in application code, but still require production configuration and operational verification.

## Verification and limitations

- Read the four requested docs from repository root because `docs/APPLICATION_GUIDE.md` is absent.
- Inspected NestJS controller decorators/guards, authentication and API-key guards, provider/admin/customer/webhook/ledger/transaction services, SQL predicates, migration constraints/triggers, dashboard BFF route inventory, and logging/error handlers.
- Verification after remediation: API build and TypeScript check, dashboard TypeScript check, TOTP RFC-vector tests, MFA integration, dual-control onboarding integration, shared PostgreSQL rate-limit integration, webhook environment integration, ledger, reconciliation, compliance, state-machine, and development-database guard tests. Integration suites used a disposable database whose name contains `test`.
- No production environment, live provider configuration, KMS, or external email service was available for review. This workspace has no `.git` directory and `git rev-parse` reports that it is not a Git repository, so changes could not be committed separately as requested.

## Recommended remediation order

1. Add maintained IP-address classification or enforce egress at the production network boundary for webhook deliveries.
2. Add PostgreSQL row-level security only after designing safe tenant context with pooled connections and background workers.
3. Configure and exercise production email, shared database rate-limit capacity, key management, centralized monitoring, and recovery procedures before live use.

These items are deployment/defense-in-depth work; they do not restore the resolved tenant/environment or authorization findings above.
