# Source-of-funds evidence package schema plan

**Status: design only.** No migration, API, or evidence-package implementation has been written. The plan is for review before implementation, as requested.

## Recommendation

Use canonical structured JSON as the generated package format. It is easier to hash, verify, diff, test, and hand to a bank compliance team than an initial PDF. A PDF can be rendered later from the verified JSON without becoming the integrity source. Every export should include its snapshot ID, sequence, previous hash, content hash, environment, and an explicit simulated/live provenance marker.

## Data sources to snapshot

- Declared origin-of-funds category, free-text declaration, country, declaration timestamp, and supporting document references. References identify externally stored objects; TREAD will not store document files in this schema. Reference values and notes are encrypted at rest.
- Wallet/address ownership evidence: asset/network, address, evidence type, proof/document object reference, and a hash/reference for any signed challenge evidence. No wallet private key or signing secret is stored.
- Customer verification and screening records from `customer_verification_events` and `transaction_compliance_decisions`, including provider, decision, reason code, timestamp, decision mode, and the source record IDs. A sandbox result is marked simulated.
- The transaction request and ordered `transaction_transitions` timeline where the package is transaction-scoped.
- Relevant audit entries identifying who created/reviewed the evidence and which snapshot hash they saw.

The export must not infer a customer as verified from a declaration or from an internal status field alone. It may report provider-confirmed verification only when an explicit provider decision exists; sandbox evidence remains labeled simulated.

## Proposed tables

### `source_of_funds_evidence_snapshots`

One immutable row per package version:

- `id UUID PRIMARY KEY`, stable `chain_id UUID`, positive `sequence`, `institution_id`, and `environment_id`.
- Exactly one subject: `customer_id` or `transaction_id`. Composite foreign keys include institution and environment, matching the existing customer/transaction tenant model.
- `payload_key_id`, `payload_ciphertext`, `payload_iv`, and `payload_auth_tag` using the existing AES-256-GCM data-encryption keyring. The encrypted canonical payload contains declarations, document references, wallet evidence, copied screening results, timeline, and source-record identifiers.
- `previous_hash CHAR(64) NULL` and `content_hash CHAR(64) NOT NULL`. The service computes a canonical hash over the immutable scope/version metadata and ciphertext fields. Version 1 has no previous hash; each later version points at the prior snapshot's content hash.
- `created_by_user_id` and/or `created_by_credential_id`, `created_at`, and a provenance value (`SANDBOX_SIMULATED` or `LIVE_PROVIDER_EVIDENCE`).
- Unique `(chain_id, sequence)` and scoped uniqueness/indexes for the customer or transaction subject. Indexes support latest snapshot lookup by institution/environment and subject.
- A PostgreSQL trigger rejects UPDATE and DELETE. An insert trigger verifies sequence continuity and the previous-hash link within the same chain and scope. The service locks the customer or transaction row while appending so first-version creation and later versions serialize.

### `source_of_funds_evidence_reviews`

One immutable row per review action against an exact snapshot:

- UUID ID, snapshot ID, institution/environment IDs, reviewer user ID, action (`ACKNOWLEDGE`, `REQUEST_INFORMATION`, `ACCEPT`, or `REJECT`), and timestamp.
- A reason/note encrypted with the same keyring; no free-text review note is stored in plaintext.
- `previous_review_hash` and `review_hash`, with a per-snapshot sequence and uniqueness constraints. The hash covers the snapshot content hash, reviewer/action/timestamp, encrypted note fields, and previous review hash.
- A scoped composite foreign key to the snapshot and an append-only trigger that rejects UPDATE and DELETE.

The existing `audit_logs` table will also receive an append-only event for generation and review, but the evidence tables remain independently verifiable if unrelated audit records are added later.

## Migration and rollout plan

1. Add a forward-only migration `025_source_of_funds_evidence.sql` creating the two tables, composite tenant/environment foreign keys, unique/index constraints, and append-only/hash-chain triggers. Do not alter customer, transaction, compliance, or audit rows and do not backfill historical evidence.
2. Apply and test this migration only on a disposable PostgreSQL database. Tests must cover cross-tenant/environment foreign-key rejection, snapshot/review hash-chain continuity, rejection of update/delete, and concurrent version creation.
3. After migration approval, implement an authenticated, tenant/environment-scoped service that reads existing source rows, creates an encrypted immutable snapshot, and emits canonical JSON with the hash metadata. Review actions must bind to the exact snapshot hash.
4. Verify the exported JSON by decrypting and recomputing the hash before returning it. Responses must label sandbox content as simulated and must never expose decrypted data to roles outside the selected customer/compliance policy.
5. Only after integration tests pass should the migration be applied to the local development database. Production rollout additionally requires key-management, legal retention, and evidence-access policy approval.

## Open operational policy

The proposed tables have no automatic deletion/expiry. Because the records are append-only and contain regulated evidence references, a legal retention period and any lawful erasure/crypto-shredding requirement must be agreed before production customer data is written. The API and migration will not invent that retention period.
