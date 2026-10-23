import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchaseRequestApi } from '../lib/endpoints';
import type { MembershipPackage, PurchaseRequest } from '../lib/types';
import { Badge, Button, Card, EmptyState, Field, Select, Spinner, Textarea } from './ui';
import { useToast } from './Toast';
import { apiError } from '../lib/api';

type PackageForm = Omit<MembershipPackage, 'id' | 'price'> & { price: number };
const newPackage: PackageForm = {
  slug: '',
  title: '',
  description: '',
  price: 0,
  currency: 'USD',
  durationDays: 30,
  activationRule: 'APPROVAL',
  includedRooms: ['VIP_WELTRADE'],
  saleStatus: 'AVAILABLE',
};

export default function AdminPurchaseRequests() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<PackageForm>(newPackage);
  const [editing, setEditing] = useState<string | null>(null);
  const requests = useQuery({ queryKey: ['admin-purchase-requests', status], queryFn: () => purchaseRequestApi.adminRequests(status || undefined) });
  const packages = useQuery({ queryKey: ['admin-membership-packages'], queryFn: purchaseRequestApi.adminPackages });
  const instructions = useQuery({ queryKey: ['admin-purchase-instructions'], queryFn: purchaseRequestApi.adminInstructions });
  const [instructionText, setInstructionText] = useState('');

  useEffect(() => {
    if (instructions.data) setInstructionText(instructions.data.instructions);
  }, [instructions.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-membership-packages'] });
    qc.invalidateQueries({ queryKey: ['membership-packages'] });
    qc.invalidateQueries({ queryKey: ['admin-purchase-requests'] });
  };
  const savePackage = useMutation({
    mutationFn: () => editing
      ? purchaseRequestApi.updatePackage(editing, form)
      : purchaseRequestApi.createPackage(form),
    onSuccess: () => {
      toast(editing ? 'Membership package updated.' : 'Membership package created.', 'success');
      setForm(newPackage);
      setEditing(null);
      refresh();
    },
    onError: (error) => toast(apiError(error), 'error'),
  });
  const saveInstructions = useMutation({
    mutationFn: () => purchaseRequestApi.updateInstructions(instructionText),
    onSuccess: () => {
      toast('Payment instructions saved.', 'success');
      qc.invalidateQueries({ queryKey: ['purchase-instructions'] });
      qc.invalidateQueries({ queryKey: ['admin-purchase-instructions'] });
    },
    onError: (error) => toast(apiError(error), 'error'),
  });

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <h2 className="section-title">Payment instructions</h2>
        <Textarea
          label="Customer-facing instructions"
          maxLength={5000}
          value={instructionText}
          onChange={(event) => setInstructionText(event.target.value)}
          placeholder="Enter approved payment instructions. Never request a PIN or password."
        />
        <Button className="w-full sm:w-auto" onClick={() => saveInstructions.mutate()} loading={saveInstructions.isPending} disabled={instructionText.trim().length < 10}>
          Save instructions
        </Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="section-title">{editing ? 'Edit membership package' : 'Create membership package'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Package name" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value, slug: editing ? form.slug : event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} />
          <Field label="Slug" required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
          <Field label="Price" type="number" min="0.01" step="0.01" required value={String(form.price)} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} />
          <Field label="Currency" maxLength={3} required value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} />
          <Field label="Duration (days)" type="number" min="1" max="3650" required value={String(form.durationDays)} onChange={(event) => setForm({ ...form, durationDays: Number(event.target.value) })} />
          <Select label="Membership starts" value={form.activationRule} onChange={(event) => setForm({ ...form, activationRule: event.target.value as PackageForm['activationRule'] })}>
            <option value="APPROVAL">On approval</option>
            <option value="AFTER_CURRENT_ACCESS">After current access expires</option>
          </Select>
          <Select label="Sale status" value={form.saleStatus} onChange={(event) => setForm({ ...form, saleStatus: event.target.value as PackageForm['saleStatus'] })}>
            <option value="AVAILABLE">Available</option>
            <option value="UNAVAILABLE">Unavailable</option>
            <option value="HIDDEN">Hidden</option>
            <option value="SOLD_OUT">Sold out</option>
          </Select>
        </div>
        <Textarea label="Description" maxLength={3000} value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <div className="space-y-1 text-sm">
          <p className="label">Included VIP rooms</p>
          {(['VIP_DERIV', 'VIP_WELTRADE'] as const).map((room) => (
            <label key={room} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-gold-700"
                checked={form.includedRooms.includes(room)}
                onChange={(event) => setForm({
                  ...form,
                  includedRooms: event.target.checked
                    ? [...form.includedRooms, room]
                    : form.includedRooms.filter((value) => value !== room),
                })}
              />
              {room === 'VIP_DERIV' ? 'Deriv VIP' : 'Weltrade VIP'}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => savePackage.mutate()}
            loading={savePackage.isPending}
            disabled={!form.title.trim() || !form.slug.trim() || form.price <= 0 || form.durationDays < 1 || !form.includedRooms.length}
          >
            {editing ? 'Save package' : 'Create package'}
          </Button>
          {editing && <Button variant="ghost" onClick={() => { setEditing(null); setForm(newPackage); }}>Cancel</Button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(packages.data ?? []).map((item) => (
            <Card key={item.id} className="space-y-1 bg-cream-50">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{item.title}</p>
                <Badge tone={item.saleStatus === 'AVAILABLE' ? 'green' : 'grey'}>{item.saleStatus.replace('_', ' ')}</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                {item.currency} {Number(item.price).toFixed(2)} · {item.durationDays} days · {item.activationRule.replace(/_/g, ' ').toLowerCase()} · {item.includedRooms.join(', ')}
              </p>
              <Button size="sm" variant="outline" onClick={() => {
                setEditing(item.id);
                setForm({ ...item, price: Number(item.price) });
              }}>Edit package</Button>
            </Card>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Purchase request review queue</h2>
          <Select aria-label="Filter purchase requests by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'].map((value) => <option key={value}>{value}</option>)}
          </Select>
        </div>
        {requests.isLoading ? <Spinner /> : requests.isError ? (
          <p className="text-sm text-danger">Could not load purchase requests.</p>
        ) : !requests.data?.length ? (
          <EmptyState title="No requests to review" subtitle="Submitted course and membership requests will appear here." />
        ) : requests.data.map((request) => (
          <ReviewCard key={request.id} request={request} onChanged={refresh} />
        ))}
      </Card>
    </div>
  );
}

function ReviewCard({ request, onChanged }: { request: PurchaseRequest; onChanged: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [duplicateResolved, setDuplicateResolved] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const canDecide = request.status === 'SUBMITTED' || request.status === 'UNDER_REVIEW';

  useEffect(() => () => {
    if (proofUrl) URL.revokeObjectURL(proofUrl);
  }, [proofUrl]);

  const proof = useMutation({
    mutationFn: () => purchaseRequestApi.proof(request.id),
    onSuccess: (blob) => setProofUrl(URL.createObjectURL(blob)),
    onError: (error) => toast(apiError(error), 'error'),
  });
  const review = useMutation({
    mutationFn: (action: 'UNDER_REVIEW' | 'APPROVE' | 'REJECT') =>
      purchaseRequestApi.review(request.id, {
        action,
        reason: reason.trim() || undefined,
        customerMessage: customerMessage.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        paymentChecked,
        duplicateReferenceResolved: duplicateResolved,
      }),
    onSuccess: (_result, action) => {
      toast(action === 'APPROVE' ? 'Request approved and access granted.' : action === 'REJECT' ? 'Request rejected.' : 'Request moved to review.', 'success');
      onChanged();
    },
    onError: (error) => toast(apiError(error), 'error'),
  });

  return (
    <Card className="space-y-3 border-cream-200 bg-cream-50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">{request.itemTitleSnapshot}</p>
          <p className="break-words text-xs text-ink-muted">{request.reference} · {request.user?.name} ({request.user?.email})</p>
          <p className="text-[11px] text-ink-faint">User ID: {request.user?.id}</p>
        </div>
        <Badge tone={request.status === 'APPROVED' ? 'green' : request.status === 'REJECTED' ? 'red' : request.duplicateReference ? 'red' : 'gold'}>
          {request.status.replace('_', ' ')}
        </Badge>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <p className="min-w-0 break-words rounded-lg border border-cream-200 bg-white p-2">Price snapshot: {request.currencySnapshot} {Number(request.amountSnapshot).toFixed(2)}</p>
        <p className="min-w-0 break-words rounded-lg border border-cream-200 bg-white p-2">Amount reported paid: {request.currencySnapshot} {Number(request.amountPaid).toFixed(2)}</p>
        <p className="min-w-0 break-words rounded-lg border border-cream-200 bg-white p-2">Method: {request.paymentMethod}</p>
        <p className="min-w-0 break-words rounded-lg border border-cream-200 bg-white p-2">Transaction reference: {request.paymentReference}</p>
        <p className="rounded-lg border border-cream-200 bg-white p-2">Payment date: {request.paymentDate ? new Date(request.paymentDate).toLocaleDateString() : 'Not provided'}</p>
        <p className="rounded-lg border border-cream-200 bg-white p-2">Submitted: {new Date(request.createdAt).toLocaleString()}</p>
        {request.durationDaysSnapshot && <p className="rounded-lg border border-cream-200 bg-white p-2">Duration: {request.durationDaysSnapshot} days · starts {request.activationRuleSnapshot === 'AFTER_CURRENT_ACCESS' ? 'after current access expires' : 'on approval'}</p>}
        {request.includedRoomsSnapshot && <p className="rounded-lg border border-cream-200 bg-white p-2">Rooms: {roomNames(request.includedRoomsSnapshot)}</p>}
      </div>
      {request.duplicateReference && <p className="rounded bg-red-100 p-2 text-xs font-semibold text-danger">Duplicate payment reference — investigate before approval.</p>}
      {request.customerNote && <p className="text-xs">Customer note: {request.customerNote}</p>}
      <Button size="sm" variant="outline" loading={proof.isPending} onClick={() => proof.mutate()}>View payment proof</Button>
      {proofUrl && <img src={proofUrl} alt={`Payment proof for ${request.reference}`} className="max-h-80 max-w-full rounded-lg object-contain" />}

      {canDecide && (
        <div className="space-y-2 border-t border-cream-200 pt-2">
          <Textarea label="Rejection reason (required to reject)" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
          <Textarea label="Customer-visible message (optional)" value={customerMessage} maxLength={1000} onChange={(event) => setCustomerMessage(event.target.value)} />
          <Textarea label="Internal notes (admins only)" value={internalNotes} maxLength={3000} onChange={(event) => setInternalNotes(event.target.value)} />
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" className="accent-gold-700" checked={paymentChecked} onChange={(event) => setPaymentChecked(event.target.checked)} />
            I independently checked and confirmed the payment was received.
          </label>
          {request.duplicateReference && (
            <label className="flex items-center gap-2 text-xs font-semibold text-danger">
              <input type="checkbox" className="accent-gold-700" checked={duplicateResolved} onChange={(event) => setDuplicateResolved(event.target.checked)} />
              I investigated the reused reference and recorded the outcome in internal notes.
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {request.status === 'SUBMITTED' && (
              <Button size="sm" variant="outline" loading={review.isPending} onClick={() => review.mutate('UNDER_REVIEW')}>Mark under review</Button>
            )}
            <Button size="sm" loading={review.isPending} disabled={!paymentChecked || (request.duplicateReference && (!duplicateResolved || internalNotes.trim().length < 5))} onClick={() => review.mutate('APPROVE')}>Approve payment</Button>
            <Button size="sm" variant="danger" loading={review.isPending} disabled={reason.trim().length < 3} onClick={() => review.mutate('REJECT')}>Reject request</Button>
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-cream-200 pt-2">
        <p className="text-xs font-bold">Decision and audit history</p>
        {request.events.map((event) => (
          <div key={event.id} className="break-words rounded-lg border border-cream-200 bg-white p-2 text-[11px] text-ink-muted">
            {new Date(event.createdAt).toLocaleString()} · {event.actor?.name ?? 'System'} · {event.action}
            {event.reason && <p>Reason: {event.reason}</p>}
            {event.customerMessage && <p>Customer message: {event.customerMessage}</p>}
            {event.internalNotes && <p>Internal note: {event.internalNotes}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function roomNames(snapshot: string): string {
  try {
    const rooms: unknown = JSON.parse(snapshot);
    if (!Array.isArray(rooms) || !rooms.every((room) => typeof room === 'string')) return 'Room details unavailable';
    return rooms.map((room: string) => room === 'VIP_DERIV' ? 'Deriv VIP' : room === 'VIP_WELTRADE' ? 'Weltrade VIP' : room).join(', ');
  } catch {
    return 'Room details unavailable';
  }
}
