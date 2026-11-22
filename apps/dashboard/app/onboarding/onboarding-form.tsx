'use client';

import { FormEvent, useState } from 'react';

type Submission = { applicationId: string; status: string };

export function OnboardingForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submission, setSubmission] = useState<Submission | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const baseUrl = process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';
      const response = await fetch(`${baseUrl}/v1/onboarding/institutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'We could not submit your application.');
      setSubmission(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not submit your application.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submission) {
    return <section className="success-card" aria-live="polite"><span className="success-check">✓</span><h2>Application received</h2><p>Your application is pending review. Keep this reference for your records.</p><code>{submission.applicationId}</code><span className="success-status">PENDING REVIEW</span></section>;
  }

  return (
    <form className="onboarding-form" onSubmit={submit}>
      <label>Legal institution name<input name="legalName" placeholder="Example Payments Limited" required minLength={2} maxLength={200} /></label>
      <label>Display name<input name="displayName" placeholder="Example Payments" required minLength={2} maxLength={120} /></label>
      <div className="form-row"><label>Country code<input name="countryCode" placeholder="KE" required pattern="[A-Za-z]{2}" maxLength={2} /></label><label>Institution type<select name="businessType" defaultValue="" required><option value="" disabled>Select type</option><option value="BANK">Bank</option><option value="FINTECH">Fintech</option><option value="PAYMENT_PROVIDER">Payment provider</option><option value="BUSINESS">Business</option><option value="OTHER">Other</option></select></label></div>
      <label>Primary contact<input name="contactName" placeholder="Full name" required minLength={2} maxLength={120} /></label>
      <label>Work email<input name="contactEmail" type="email" placeholder="you@institution.com" required maxLength={254} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary form-submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit application'} <span>→</span></button>
    </form>
  );
}
