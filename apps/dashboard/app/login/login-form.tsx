'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type Stage = 'credentials' | 'setup' | 'mfa' | 'recovery';

export function LoginForm({ institutionId }: { institutionId: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [stage, setStage] = useState<Stage>('credentials');
  const [secret, setSecret] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function mfaRequest(action: string, values: Record<string, string>) {
    const response = await fetch('/api/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error?.message ?? 'MFA request failed.');
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      if (stage === 'setup') {
        const result = await mfaRequest('confirm', { challengeToken: challenge, totpCode: String(payload.totpCode ?? '') });
        setRecoveryCodes(result.recoveryCodes ?? []);
        setStage('recovery');
        return;
      }
      if (stage === 'mfa') {
        const recoveryCode = String(payload.recoveryCode ?? '').trim();
        const totpCode = String(payload.totpCode ?? '').trim();
        const result = await mfaRequest('verify', { challengeToken: challenge, ...(recoveryCode ? { recoveryCode } : { totpCode }) });
        if (result.status === 'authenticated') { router.replace('/dashboard'); router.refresh(); }
        return;
      }
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? result.message ?? 'Unable to sign in.');
      if (result.mfaSetupRequired || result.mfaRequired) {
        setChallenge(result.challengeToken);
        if (result.mfaSetupRequired) {
          const setup = await mfaRequest('setup', { challengeToken: result.challengeToken });
          setSecret(setup.secret);
          setStage('setup');
        } else setStage('mfa');
        return;
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  }

  if (stage === 'recovery') return <section className="onboarding-form"><h2>MFA enabled</h2><p>Save these recovery codes now. Each code can be used once.</p><pre>{recoveryCodes.join('\n')}</pre><button type="button" className="button-primary form-submit" onClick={() => { setStage('credentials'); setRecoveryCodes([]); setChallenge(''); }}>Continue to sign in</button></section>;

  return <form className="onboarding-form" onSubmit={submit}>
    {stage === 'credentials' && <>
      <label>Institution ID<input name="institutionId" defaultValue={institutionId} required /></label>
      <label>Work email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    </>}
    {stage === 'setup' && <><p>Register this secret in your authenticator app.</p><code>{secret}</code><label>Authenticator code<input name="totpCode" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required /></label></>}
    {stage === 'mfa' && <><p>Enter an authenticator code or a one-time recovery code.</p><label>Authenticator code<input name="totpCode" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label><label>Recovery code<input name="recoveryCode" autoComplete="off" /></label></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button-primary form-submit" disabled={busy}>{busy ? 'Working…' : stage === 'setup' ? 'Confirm MFA' : stage === 'mfa' ? 'Verify and sign in' : 'Sign in'} <span>→</span></button>
    {stage === 'credentials' && <p><a href="/accept-invitation">Accept an invitation</a></p>}
  </form>;
}
