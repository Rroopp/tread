'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function InvitationForm({ initialToken = '' }: { initialToken?: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch('/api/auth/accept-invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Unable to accept this invitation.');
      router.replace(`/login?institutionId=${encodeURIComponent(result.institutionId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to accept this invitation.');
    } finally { setBusy(false); }
  }
  return <form className="onboarding-form" onSubmit={submit}>
    <label>Invitation token<input name="invitationToken" autoComplete="one-time-code" defaultValue={initialToken} required /></label>
    <label>Create password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button-primary form-submit" disabled={busy}>{busy ? 'Accepting…' : 'Accept invitation'} <span>→</span></button>
  </form>;
}
