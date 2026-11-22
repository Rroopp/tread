import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in | TREAD' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ institutionId?: string }> }) {
  const params = await searchParams;
  return <main className="onboarding-page"><header className="onboarding-header"><a href="/">TREAD</a><a href="/">← Home</a></header><section className="onboarding-content"><div className="eyebrow">INSTITUTIONAL ACCESS</div><h1>Sign in to TREAD.</h1><p className="onboarding-intro">Use your institution workspace credentials.</p><LoginForm institutionId={params.institutionId ?? ''} /></section></main>;
}
