ALTER TABLE institution_onboarding_applications
  DROP CONSTRAINT institution_onboarding_applications_status_check;
ALTER TABLE institution_onboarding_applications
  ADD CONSTRAINT institution_onboarding_applications_status_check
  CHECK (status IN ('PENDING_REVIEW', 'APPROVAL_PENDING_CONFIRMATION', 'APPROVED', 'REJECTED', 'WITHDRAWN'));
ALTER TABLE institution_onboarding_applications ADD COLUMN review_reason TEXT;

CREATE TABLE institution_onboarding_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES institution_onboarding_applications(id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  proposed_by UUID NOT NULL REFERENCES users(id),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'REJECTED')),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (id, application_id),
  CHECK ((status IN ('AWAITING_CONFIRMATION', 'REJECTED') AND confirmed_by IS NULL AND confirmed_at IS NULL)
    OR (status = 'CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE UNIQUE INDEX institution_onboarding_one_pending_review_idx
  ON institution_onboarding_reviews(application_id) WHERE status = 'AWAITING_CONFIRMATION';
CREATE INDEX institution_onboarding_reviews_history_idx
  ON institution_onboarding_reviews(application_id, proposed_at DESC);

CREATE TABLE email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  recipient_email TEXT NOT NULL,
  template TEXT NOT NULL CHECK (template IN ('INSTITUTION_INVITATION')),
  payload_key_id TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  payload_auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX email_outbox_pending_idx ON email_outbox(next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');
