import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crown } from 'lucide-react';
import { purchaseRequestApi, subscriptionApi } from '../lib/endpoints';
import { Badge, Button, Card, Modal, Spinner } from '../components/ui';
import PurchaseRequestForm from '../components/PurchaseRequestForm';
import type { MembershipPackage } from '../lib/types';

export default function Subscription() {
  const qc = useQueryClient();
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: subscriptionApi.get });
  const packages = useQuery({ queryKey: ['membership-packages'], queryFn: purchaseRequestApi.packages });
  const [selected, setSelected] = useState<MembershipPackage | null>(null);
  const roomAccess = subscription.data?.roomAccess ?? [];

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <Card className="mb-4 flex flex-col items-center bg-gold-gradient py-6 text-white">
        <Crown className="h-10 w-10" />
        <h1 className="mt-2 text-2xl font-extrabold">ATG Memberships</h1>
        <p className="text-center text-sm opacity-90">Choose a package. VIP access starts after an administrator verifies payment.</p>
      </Card>

      <h2 className="section-title mb-2">Your VIP room access</h2>
      {subscription.isLoading ? (
        <Spinner className="mx-auto h-6 w-6 text-gold-400" />
      ) : subscription.isError ? (
        <Card className="mb-5 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Your membership status couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => subscription.refetch()}>Try again</Button>
        </Card>
      ) : roomAccess.length ? (
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {roomAccess.map((access) => (
            <Card key={access.approvalReference + access.accessLevel}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{access.accessLevel === 'VIP_DERIV' ? 'Deriv VIP' : 'Weltrade VIP'}</p>
                <Badge tone={new Date(access.startsAt) <= new Date() && new Date(access.expiresAt) > new Date() ? 'green' : 'grey'}>
                  {new Date(access.startsAt) > new Date() ? 'Upcoming' : new Date(access.expiresAt) > new Date() ? 'Active' : 'Expired'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {new Date(access.startsAt).toLocaleDateString()} – {new Date(access.expiresAt).toLocaleDateString()}
              </p>
              <p className="text-xs text-ink-faint">Approval {access.approvalReference}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mb-5 text-sm text-ink-muted">No active VIP room access.</Card>
      )}

      <h2 className="section-title mb-2">Membership packages</h2>
      {packages.isLoading ? (
        <Spinner className="mx-auto h-6 w-6 text-gold-400" />
      ) : packages.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Membership packages couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => packages.refetch()}>Try again</Button>
        </Card>
      ) : !packages.data?.length ? (
        <Card className="text-sm text-ink-muted">No membership packages are currently available.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {packages.data.map((item) => (
            <Card key={item.id} className="flex flex-col">
              <h3 className="font-bold">{item.title}</h3>
              {item.description && <p className="mt-1 text-sm text-ink-muted">{item.description}</p>}
              <p className="mt-3 text-2xl font-extrabold">{item.currency} {Number(item.price).toFixed(2)}</p>
              <p className="text-xs text-ink-muted">{item.durationDays} days · {item.includedRooms.map((room) => room === 'VIP_DERIV' ? 'Deriv VIP' : 'Weltrade VIP').join(', ')}</p>
              <Button className="mt-4" onClick={() => setSelected(item)}>Request purchase / renewal</Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Request membership">
        {selected && (
          <PurchaseRequestForm
            item={{
              itemType: 'MEMBERSHIP',
              itemId: selected.id,
              title: selected.title,
              description: selected.description,
              price: Number(selected.price),
              currency: selected.currency,
              durationDays: selected.durationDays,
              activationRule: selected.activationRule,
              includedRooms: selected.includedRooms,
            }}
            onSubmitted={() => {
              setSelected(null);
              qc.invalidateQueries({ queryKey: ['purchase-requests'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
