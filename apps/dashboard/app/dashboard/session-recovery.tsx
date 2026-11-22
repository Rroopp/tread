'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function SessionRecovery() {
  const router = useRouter();
  useEffect(() => {
    void fetch('/api/auth/refresh', { method: 'POST' }).then(async (response) => {
      if (!response.ok) {
        router.replace('/login');
        return;
      }
      router.refresh();
    }).catch(() => router.replace('/login'));
  }, [router]);
  return <main className="onboarding-page"><section className="onboarding-content"><span className="eyebrow">SESSION</span><h1>Renewing access.</h1><p className="onboarding-intro">Your secure session is being refreshed.</p></section></main>;
}
