import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Upload } from 'lucide-react';
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
  const [submittedReference, setSubmittedReference] = useState('');
  const instructions = useQuery({ queryKey: ['purchase-instructions'], queryFn: purchaseRequestApi.instructions });
  const itemName = item.itemType === 'MEMBERSHIP' ? 'membership' : 'course';

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
      setSubmittedReference(request.reference);
      toast(`Payment submitted for review. Reference: ${request.reference}`, 'success');
      onSubmitted();
    },
    onError: (error) => toast(apiError(error), 'error'),
  });

  if (submittedReference) {
    return (
      <div className="space-y-4 py-2 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <div>
          <h4 className="text-lg font-bold">{itemName === 'membership' ? 'Membership payment received' : 'Course payment received'}</h4>
          <p className="mt-1 text-sm text-ink-muted">
            We’ll review your payment before enabling {itemName} access. Your request reference is:
          </p>
          <p className="mt-2 inline-block rounded-lg bg-cream-100 px-3 py-2 font-mono font-bold">{submittedReference}</p>
        </div>
        <p className="text-xs text-ink-muted">You can check the review status or contact support from your purchase history.</p>
        <Link to="/profile/purchases" className="btn-gold w-full px-5 py-3 text-sm">
          <ClipboardList className="h-4 w-4" /> View my purchase requests
        </Link>
      </div>
    );
  }

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
        <p className="mt-2 font-bold">Total price: {item.currency} {item.price.toFixed(2)}</p>
        {item.durationDays && (
          <p className="text-xs text-ink-muted">
            {item.durationDays} days · {item.activationRule === 'AFTER_CURRENT_ACCESS' ? 'renewal starts after your current access ends' : 'access starts after payment approval'}
          </p>
        )}
        {item.includedRooms?.length ? (
          <p className="text-xs text-ink-muted">
            Rooms: {item.includedRooms.map((room) => room === 'VIP_DERIV' ? 'Deriv VIP' : room === 'VIP_WELTRADE' ? 'Weltrade VIP' : room).join(', ')}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm text-ink-soft">
        <p className="mb-2 font-semibold">How to pay for your {itemName}</p>
        {instructions.isLoading ? (
          <Spinner />
        ) : instructions.isError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-danger">Payment instructions couldn&apos;t be loaded.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => instructions.refetch()}>Retry</Button>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap">{instructions.data?.instructions}</p>
            <ol className="mt-3 space-y-1 text-xs">
              <li>1. Send the total price shown above using one of the payment methods listed.</li>
              <li>2. Enter how you paid and the transaction reference from your receipt.</li>
              <li>3. Upload a clear photo or screenshot of the receipt, then submit for review.</li>
            </ol>
          </>
        )}
      </div>

      <p className="rounded-lg bg-cream-100 p-3 text-xs text-ink-soft">
        <strong>After you submit:</strong> An administrator checks your payment. Your {itemName} access is enabled only after approval. Track progress under My purchases. Never send a password or account PIN.
      </p>

      <Field
        label="Amount you paid"
        type="number"
        min="0"
        step="0.01"
        required
        value={amountPaid}
        onChange={(event) => setAmountPaid(event.target.value)}
        hint={`Enter the amount you actually sent. Expected total: ${item.currency} ${item.price.toFixed(2)}.`}
      />
      <label className="block">
        <span className="label">Payment method</span>
        <select className="input" required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="ECOCASH">EcoCash</option>
          <option value="INNBUCKS">InnBucks</option>
          <option value="ONEMONEY">OneMoney</option>
          <option value="CASH">Cash</option>
          <option value="OTHER">Other method</option>
        </select>
      </label>
      <Field
        label="Transaction reference"
        placeholder="Reference from your payment message or receipt"
        required
        minLength={2}
        maxLength={120}
        value={paymentReference}
        onChange={(event) => setPaymentReference(event.target.value)}
        hint="Use the transaction ID or reference shown by your bank or wallet."
      />
      <Field label="Payment date (optional)" type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
      <label className="block">
        <span className="label">Payment receipt (required · JPEG, PNG, or WebP · max 5 MB)</span>
        <input
          className="input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={(event) => setProof(event.target.files?.[0] ?? null)}
        />
        <span className="mt-1 flex items-center gap-1 text-xs text-ink-faint">
          <Upload className="h-3.5 w-3.5" /> {proof ? proof.name : 'Choose a clear screenshot or photo of your receipt.'}
        </span>
      </label>
      <Textarea label="Note (optional)" maxLength={1000} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} />
      <Button type="submit" size="lg" loading={submit.isPending} disabled={!proof || instructions.isLoading || instructions.isError}>
        Submit {itemName} payment for review
      </Button>
    </form>
  );
}
