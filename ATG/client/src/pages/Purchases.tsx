import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Receipt as ReceiptIcon, RefreshCcw } from 'lucide-react';
import { paymentApi, purchaseRequestApi, walletApi } from '../lib/endpoints';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import type { Purchase } from '../lib/types';

export default function Purchases() {
  const purchases = useQuery({ queryKey: ['purchases'], queryFn: paymentApi.purchases });
  const requests = useQuery({ queryKey: ['purchase-requests'], queryFn: purchaseRequestApi.list });
  const txns = useQuery({ queryKey: ['transactions'], queryFn: walletApi.transactions });
  const qc = useQueryClient();
  const { toast } = useToast();
  const cancel = useMutation({
    mutationFn: (id: string) => purchaseRequestApi.cancel(id),
    onSuccess: () => {
      toast('Purchase request cancelled.', 'info');
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => toast(apiError(error), 'error'),
  });
  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">Purchase History</h1>

      <h2 className="section-title mb-2">Purchases</h2>
      {purchases.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : purchases.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Purchase history couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => purchases.refetch()}>Try again</Button>
        </Card>
      ) : (purchases.data ?? []).length === 0 ? (
        <Card>
          <EmptyState title="No purchases yet" subtitle="Courses, PDFs and VIP subscriptions will appear here." icon={<FileText />} />
        </Card>
      ) : (
        <div className="space-y-2">
          {purchases.data!.map((p) => (
            <PurchaseRow key={p.id} purchase={p} />
          ))}
        </div>
      )}

      <h2 className="section-title mb-2 mt-6">Purchase requests</h2>
      {requests.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : requests.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Purchase requests couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => requests.refetch()}>Try again</Button>
        </Card>
      ) : (requests.data ?? []).length === 0 ? (
        <Card><EmptyState title="No purchase requests yet" subtitle="Your course and membership requests will appear here." icon={<FileText />} /></Card>
      ) : (
        <div className="space-y-2">
          {requests.data!.map((request) => (
            <Card key={request.id} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{request.itemTitleSnapshot}</p>
                  <p className="text-xs text-ink-muted">
                    {request.reference} · {request.currencySnapshot} {Number(request.amountSnapshot).toFixed(2)} · Submitted {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.durationDaysSnapshot && (
                    <p className="text-xs text-ink-muted">
                      {request.durationDaysSnapshot} days · {roomNames(request.includedRoomsSnapshot)}
                    </p>
                  )}
                </div>
                <Badge tone={request.status === 'APPROVED' ? 'green' : request.status === 'REJECTED' ? 'red' : 'gold'}>
                  {request.status.replace('_', ' ')}
                </Badge>
              </div>
              {request.decisionReason && <p className="text-xs text-danger">Decision reason: {request.decisionReason}</p>}
              {request.customerMessage && <p className="rounded-lg bg-cream-100 p-2 text-xs">{request.customerMessage}</p>}
              {request.status === 'APPROVED' && request.approvalReference && (
                <p className="text-xs text-success">Approved reference: {request.approvalReference}</p>
              )}
              <div className="space-y-1 border-t border-cream-200 pt-2">
                {request.events.map((event) => (
                  <p key={event.id} className="text-[11px] text-ink-muted">
                    {new Date(event.createdAt).toLocaleString()} · {event.action.replace('_', ' ')}
                    {event.reason ? ` — ${event.reason}` : ''}
                    {event.customerMessage ? ` · ${event.customerMessage}` : ''}
                  </p>
                ))}
              </div>
              {(request.status === 'SUBMITTED' || request.status === 'UNDER_REVIEW') && (
                <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
                  Cancel request
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <h2 className="section-title mb-2 mt-6">Transactions</h2>
      {txns.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : txns.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Transactions couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => txns.refetch()}>Try again</Button>
        </Card>
      ) : (txns.data ?? []).length === 0 ? (
        <Card><EmptyState title="No transactions yet" subtitle="Wallet activity will appear here." icon={<ReceiptIcon />} /></Card>
      ) : (
        <div className="space-y-2">
          {txns.data!.map((t) => (
            <Card key={t.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold capitalize">{t.type.toLowerCase()}</p>
                <p className="text-xs text-ink-muted">
                  {new Date(t.createdAt).toLocaleString()} · {t.reference}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">${t.amount.toFixed(2)}</p>
                <Badge tone={t.status === 'COMPLETED' ? 'green' : t.status === 'FAILED' ? 'red' : 'grey'}>{t.status}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}

function roomNames(snapshot?: string | null): string {
  try {
    const rooms: unknown = JSON.parse(snapshot ?? '[]');
    if (!Array.isArray(rooms) || !rooms.every((room) => typeof room === 'string')) {
      return 'Room details unavailable';
    }
    return rooms.map((room: string) => room === 'VIP_DERIV' ? 'Deriv VIP' : room === 'VIP_WELTRADE' ? 'Weltrade VIP' : room).join(', ');
  } catch {
    return 'Room details unavailable';
  }
}

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');

  const refund = useMutation({
    mutationFn: () => paymentApi.requestRefund(purchase.id, refundReason),
    onSuccess: () => {
      toast('Refund request submitted — an admin will review it.', 'success');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      setRefundOpen(false);
      setRefundReason('');
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const openRefund = purchase.refunds?.find((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const canRefund = purchase.status === 'PAID' && !openRefund;

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-600">
          <FileText className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{purchase.itemTitle}</p>
          <p className="text-xs text-ink-muted">
            {purchase.itemType} · {new Date(purchase.createdAt).toLocaleDateString()} · {purchase.method ?? purchase.provider}
            {purchase.providerRef && ` · ${purchase.providerRef}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">${Number(purchase.amount).toFixed(2)}</p>
          <Badge tone={purchase.status === 'PAID' ? 'green' : purchase.status === 'FAILED' ? 'red' : 'grey'}>{purchase.status}</Badge>
        </div>
      </div>

      {purchase.status === 'PAID' && (
        <div className="flex flex-wrap items-center gap-3 border-t border-cream-200 pt-2">
          {purchase.receipt && (
            <Link to={`/receipts/${purchase.receipt.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600">
              <ReceiptIcon className="h-3.5 w-3.5" /> View receipt
            </Link>
          )}
          {openRefund && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <RefreshCcw className="h-3.5 w-3.5" /> Refund {openRefund.status.toLowerCase()}
            </span>
          )}
          {canRefund &&
            (refundOpen ? (
              <div className="w-full space-y-2">
                <input
                  className="input py-2"
                  placeholder="Why are you requesting a refund?"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" loading={refund.isPending} disabled={refundReason.trim().length < 5} onClick={() => refund.mutate()}>
                    Submit request
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefundOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button className="text-xs font-semibold text-ink-muted underline" onClick={() => setRefundOpen(true)}>
                Request a refund
              </button>
            ))}
        </div>
      )}
    </Card>
  );
}
