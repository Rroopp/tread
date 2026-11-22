import Link from 'next/link';
import { OnboardingForm } from './onboarding-form';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Institution onboarding | TREAD' };

export default function OnboardingPage() {
  return (
    <main className="onboarding-page">
      <header className="onboarding-header"><Link className="brand" href="/"><img className="brand-logo" src="/tread-logo-light.svg" alt="" /></Link><Link className="back-link" href="/">← Back to home</Link></header>
      <div className="onboarding-content">
        <div className="eyebrow">INSTITUTIONAL ACCESS</div>
        <h1>Start your<br /><em>onboarding.</em></h1>
        <p className="onboarding-intro">Tell us about your institution. We’ll review your application and follow up.</p>
        <OnboardingForm />
        <p className="form-note">This creates a pending application. It does not open an account.</p>
      </div>
    </main>
  );
}
