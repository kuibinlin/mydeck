// Privacy Policy — accurate based on what MyDeck actually collects and does.
// Last updated: March 2026
// To update content, edit this file directly.

export default function PrivacyPolicy() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 pb-16">
      <p className="text-xs text-muted mb-2">Last updated: March 2026</p>
      <h1 className="text-3xl font-extrabold tracking-tight mb-4 text-text">Privacy Policy</h1>
      <p className="text-sm text-muted leading-relaxed mb-8 pb-8 border-b border-border">
        MyDeck ("we", "us", "our") is operated by Kuibin Lin and is based in Singapore.
        We are committed to protecting your personal data in accordance with Singapore's
        Personal Data Protection Act (PDPA). This policy explains what data we collect,
        why we collect it, and how we use it.
      </p>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">1. What we collect</h2>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Email address</strong> — required for magic link authentication.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Username</strong> — chosen by you during registration.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>GitHub username and profile ID</strong> — only if you sign in with GitHub.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Content you create</strong> — flashcard decks, challenge questions, and quiz scores.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">2. What we do not collect</h2>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">Payment or financial information</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Location data</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Browsing history</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Advertising or cross-site tracking data</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">3. How we use your data</h2>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">To authenticate you via magic link email or GitHub OAuth.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">To display your username in the app and on public leaderboards.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">To store and serve the flashcard decks and challenges you create.</li>
        </ul>
        <p className="text-sm text-muted leading-relaxed mb-2">
          We do not sell, rent, or share your personal data with third parties for
          marketing purposes.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">4. Third-party services</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          MyDeck uses the following third-party services to operate. Each has its own
          privacy policy.
        </p>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">
            <strong>Resend</strong> — delivers magic link login emails on our behalf.
          </li>
          <li className="text-sm text-muted leading-relaxed mb-2">
            <strong>GitHub</strong> — OAuth authentication if you choose "Continue with GitHub".
            We receive only your GitHub username, ID, and email.
          </li>
          <li className="text-sm text-muted leading-relaxed mb-2">
            <strong>Cloudflare</strong> — all data is stored on Cloudflare infrastructure
            (Workers, D1 database, KV storage). Data is processed on Cloudflare's global
            network.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">5. Cookies</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          We set one <strong>session cookie</strong> when you log in. This cookie is:
        </p>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>HttpOnly</strong> — not accessible to JavaScript, protecting against XSS attacks.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Secure</strong> — only sent over HTTPS.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Used only for authentication</strong> — it does not track you or your behaviour.</li>
          <li className="text-sm text-muted leading-relaxed mb-2"><strong>Valid for 1 year</strong> or until you log out, whichever comes first.</li>
        </ul>
        <p className="text-sm text-muted leading-relaxed mb-2">We do not use advertising cookies or third-party tracking cookies.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">6. Data retention</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          Your account data is retained until you request deletion. Magic link tokens
          expire automatically after 15 minutes. Quiz scores and leaderboard entries
          are retained as long as the associated challenge exists.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">7. Your rights (PDPA)</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">Under Singapore's PDPA, you have the right to:</p>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">Request access to the personal data we hold about you.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Request correction of inaccurate or incomplete data.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Request deletion of your account and associated personal data.</li>
        </ul>
        <p className="text-sm text-muted leading-relaxed mb-2">
          To exercise any of these rights, contact us at the address below.
          We will respond within 30 days.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">8. Changes to this policy</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          We may update this policy from time to time. The "Last updated" date at the
          top of this page will reflect any changes. Continued use of MyDeck after
          changes constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">9. Contact</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          For privacy-related questions or data requests, please contact us at:{' '}
          <a href="mailto:contact@linsnotes.com" className="text-primary no-underline hover:underline">
            contact@linsnotes.com
          </a>
        </p>
      </section>
    </div>
  )
}
