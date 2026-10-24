import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock3, Crown, FileCheck2 } from 'lucide-react';
import { purchaseRequestApi, subscriptionApi } from '../lib/endpoints';
import { Badge, Button, Card, Modal, Spinner } from '../components/ui';
import PurchaseRequestForm from '../components/PurchaseRequestForm';
import type { MembershipPackage } from '../lib/types';
import { useAuth } from '../store/auth';

export default function Subscription() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: subscriptionApi.get, refetchOnMount: 'always' });
  const packages = useQuery({ queryKey: ['membership-packages'], queryFn: purchaseRequestApi.packages, refetchOnMount: 'always' });
  const [selected, setSelected] = useState<MembershipPackage | null>(null);
  const roomAccess = subscription.data?.roomAccess ?? [];
  const coveredRooms = new Set(
    roomAccess
      .filter((access) => new Date(access.expiresAt).getTime() > Date.now())
      .map((access) => access.accessLevel),
  );
  if (user?.isVip && user.membership === 'VIP_DERIV' && (!user.vipExpiresAt || new Date(user.vipExpiresAt).getTime() > Date.now())) {
    coveredRooms.add('VIP_DERIV');
  }
  if (user?.isVip && user.membership === 'VIP_WELTRADE' && (!user.vipExpiresAt || new Date(user.vipExpiresAt).getTime() > Date.now())) {
    coveredRooms.add('VIP_WELTRADE');
  }
  const availablePackages = (packages.data ?? []).filter(
    (item) => !item.includedRooms.every((room) => coveredRooms.has(room)),
  );
  const renewalPackages = (packages.data ?? []).filter(
    (item) => item.activationRule === 'AFTER_CURRENT_ACCESS' && item.includedRooms.every((room) => coveredRooms.has(room)),
  );

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <Card className="mb-4 flex flex-col items-center bg-gold-gradient py-6 text-white">
        <Crown className="h-10 w-10" />
        <h1 className="mt-2 text-2xl font-extrabold">Buy VIP membership</h1>
        <p className="mt-1 max-w-md text-center text-sm opacity-90">
          A membership is how you buy access to VIP signals. Choose a plan for the room or rooms you want.
        </p>
        <div className="mt-4 grid w-full max-w-lg gap-2 text-left text-xs sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-xl bg-white/15 p-2"><span className="font-bold">1</span> Pick VIP room and duration</div>
          <div className="flex items-center gap-2 rounded-xl bg-white/15 p-2"><span className="font-bold">2</span> Pay and send receipt</div>
          <div className="flex items-center gap-2 rounded-xl bg-white/15 p-2"><span className="font-bold">3</span> Get access after review</div>
        </div>
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
        <Card className="mb-5 flex items-center gap-3 text-sm text-ink-muted">
          <Clock3 className="h-5 w-5 shrink-0 text-gold-600" />
          No active VIP room access yet. Choose a plan below to get started.
        </Card>
      )}

      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">Available VIP memberships</h2>
          <p className="text-xs text-ink-muted">Each plan shows its total price, access length, and included rooms.</p>
        </div>
        <Link to="/profile/purchases" className="inline-flex items-center gap-1 text-sm font-semibold text-gold-700">
          <FileCheck2 className="h-4 w-4" /> My requests
        </Link>
      </div>
      {packages.isLoading ? (
        <Spinner className="mx-auto h-6 w-6 text-gold-400" />
      ) : packages.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Membership packages couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => packages.refetch()}>Try again</Button>
        </Card>
      ) : availablePackages.length === 0 ? (
        <Card className="text-sm text-ink-muted">You already have access to all rooms included in the available plans. Your current room status is shown above.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {availablePackages.map((item) => (
            <Card key={item.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{item.title}</h3>
                {item.saleStatus !== 'AVAILABLE' && (
                  <Badge tone="grey">{item.saleStatus === 'SOLD_OUT' ? 'Sold out' : 'Unavailable'}</Badge>
                )}
              </div>
              {item.description && <p className="mt-1 text-sm text-ink-muted">{item.description}</p>}
              <p className="mt-3 text-2xl font-extrabold">{item.currency} {Number(item.price).toFixed(2)}</p>
              <p className="text-xs text-ink-muted">Total price · {item.durationDays} days of VIP access</p>
              <p className="mt-2 text-sm font-medium">VIP signal rooms included</p>
              <ul className="mt-1 space-y-1 text-sm text-ink-muted">
                {item.includedRooms.map((room) => (
                  <li key={room} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-600" />
                    {room === 'VIP_DERIV' ? 'Deriv VIP room' : 'Weltrade VIP room'}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-faint">
                {item.activationRule === 'AFTER_CURRENT_ACCESS' ? 'Renewal begins when your current access ends.' : 'Access begins after your payment is approved.'}
              </p>
              <Button className="mt-4" disabled={item.saleStatus !== 'AVAILABLE'} onClick={() => setSelected(item)}>
                {item.saleStatus === 'AVAILABLE' ? 'Buy this membership' : 'Currently unavailable'}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {renewalPackages.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title mb-2">Renew your VIP access</h2>
          <p className="mb-3 text-xs text-ink-muted">Renewal access starts after your current room access ends.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {renewalPackages.map((item) => (
              <Card key={item.id} className="flex flex-col">
                <h3 className="font-bold">{item.title}</h3>
                {item.description && <p className="mt-1 text-sm text-ink-muted">{item.description}</p>}
                <p className="mt-3 text-2xl font-extrabold">{item.currency} {Number(item.price).toFixed(2)}</p>
                <p className="text-xs text-ink-muted">Total price · {item.durationDays} days</p>
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {item.includedRooms.map((room) => (
                    <li key={room} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-600" />
                      {room === 'VIP_DERIV' ? 'Deriv VIP room' : 'Weltrade VIP room'}
                    </li>
                  ))}
                </ul>
                <Button className="mt-4" disabled={item.saleStatus !== 'AVAILABLE'} onClick={() => setSelected(item)}>
                  Renew after current access
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Buy VIP membership">
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
              qc.invalidateQueries({ queryKey: ['purchase-requests'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
