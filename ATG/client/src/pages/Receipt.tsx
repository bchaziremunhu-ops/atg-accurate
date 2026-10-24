import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { paymentApi } from '../lib/endpoints';
import { Button, Card, Spinner } from '../components/ui';

export default function Receipt() {
  const { id = '' } = useParams();
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => paymentApi.receipt(id), enabled: Boolean(id) });

  if (receipt.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-gold-400" />
      </div>
    );
  }
  if (receipt.isError || !receipt.data) {
    return (
      <div className="animate-rise px-4 pt-8 text-center">
        <p className="text-sm text-ink-muted">Receipt not found.</p>
        <Link to="/profile/purchases" className="mt-2 inline-block text-sm font-semibold text-gold-600 underline">
          Back to purchases
        </Link>
      </div>
    );
  }

  const r = receipt.data;
  const amount = Number(r.amount).toFixed(2);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/profile/purchases" className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <ArrowLeft className="h-4 w-4" /> Purchases
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <Card className="mx-auto max-w-lg">
        <div className="border-b border-cream-200 pb-4 text-center">
          <p className="text-lg font-extrabold tracking-[0.1em] text-gold-600">ACCURATE TRADING GROUP</p>
          <p className="text-xs text-ink-muted">BEST TRADING EXPERIENCE</p>
          <p className="mt-3 text-sm font-bold">RECEIPT</p>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Receipt number</dt>
            <dd className="font-mono font-semibold">{r.receiptNumber}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Date paid</dt>
            <dd>{new Date(r.paidAt).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Item</dt>
            <dd className="text-right font-semibold">{r.itemTitle}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Type</dt>
            <dd className="capitalize">{r.itemType.toLowerCase()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Payment method</dt>
            <dd className="uppercase">{r.method ?? r.purchase?.provider ?? '—'}</dd>
          </div>
          {r.purchase?.providerRef && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Provider reference</dt>
              <dd className="font-mono text-xs">{r.purchase.providerRef}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-cream-200 pt-3 text-base font-extrabold">
            <dt>Total paid</dt>
            <dd>
              {r.currency} {amount}
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-center text-xs text-ink-muted">
          This receipt confirms a verified payment to Accurate Trading Group. Payment verification is performed
          server-side — this document is not a payment instrument.
        </p>
      </Card>
      <div className="h-4" />
    </div>
  );
}
