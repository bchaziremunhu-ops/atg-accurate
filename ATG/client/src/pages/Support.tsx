import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { Button, Card } from '../components/ui';
import { siteSettingsApi } from '../lib/endpoints';

export default function Support() {
  const settings = useQuery({ queryKey: ['site-settings'], queryFn: siteSettingsApi.public });
  const email = settings.data?.support.email;
  const whatsappPhone = settings.data?.support.whatsappPhone;

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">Help &amp; Support</h1>

      {settings.isError && (
        <Card className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Support contact details couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => settings.refetch()}>Try again</Button>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {email ? (
          <a href={`mailto:${email}`} className="card flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-soft text-gold-600">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Email support</p>
              <p className="text-xs text-ink-muted">{email}</p>
            </div>
          </a>
        ) : (
          <Card className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-ink-muted">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Email support</p>
              <p className="text-xs text-ink-muted">Contact details are not available yet.</p>
            </div>
          </Card>
        )}
        {whatsappPhone ? (
          <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer" className="card flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-soft text-gold-600">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">WhatsApp</p>
              <p className="text-xs text-ink-muted">+{whatsappPhone}</p>
            </div>
          </a>
        ) : (
          <Card className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-ink-muted">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">WhatsApp</p>
              <p className="text-xs text-ink-muted">Contact details are not available yet.</p>
            </div>
          </Card>
        )}
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
