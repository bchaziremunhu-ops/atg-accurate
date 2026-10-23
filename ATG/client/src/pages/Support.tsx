import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { Card } from '../components/ui';

export default function Support() {
  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">Help &amp; Support</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        <a href="mailto:support@atgtraders.example" className="card flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-soft text-gold-600">
            <Mail className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Email support</p>
            <p className="text-xs text-ink-muted">support@atgtraders.example</p>
          </div>
        </a>
        <a href="https://wa.me/263000000000" target="_blank" rel="noreferrer" className="card flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-soft text-gold-600">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">WhatsApp</p>
            <p className="text-xs text-ink-muted">Chat with the team</p>
          </div>
        </a>
      </div>

      <h2 className="section-title mb-2 mt-6">FAQ</h2>
      <div className="space-y-2">
        {[
          { q: 'What is a trading signal?', a: 'A signal is a suggested trade with an entry price, stop-loss and take-profit. Always apply your own risk management.' },
          { q: 'How do VIP signals differ?', a: 'VIP signals include higher-probability setups, full analysis, and live updates. Free signals are limited.' },
          { q: 'How do deposits work?', a: 'Choose a payment method in the Wallet. Deposits are verified automatically by our payment provider.' },
          { q: 'Can I cancel my subscription?', a: 'Yes — go to Profile → Subscription and turn off auto-renew. Access continues until expiry.' },
        ].map((f) => (
          <Card key={f.q}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <LifeBuoy className="h-4 w-4 text-gold-600" /> {f.q}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{f.a}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-cream-200 p-4 text-xs text-ink-muted">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Risk warning: trading synthetic indices and CFDs carries a high level of risk. ATG Traders provides education and
          signals, not financial advice. Only trade with money you can afford to lose.
        </p>
      </div>
      <div className="h-4" />
    </div>
  );
}
