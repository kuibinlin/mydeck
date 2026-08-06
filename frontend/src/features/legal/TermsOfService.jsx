// Terms of Service — governs use of MyDeck.
// Last updated: 2 April 2026
// To update content, edit this file directly.

export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12 pb-16">
      <p className="text-xs text-muted mb-2">Last updated: 2 April 2026</p>
      <h1 className="text-3xl font-extrabold tracking-tight mb-4 text-text">Terms of Service</h1>
      <p className="text-sm text-muted leading-relaxed mb-8 pb-8 border-b border-border">
        MyDeck is a personal demo project — free to use like a normal web app, but built
        primarily to demonstrate a flashcard and quiz platform. These Terms govern your use
        of MyDeck. By accessing or using MyDeck, you agree to these Terms. If you do not
        agree, please do not use the service.
      </p>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">1. Who can use MyDeck</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          MyDeck is open to anyone. By registering, you confirm that the information
          you provide (email, username) is accurate and that you will keep it up to date.
          You are responsible for all activity that occurs under your account.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">2. Your content</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          You retain ownership of the flashcard decks, challenge questions, and other
          content you create on MyDeck. By creating content, you grant us a non-exclusive,
          royalty-free licence to store, display, and serve that content within the platform.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-2">
          You are solely responsible for ensuring your content does not:
        </p>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">Infringe any third-party intellectual property rights.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Contain harmful, abusive, defamatory, or illegal material.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Violate any applicable law or regulation.</li>
        </ul>
        <p className="text-sm text-muted leading-relaxed mb-2">
          We reserve the right to remove content that violates these Terms without notice.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">3. Acceptable use</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">You agree not to:</p>
        <ul className="pl-5 mb-2">
          <li className="text-sm text-muted leading-relaxed mb-2">Use MyDeck for any unlawful purpose.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Attempt to access, probe, or compromise other users&rsquo; accounts or data.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Interfere with, disrupt, or degrade the performance of the service.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Use automated tools to scrape, crawl, or extract data without permission.</li>
          <li className="text-sm text-muted leading-relaxed mb-2">Attempt to reverse-engineer or compromise the security of the platform.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">4. Leaderboards and public scores</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          Quiz scores you submit may be displayed publicly on challenge leaderboards alongside
          your chosen username. By submitting a score, you consent to this public display.
          If you wish to have your scores removed, contact us at the address below.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">5. Service availability and data</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          MyDeck is provided on a best-effort basis with no uptime guarantees. As a personal
          demo project, the service may be modified, suspended, or shut down at any time.
          In the event of a shutdown, all data will be permanently erased. We will make a
          reasonable effort to announce this in advance, but cannot guarantee prior notice.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-2">
          You are responsible for keeping your own copies of any content you create here.
          Do not rely on MyDeck as your sole storage for important data.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">6. Account termination</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          You may stop using MyDeck at any time. We reserve the right to suspend or
          terminate accounts that violate these Terms. Upon termination, your right
          to use the service ceases immediately.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">7. Disclaimer of warranties</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          MyDeck is provided <strong>&ldquo;as is&rdquo;</strong> and <strong>&ldquo;as available&rdquo;</strong>,
          without warranties of any kind, either express or implied, including but not
          limited to implied warranties of merchantability, fitness for a particular
          purpose, or non-infringement.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">8. Limitation of liability</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          To the fullest extent permitted by applicable law, we shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages, or any
          loss of data, arising out of or in connection with your use of MyDeck.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">9. Changes to these Terms</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          We may update these Terms from time to time. The &ldquo;Last updated&rdquo; date at the
          top of this page will reflect any changes. Your continued use of MyDeck after
          changes are posted constitutes your acceptance of the revised Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold mb-2.5 text-text">10. Contact</h2>
        <p className="text-sm text-muted leading-relaxed mb-2">
          For questions about these Terms, please contact us at:{' '}
          <a href="mailto:contact@linsnotes.com" className="text-primary no-underline hover:underline">
            contact@linsnotes.com
          </a>
        </p>
      </section>
    </div>
  )
}
