import Link from 'next/link';
import type { Metadata } from 'next';
import { LandingMotion } from './landing-motion';

export const metadata: Metadata = {
  title: 'TREAD — A clearer path from digital assets to bank settlement',
  description: 'Compliance-led off-ramp infrastructure for fintechs and payment companies. KES ↔ USDC is the first corridor in development.',
};

const apiUrl = process.env.TREAD_PUBLIC_API_URL ?? process.env.TREAD_API_URL ?? 'http://localhost:3000';

function TreadMark() {
  return <Link href="/" className="tread-wordmark" aria-label="TREAD home"><img src="/tread-logo-dark.svg" alt="TREAD" /></Link>;
}

function Globe() {
  return (
    <svg className="landing-globe" viewBox="0 0 1200 480" role="img" aria-label="A pointillist world map representing cross-border financial infrastructure">
      <defs>
        <pattern id="globe-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.3" cy="1.3" r="1" fill="#F7F9F6" /></pattern>
        <clipPath id="globe-clip"><path d="M44 149 83 107l65-22 43 10 40-22 48 11 34 29 29 8 12 25-22 24-41 5-23 23-52 2-32 25-45-9-18-26-39-2-24-20Zm217 115 36 10 27 34-8 39-19 32-7 57-25 40-23-29-5-43-24-38 7-40 20-31Zm207-163 30-29 44 7 26 27-21 22-38 5-18 16-31-16Zm50 74 42-27 58 12 29 37-12 45-22 18-4 44-29 23-13 44-28 23-29-29-4-43-27-24 5-40-22-26 10-36Zm156-88 59-30 75 11 51 30 70 8 63 44-19 31-54-8-35 27-48-14-32 30-49-13-23-28-44 9-24-30-50-10-24-33Zm199 232 44-14 47 20 24 36-32 19-48-12-32-22Z" /></clipPath>
      </defs>
      <rect x="0" y="0" width="1200" height="480" fill="url(#globe-dots)" clipPath="url(#globe-clip)" opacity=".72" />
      <g fill="none" stroke="#F7F9F6" strokeOpacity=".12" strokeWidth="1">
        <path d="M36 148 83 105l65-22 43 10 40-22 48 11 34 29 29 8 12 25-22 24-41 5-23 23-52 2-32 25-45-9-18-26-39-2-24-20Z" />
        <path d="m261 264 36 10 27 34-8 39-19 32-7 57-25 40-23-29-5-43-24-38 7-40 20-31Z" />
        <path d="m518 101 30-29 44 7 26 27-21 22-38 5-18 16-31-16Z" />
        <path d="m518 175 42-27 58 12 29 37-12 45-22 18-4 44-29 23-13 44-28 23-29-29-4-43-27-24 5-40-22-26 10-36Z" />
        <path d="m674 87 59-30 75 11 51 30 70 8 63 44-19 31-54-8-35 27-48-14-32 30-49-13-23-28-44 9-24-30-50-10-24-33Z" />
        <path d="m873 319 44-14 47 20 24 36-32 19-48-12-32-22Z" />
      </g>
      <path d="M138 329Q386 112 608 254T1061 290" fill="none" stroke="#C5FF36" strokeWidth="1.4" strokeDasharray="2 8" opacity=".85" />
      <circle cx="138" cy="329" r="5" fill="#C5FF36" /><circle cx="1061" cy="290" r="5" fill="#FF3E96" />
    </svg>
  );
}

function Eyebrow({ children, index }: { children: string; index: string }) {
  return <div className="landing-eyebrow-row"><span className="landing-eyebrow">[ {children} ]</span><span className="landing-index">{index}</span></div>;
}

export default function LandingPage() {
  return (
    <main className="tread-landing" id="top">
      <LandingMotion />
      <header className="landing-topbar">
        <div className="landing-topbar-inner">
          <TreadMark />
          <nav className="landing-menu" aria-label="Main navigation">
            <a href="#platform">PLATFORM</a><a href="#corridor">CORRIDOR</a><a href="#controls">CONTROLS</a><a href="#developers">DEVELOPERS</a>
          </nav>
          <div className="landing-nav-actions"><Link href="/dashboard" className="landing-nav-sandbox">SANDBOX <span>↗</span></Link><Link href="/onboarding" className="landing-nav-cta">TALK TO TREAD <span>↗</span></Link></div>
        </div>
      </header>

      <section className="landing-hero-dark" aria-labelledby="landing-title">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy-dark">
          <span className="landing-eyebrow">[ COMPLIANCE-LED SETTLEMENT INFRASTRUCTURE ]</span>
          <h1 id="landing-title">A clearer path from digital assets to <em>bank settlement.</em></h1>
          <p>Evidence-led off-ramp infrastructure for fintechs and payment companies moving high-value digital assets into the banking system.</p>
          <div className="hero-actions-dark"><Link href="/onboarding" className="signal-button">DISCUSS INSTITUTIONAL ACCESS <span>↗</span></Link><Link href="/dashboard" className="text-link-dark">OPEN THE SANDBOX <span>→</span></Link></div>
          <div className="hero-status"><span className="status-pip" /> SANDBOX ENVIRONMENT · NO LIVE PROVIDER CONNECTED · NO FUNDS MOVE</div>
        </div>
        <div className="hero-visual-dark"><Globe /><div className="globe-tag tag-kenya"><i /> KES · EAST AFRICA</div><div className="globe-tag tag-usdc"><i /> USDC · DIGITAL ASSET</div><div className="globe-center-label"><img src="/tread-logo-dark.svg" alt="TREAD"/><span>ROUTE WITH EVIDENCE · NON-CUSTODIAL DESIGN</span></div><div className="globe-coordinate">01°17′S / 36°49′E</div></div>
        <div className="hero-bottomline"><span>FIRST CORRIDOR IN DEVELOPMENT</span><span>KES <b>↔</b> USDC</span><span>BUILT FOR FINTECHS &amp; PAYMENT COMPANIES</span></div>
      </section>

      <div className="signal-divider" aria-hidden="true" />
      <div className="landing-ticker" aria-label="Sandbox only, evidence first, live corridor in development"><div className="landing-ticker-track"><span>SIMULATED ONLY <i>×</i> EVIDENCE FIRST <i>×</i> NO LIVE PROVIDER CONNECTED <i>×</i> KES ↔ USDC CORRIDOR IN DEVELOPMENT <i>×</i></span><span aria-hidden="true">SIMULATED ONLY <i>×</i> EVIDENCE FIRST <i>×</i> NO LIVE PROVIDER CONNECTED <i>×</i> KES ↔ USDC CORRIDOR IN DEVELOPMENT <i>×</i></span></div></div>

      <div className="landing-content">
        <section className="editorial-section thesis-section" id="platform">
          <Eyebrow index="T / 01">THE OPERATING IDEA</Eyebrow>
          <div className="thesis-grid"><h2>Make the <em>evidence</em><br />travel with the value.</h2><div className="editorial-copy"><p>Digital-asset off-ramps cross systems that ask different questions. TREAD is being built to coordinate the transaction record, screening context, and provider hand-offs in one controlled workflow.</p><p className="muted-copy">The goal is a reviewable source-of-funds package for a receiving bank. Acceptance remains the decision of that institution.</p></div></div>
          <div className="principle-line"><div><span>01 / DECLARE</span><b>Origin of funds</b><small>Capture the customer’s stated source and supporting references.</small></div><i>→</i><div><span>02 / REVIEW</span><b>Screen &amp; assess</b><small>Record decisions and keep the evidence behind each outcome.</small></div><i>→</i><div><span>03 / RECONCILE</span><b>Track the hand-off</b><small>Connect provider events with the transaction timeline.</small></div></div>
        </section>

        <section className="editorial-section corridor-section" id="corridor">
          <Eyebrow index="T / 02">THE FIRST CORRIDOR</Eyebrow>
          <div className="corridor-heading"><h2>One corridor.<br /><em>One licensed partner.</em></h2><p>Start with the operational details that matter: clear evidence, controlled conversion, and a bank-side settlement record.</p></div>
          <div className="corridor-band"><div className="corridor-side"><span>LOCAL SETTLEMENT</span><strong>KES</strong><small>Kenyan shilling</small></div><div className="corridor-middle"><div className="corridor-rule"><span /><i /><span /></div><b>TREAD ORCHESTRATION</b><small>Evidence · screening · provider hand-off</small></div><div className="corridor-side corridor-side-right"><span>DIGITAL ASSET</span><strong>USDC</strong><small>USD Coin</small></div></div>
          <div className="truth-strip"><span className="pink-marker" /> <b>IN DEVELOPMENT</b><p>No live bank, exchange, custody, or blockchain provider is connected. This corridor is currently available for sandbox workflow simulation only.</p></div>
        </section>

        <section className="editorial-section controls-section" id="controls">
          <Eyebrow index="T / 03">CONTROL BY DESIGN</Eyebrow>
          <div className="controls-layout"><div><h2>Built around the record, <em>not custody.</em></h2><p className="editorial-copy standalone">TREAD coordinates software workflows. A licensed third-party provider would execute any real conversion or payout; TREAD does not hold customer funds or operate custody.</p><Link href="/dashboard/compliance" className="underlined-link">EXPLORE SANDBOX CONTROLS <span>↗</span></Link></div><div className="control-list"><article><span>01</span><div><b>Tenant-scoped access</b><p>Institution and environment boundaries across API credentials and operations.</p></div><span className="control-mark">/</span></article><article><span>02</span><div><b>Append-only decisions</b><p>Compliance outcomes are recorded with their environment and transaction context.</p></div><span className="control-mark">/</span></article><article><span>03</span><div><b>Balanced ledger records</b><p>Immutable double-entry accounting supports traceable internal records.</p></div><span className="control-mark">/</span></article><article><span>04</span><div><b>Explicit simulation</b><p>Sandbox outcomes stay labeled simulated and never represent settled funds.</p></div><span className="control-mark">/</span></article></div></div>
        </section>

        <section className="editorial-section audience-section">
          <Eyebrow index="T / 04">BUILT FOR THE OPERATORS</Eyebrow>
          <div className="audience-grid"><h2>Two sides of a <em>cleaner hand-off.</em></h2><article><span>A / FINTECHS &amp; PAYMENT COMPANIES</span><h3>Make complex flows reviewable.</h3><p>Build a controlled off-ramp experience with clear transaction state, consistent evidence capture, and a partner-ready integration boundary.</p><Link href="/onboarding">DISCUSS A PILOT <b>↗</b></Link></article><article><span>B / BANKS &amp; REVIEW TEAMS</span><h3>See the context behind a transfer.</h3><p>Work toward a coherent view of declared origin, screening records, transaction events, and provider evidence for review.</p><a href="#evidence">HOW EVIDENCE FITS <b>↓</b></a></article></div>
        </section>

        <section className="evidence-section" id="evidence"><div className="evidence-copy"><Eyebrow index="T / 05">SOURCE-OF-FUNDS EVIDENCE</Eyebrow><h2>A package designed for <em>human review.</em></h2><p>The product direction is a structured evidence record that can bring declarations, document references, wallet ownership details, screening outcomes, and review history together around a transaction.</p><div className="evidence-note"><span>STATUS / DESIGN IN PROGRESS</span><p>Bank acceptance is never guaranteed by software. Verification claims require a recorded decision from an authorized provider.</p></div></div><div className="evidence-terminal"><div className="terminal-top"><span>CASE / KES-USDC / 0001</span><span className="terminal-state">SCHEMA IN PROGRESS</span></div><div className="terminal-row"><small>DECLARED_ORIGIN</small><code>customer_submitted</code></div><div className="terminal-row"><small>SUPPORTING_RECORD</small><code>encrypted_reference://…</code></div><div className="terminal-row"><small>SCREENING_DECISION</small><code className="terminal-pending">pending_provider_record</code></div><div className="terminal-row"><small>WALLET_EVIDENCE</small><code>awaiting_customer_evidence</code></div><div className="terminal-row"><small>SETTLEMENT_STATE</small><code>SIMULATED · NO FUNDS MOVED</code></div><div className="terminal-foot"><span>APPEND-ONLY RECORD</span><span>● SANDBOX</span></div></div></section>

        <section className="editorial-section developer-section-dark" id="developers"><Eyebrow index="T / 06">FOR BUILDERS</Eyebrow><div className="developer-dark-grid"><div><h2>Start with the <em>workflow.</em></h2><p>Explore the sandbox, create institution-scoped credentials, request a quote, and exercise transaction states through the API.</p><div className="developer-dark-actions"><Link href="/dashboard/developers" className="signal-button">OPEN DEVELOPER CONSOLE <span>↗</span></Link><a href={`${apiUrl}/docs`} target="_blank" rel="noreferrer" className="text-link-dark">API REFERENCE <span>↗</span></a></div></div><div className="code-panel-dark"><div className="code-panel-head"><span>REQUEST / SANDBOX</span><span>01 — 04</span></div><pre><code><i>POST</i> /v1/quotes{`\n`}{`{`}{`\n  `}<b>"sourceAssetCode"</b>: <em>"USDC"</em>,{`\n  `}<b>"destinationAssetCode"</b>: <em>"KES"</em>,{`\n  `}<b>"sourceAmountMinor"</b>: <em>"2500000"</em>{`\n}`}</code></pre><div className="code-panel-foot"><span>QUOTE REQUEST · SANDBOX ONLY</span><span>NO PROVIDER EXECUTION</span></div></div></div></section>

        <section className="closing-section"><Eyebrow index="T / 07">THE NEXT STEP</Eyebrow><h2>Build a more <em>reviewable</em><br />route into banking.</h2><p>We’re working with fintechs and payment companies on the first corridor, provider requirements, and evidence workflow.</p><div className="closing-actions"><Link href="/onboarding" className="signal-button">START A CONVERSATION <span>↗</span></Link><Link href="/dashboard" className="text-link-dark">ENTER SANDBOX <span>→</span></Link></div><span className="closing-disclosure">TREAD IS IN DEVELOPMENT. LIVE PROVIDER EXECUTION IS NOT AVAILABLE.</span></section>
      </div>

      <footer className="landing-footer-dark"><div className="footer-dark-top"><TreadMark /><span>COMPLIANCE-LED OFF-RAMP INFRASTRUCTURE</span><a href="#top">BACK TO TOP ↑</a></div><div className="footer-dark-bottom"><span>© TREAD · INSTITUTIONAL FINANCIAL INFRASTRUCTURE</span><span>Sandbox is simulated. No funds are held or moved by TREAD.</span><div><Link href="/dashboard">SANDBOX</Link><a href={`${apiUrl}/docs`} target="_blank" rel="noreferrer">API DOCS</a></div></div></footer>
    </main>
  );
}
