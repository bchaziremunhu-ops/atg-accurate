import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AppShell';

export default function Legal() {
  return (
    <AuthShell>
      <div className="card space-y-8 p-6">
        <section id="terms">
          <h1 className="text-2xl font-bold">Terms &amp; Conditions</h1>
          <div className="mt-3 space-y-3 text-sm text-ink-muted">
            <p>
              By creating an ATG Traders account you confirm that the information you provide (full legal
              name, country of residence, nationality, phone number, date of birth and — optionally —
              residential address) is accurate and that you are legally able to enter into this agreement.
            </p>
            <p>
              Your account is personal. Do not share your password or security answer. You are responsible
              for activity performed while signed in. Trading signals and educational content are provided
              for information only and are not financial advice; you are responsible for your own trading
              decisions.
            </p>
            <p>
              We may suspend accounts used for abuse, fraud or unlawful activity. You can stop using the
              service at any time by signing out; contact support to request deletion of your account.
            </p>
          </div>
        </section>

        <section id="privacy">
          <h1 className="text-2xl font-bold">Privacy Policy</h1>
          <div className="mt-3 space-y-3 text-sm text-ink-muted">
            <p>
              <strong className="text-ink">What we collect:</strong> the details you enter at registration —
              full legal name, country of residence, nationality, phone number, date of birth, an optional
              residential address, a security question with your private answer, and a password. We also
              store standard security logs (sign-ins, password recoveries) to protect your account.
            </p>
            <p>
              <strong className="text-ink">How it is protected:</strong> passwords and security answers are
              never stored in readable form — they are irreversibly hashed. Recovery checks are performed
              on our servers; your private answer is never shown back to you or shared with anyone.
            </p>
            <p>
              <strong className="text-ink">How it is used:</strong> to run your account, keep it secure,
              and show your own profile to you. We do not sell your personal data. Phone numbers are used
              only as your sign-in identity and for account recovery — we never send SMS or email
              verification codes, and your number is never used for marketing by third parties.
            </p>
            <p>
              <strong className="text-ink">Your choices:</strong> keep your details accurate, and contact
              support at any time to access or delete your personal data.
            </p>
          </div>
        </section>

        <p className="text-center text-sm">
          <Link to="/register" className="font-semibold text-gold-600">
            Back to registration
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
