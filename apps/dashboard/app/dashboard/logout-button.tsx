'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function logout() {
    setBusy(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    finally { router.replace('/login'); router.refresh(); }
  }
  return <button className="logout-button" type="button" onClick={() => void logout()} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>;
}
