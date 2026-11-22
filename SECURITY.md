# Security and Financial Integrity

## Baseline

- Require TLS in transit and encryption at rest through managed infrastructure.
- Keep secrets in a managed secrets system or KMS/HSM; persist only secret references or one-way hashes for API keys. Never store plaintext API credentials or private signing keys.
- Generate API credentials with high entropy, show the plaintext once, store only a cryptographic hash, and revoke by credential record. The local development seed is an exception only in that it prints a sandbox key to the operator once; it refuses production mode.
- Separate sandbox and production credentials, keys, data, and provider configurations.
- Authenticate every API call; authorize by institution, environment, role, and resource. Apply least privilege and tenant scope to every query.
- Human passwords are hashed with scrypt; access tokens are short lived and checked against live session/membership state, while refresh tokens are stored as hashes and rotated once per use.
- Rate-limit onboarding, login, invitation acceptance, and refresh requests. The current throttler uses PostgreSQL-backed shared storage with separate IP and hashed API-key trackers. Protect database capacity and add gateway limits as defense in depth.
- Validate and normalize requests; rate-limit by institution and credential; use versioned APIs.
- Sign webhooks, include timestamps and unique event IDs, support replay detection, and rotate secrets.
- Webhook endpoint delivery is allowlist-gated by exact hostname, HTTPS-only, HMAC-signed, retried with backoff, and uses AES-256-GCM for stored signing secrets. Configure `WEBHOOK_SECRET_ENCRYPTION_KEY` from managed secret storage and `WEBHOOK_ALLOWED_HOSTS` before enabling endpoints. Dashboard endpoint controls are owner/admin-only and currently operate on the active sandbox environment. The hostname allowlist is a deployment trust boundary; production deployments should additionally enforce egress controls that block private and link-local destinations.
- Emit structured security and financial audit events without logging credentials, full payment details, or unnecessary personal data.

## Financial controls

- Ledger posting is atomic, balanced, idempotent, and immutable after posting.
- Use explicit allowed transaction state transitions and record every transition.
- Before live execution, gate each workflow on institution status, permissions, configured amount/velocity limits, maker-checker approval where required, customer/beneficiary eligibility, jurisdiction, and a policy-engine decision. Transfer limits and maker-checker approvals are not implemented yet.
- Sensitive internal actions use role separation and dual approval where appropriate. Administrators cannot directly edit balances.
- Institution team invitations are tenant-scoped and role-limited: only owners/admins can issue or revoke invitations; admins cannot assign admin or owner roles.
- Reconcile internal records against provider evidence; discrepancies enter an exception workflow.
- Retry external actions only with provider-safe idempotency or a reconciliation check that determines whether the first attempt succeeded.

## Operational controls

Plan centralized secret management, least-privilege service identities, dependency scanning, signed builds, backups, restore drills, disaster recovery, OpenTelemetry, alerting, and incident response before production. Define RPO/RTO targets with deployment owners.

## Release gates

Before live financial traffic: independent security review, threat model, jurisdiction and licensing review, provider sandbox validation, key management validation, ledger and concurrency verification, webhook verification, reconciliation procedures, operational runbooks, and approved production limits. This repository currently contains no live provider integration.

Institution onboarding currently records applications for manual review. The approval/invitation utility is development-only; production approval needs authenticated internal administration, reviewer identity, and configured email delivery before use.

Internal platform access is separate from institution roles. Grant only required scopes to active, verified staff through the privileged database CLI and revoke access promptly. Institution activation uses two-person approval. Provider secret values stay in managed secret storage; the provider registry stores references only and cannot be marked live-ready through the console. Audit records remain in the business PostgreSQL database and are not externally anchored; do not claim tamper-evident audit integrity until anchoring is implemented.
