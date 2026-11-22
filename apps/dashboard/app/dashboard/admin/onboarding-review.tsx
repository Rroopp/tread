'use client';

import { useState } from 'react';

interface Application {
  application_id: string;
  display_name: string;
  legal_name: string;
  country_code: string;
  contact_name: string;
  contact_email: string;
  business_type: string;
  application_status: string;
  review_reason: string | null;
  review_id: string | null;
}

export function OnboardingReview({ initialApplications }: { initialApplications: Application[] }) {
  const [applications, setApplications] = useState(initialApplications);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  async function review(applicationId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    setBusyId(applicationId); setError('');
    try {
      const response = await fetch(`/api/internal-admin/onboarding-applications/${applicationId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Review could not be recorded.');
      setApplications((current) => current.map((item) => item.application_id === applicationId
        ? { ...item, application_status: result.status, review_reason: reason, review_id: result.reviewId ?? null } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review could not be recorded.'); }
    finally { setBusyId(''); }
  }

  async function confirm(applicationId: string, reviewId: string) {
    setBusyId(applicationId); setError('');
    try {
      const response = await fetch(`/api/internal-admin/onboarding-reviews/${reviewId}/confirm`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Second-person confirmation failed.');
      setApplications((current) => current.map((item) => item.application_id === applicationId
        ? { ...item, application_status: result.status } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Second-person confirmation failed.'); }
    finally { setBusyId(''); }
  }

  return <section className="panel"><h2>Institution application review</h2>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!applications.length ? <p>No onboarding applications.</p> : <div className="table-wrap"><table><thead><tr><th>INSTITUTION</th><th>CONTACT</th><th>TYPE</th><th>STATUS</th><th>REVIEW</th><th>ACTION</th></tr></thead><tbody>
      {applications.map((application) => <tr key={application.application_id}>
        <td>{application.display_name}<small>{application.legal_name} · {application.country_code}</small></td>
        <td>{application.contact_name}<small>{application.contact_email}</small></td>
        <td>{application.business_type}</td><td>{application.application_status}</td>
        <td>{application.review_reason ?? '—'}</td>
        <td>{application.application_status === 'PENDING_REVIEW' ? <ReviewActions
          busy={busyId === application.application_id}
          onSubmit={(decision, reason) => review(application.application_id, decision, reason)} />
          : application.application_status === 'APPROVAL_PENDING_CONFIRMATION' ? <ConfirmAction
            reviewId={application.review_id ?? ''}
            busy={busyId === application.application_id}
            onConfirm={() => confirm(application.application_id, application.review_id ?? '')} />
            : '—'}</td>
      </tr>)}
    </tbody></table></div>}
    <p className="form-hint">An approval leaves the institution inactive until a different internal administrator confirms it. Rejections require a recorded reason.</p>
  </section>;
}

function ReviewActions({ busy, onSubmit }: { busy: boolean; onSubmit: (decision: 'APPROVE' | 'REJECT', reason: string) => void }) {
  const [reason, setReason] = useState('');
  return <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit(data.get('decision') as 'APPROVE' | 'REJECT', reason); }}>
    <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={2000} required placeholder="Review reason" />
    <div className="button-row"><button disabled={busy} onClick={() => {}}>Submit review</button>
      <select name="decision" aria-label="Decision"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></div>
  </form>;
}

function ConfirmAction({ reviewId, busy, onConfirm }: { reviewId: string; busy: boolean; onConfirm: () => void }) {
  return <button type="button" disabled={busy || !reviewId} onClick={onConfirm}>Confirm as second reviewer</button>;
}
