import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { purchaseRequestApi } from '../lib/endpoints';
import { Button, Field, Spinner, Textarea } from './ui';
import { apiError } from '../lib/api';
import { useToast } from './Toast';

type PurchaseRequestItem = {
  itemType: 'COURSE' | 'MEMBERSHIP';
  itemId: string;
  title: string;
  description?: string | null;
  price: number;
  currency: string;
  durationDays?: number;
  activationRule?: string;
  includedRooms?: string[];
};

export default function PurchaseRequestForm({
  item,
  onSubmitted,
}: {
  item: PurchaseRequestItem;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [amountPaid, setAmountPaid] = useState(item.price.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const instructions = useQuery({ queryKey: ['purchase-instructions'], queryFn: purchaseRequestApi.instructions });

  const submit = useMutation({
    mutationFn: () => {
      const data = new FormData();
      data.set('itemType', item.itemType);
      data.set('itemId', item.itemId);
      data.set('amountPaid', amountPaid);
      data.set('paymentMethod', paymentMethod);
      data.set('paymentReference', paymentReference);
      if (paymentDate) data.set('paymentDate', paymentDate);
      if (customerNote.trim()) data.set('customerNote', customerNote.trim());
      if (proof) data.set('proof', proof);
      return purchaseRequestApi.create(data);
    },
    onSuccess: (request) => {
      toast(`Request ${request.reference} submitted for review.`, 'success');
      onSubmitted();
    },
    onError: (error) => toast(apiError(error), 'error'),
  });

  return (
    <form
      className="max-h-[70vh] space-y-3 overflow-y-auto pr-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <div className="rounded-xl bg-cream-100 p-3 text-sm">
        <p className="font-semibold">{item.title}</p>
        {item.description && <p className="mt-1 text-xs text-ink-muted">{item.description}</p>}
        <p className="mt-2 font-bold">{item.currency} {item.price.toFixed(2)}</p>
        {item.durationDays && (
          <p className="text-xs text-ink-muted">
            {item.durationDays} days · {item.activationRule === 'AFTER_CURRENT_ACCESS' ? 'starts after your current room access expires' : 'starts when approved'}
          </p>
        )}
        {item.includedRooms?.length ? (
          <p className="text-xs text-ink-muted">
            Rooms: {item.includedRooms.map((room) => room === 'VIP_DERIV' ? 'Deriv VIP' : room === 'VIP_WELTRADE' ? 'Weltrade VIP' : room).join(', ')}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-gold-200 bg-gold-50 p-3 text-xs text-ink-soft">
        <p className="mb-1 font-semibold">Payment instructions</p>
        {instructions.isLoading ? (
          <Spinner />
        ) : instructions.isError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-danger">Payment instructions couldn&apos;t be loaded.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => instructions.refetch()}>Retry</Button>
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{instructions.data?.instructions}</p>
        )}
      </div>

      <p className="text-xs font-semibold text-ink-soft">
        Access is granted only after an administrator independently verifies and approves the payment.
      </p>

      <Field label="Amount paid" type="number" min="0" step="0.01" required value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} />
      <label className="block">
        <span className="label">Payment method</span>
        <select className="input" required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="ECOCASH">EcoCash</option>
          <option value="INNBUCKS">InnBucks</option>
          <option value="ONEMONEY">OneMoney</option>
          <option value="CASH">Cash</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <Field label="Transaction / payment reference" required minLength={2} maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
      <Field label="Payment date (optional)" type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
      <label className="block">
        <span className="label">Payment proof image (JPEG, PNG, or WebP; max 5 MB)</span>
        <input
          className="input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={(event) => setProof(event.target.files?.[0] ?? null)}
        />
      </label>
      <Textarea label="Note (optional)" maxLength={1000} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} />
      <Button type="submit" size="lg" loading={submit.isPending} disabled={!proof || instructions.isLoading || instructions.isError}>
        Submit purchase request
      </Button>
    </form>
  );
}
