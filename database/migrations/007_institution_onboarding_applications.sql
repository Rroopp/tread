CREATE TABLE institution_onboarding_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL UNIQUE REFERENCES institutions(id),
  contact_name TEXT NOT NULL CHECK (length(trim(contact_name)) > 0),
  contact_email TEXT NOT NULL,
  contact_email_normalized TEXT GENERATED ALWAYS AS (lower(trim(contact_email))) STORED,
  business_type TEXT NOT NULL CHECK (business_type IN (
    'BANK', 'FINTECH', 'PAYMENT_PROVIDER', 'BUSINESS', 'OTHER'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  review_reason_code TEXT,
  reviewed_by UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT onboarding_contact_email_valid
    CHECK (contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE INDEX institution_onboarding_pending_idx
  ON institution_onboarding_applications(submitted_at)
  WHERE status = 'PENDING_REVIEW';
