import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Award,
  BadgeCheck,
  BookOpen,
  ChevronRight,
  Crown,
  FileText,
  Heart,
  HelpCircle,
  Landmark,
  LogOut,
  Settings,
  Shield,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../store/auth';
import { courseApi, signalApi, subscriptionApi, userApi } from '../lib/endpoints';
import { Card } from '../components/ui';
import { useToast } from '../components/Toast';
import type { Membership } from '../lib/types';

const MEMBER_LABEL: Record<Membership, string> = {
  FREE: 'FREE MEMBER',
  PAID: 'PAID MEMBER',
  VIP_DERIV: 'DERIV VIP MEMBER',
  VIP_WELTRADE: 'WELTRADE VIP MEMBER',
};

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  const profile = useQuery({ queryKey: ['profile'], queryFn: userApi.profile, refetchOnMount: 'always' });
  const courses = useQuery({ queryKey: ['profile-access-courses'], queryFn: () => courseApi.list(), refetchOnMount: 'always' });
  const signalAccess = useQuery({ queryKey: ['rooms-access'], queryFn: signalApi.roomsAccess, refetchOnMount: 'always' });
  const vipSubscription = useQuery({ queryKey: ['subscription'], queryFn: subscriptionApi.get, refetchOnMount: 'always' });
  const data = profile.data ?? user;
  const membership: Membership = data?.membership ?? (data?.isVip ? 'VIP_DERIV' : 'FREE');
  const isVipTier = membership === 'VIP_DERIV' || membership === 'VIP_WELTRADE';
  const hasAllVipRooms = Boolean(signalAccess.data?.VIP_DERIV && signalAccess.data.VIP_WELTRADE);
  const ownedCourses = (courses.data ?? []).filter((course) => !course.isFree && course.entitled);

  const menu = [
    { label: 'My Courses', to: '/education', icon: BookOpen },
    { label: 'My Signals', to: '/signals', icon: TrendingUp },
    { label: 'My Certificates', to: '/profile/certificates', icon: Award },
    { label: 'Saved Content', to: '/profile/saved', icon: Heart },
    { label: 'Purchase History', to: '/profile/purchases', icon: FileText },
    { label: 'Membership & VIP', to: '/profile/subscription', icon: Crown },
    { label: 'Broker Funds', to: '/broker-funds', icon: Landmark },
    { label: 'Account Settings', to: '/profile/settings', icon: Settings },
    { label: 'Help & Support', to: '/support', icon: HelpCircle },
  ];

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>
        <Link to="/profile/settings" className="rounded-xl border border-cream-200 bg-white p-2.5 shadow-card transition-colors hover:bg-cream-50" aria-label="Settings">
          <Settings className="h-5 w-5 text-ink-soft" />
        </Link>
      </header>

      <Card className="flex flex-col items-center py-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full border-2 border-gold-300 p-1">
            <div className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-ink text-2xl font-bold text-gold-100">
              {data?.avatarUrl ? (
                <img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                data?.name?.slice(0, 2).toUpperCase()
              )}
            </div>
          </div>
          {isVipTier && (
            <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-white shadow-card">
              <Crown className="h-4 w-4 text-gold-500" />
            </span>
          )}
        </div>

        <h2 className="mt-3 text-lg font-extrabold">{data?.name}</h2>
        <p className="text-sm text-ink-muted">ATG Trader</p>
        {isVipTier ? (
          <span className="mt-2 rounded-full border border-gold-200 bg-gold-50 px-4 py-1 text-xs font-bold tracking-wide text-gold-800">
            {MEMBER_LABEL[membership]}
          </span>
        ) : membership === 'PAID' ? (
          <span className="mt-2 rounded-full bg-ink px-4 py-1 text-xs font-bold tracking-wide text-gold-100">{MEMBER_LABEL.PAID}</span>
        ) : (
          <Link to="/profile/subscription" className="mt-2 rounded-full bg-cream-200 px-4 py-1 text-xs font-bold text-ink-muted">
            {MEMBER_LABEL.FREE} · View VIP prices
          </Link>
        )}

        <div className="mt-5 grid w-full grid-cols-3 divide-x divide-cream-200 border-t border-cream-200 pt-4 text-center">
          <div>
            <p className="text-lg font-extrabold">{data?.stats?.courses ?? 0}</p>
            <p className="text-xs text-ink-muted">Courses</p>
          </div>
          <div>
            <p className="text-lg font-extrabold">{data?.stats?.signals ?? 0}</p>
            <p className="text-xs text-ink-muted">Signals</p>
          </div>
          <Link to="/profile/certificates" className="transition hover:opacity-80">
            <p className="text-lg font-extrabold">{data?.stats?.certificates ?? 0}</p>
            <p className="text-xs text-ink-muted">Certificates</p>
          </Link>
        </div>
      </Card>

      <Card className="mt-4 space-y-3">
        <div>
          <h2 className="text-sm font-bold">Your current access</h2>
          <p className="text-xs text-ink-muted">Confirmed purchases and access available to this account.</p>
        </div>
        {signalAccess.isError || vipSubscription.isError || courses.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream-100 p-3">
            <p className="text-xs text-ink-muted">Some access details couldn&apos;t be loaded.</p>
            <button
              className="text-xs font-semibold text-gold-700"
              onClick={() => {
                void signalAccess.refetch();
                void vipSubscription.refetch();
                void courses.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <AccessStatus
                label="Paid signals"
                status={signalAccess.isLoading ? 'Checking…' : signalAccess.data?.PAID ? 'Available' : 'Not included'}
                active={Boolean(signalAccess.data?.PAID)}
              />
              <AccessStatus
                label="Deriv VIP signals"
                status={vipSubscription.isLoading
                  ? 'Checking…'
                  : roomStatus(vipSubscription.data?.roomAccess, 'VIP_DERIV', membership === 'VIP_DERIV' && Boolean(data?.isVip))}
                active={Boolean(signalAccess.data?.VIP_DERIV)}
              />
              <AccessStatus
                label="Weltrade VIP signals"
                status={vipSubscription.isLoading
                  ? 'Checking…'
                  : roomStatus(vipSubscription.data?.roomAccess, 'VIP_WELTRADE', membership === 'VIP_WELTRADE' && Boolean(data?.isVip))}
                active={Boolean(signalAccess.data?.VIP_WELTRADE)}
              />
            </div>
            {courses.isLoading ? (
              <p className="text-xs text-ink-muted">Loading course access…</p>
            ) : ownedCourses.length ? (
              <div className="border-t border-cream-200 pt-3">
                <p className="mb-2 text-xs font-semibold text-ink-soft">Purchased courses · access confirmed</p>
                <div className="flex flex-wrap gap-2">
                  {ownedCourses.map((course) => (
                    <Link
                      key={course.id}
                      to={`/education/${course.slug}`}
                      className="rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-semibold text-gold-800"
                    >
                      {course.title}
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <p className="border-t border-cream-200 pt-3 text-xs text-ink-muted">
                No purchased courses are active yet. Approved courses will appear here.
              </p>
            )}
          </>
        )}
        <Link to="/profile/purchases" className="inline-flex text-xs font-semibold text-gold-700">
          View purchase history and review status
        </Link>
      </Card>

      {!hasAllVipRooms && (
        <Link
          to="/profile/subscription"
          className="mt-4 flex items-center gap-3 rounded-2xl border border-cream-200 bg-ink p-4 text-white transition-colors hover:bg-ink-soft"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-700 text-white">
            <Crown className="h-5 w-5 text-gold-100" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-extrabold">{isVipTier ? 'Explore other VIP access' : 'Buy VIP signal access'}</span>
            <span className="block text-xs opacity-90">
              {isVipTier
                ? 'See plans for VIP rooms you do not currently access.'
                : 'Compare plans, pay, and submit a receipt for review.'}
            </span>
          </span>
          <ChevronRight className="h-5 w-5" />
        </Link>
      )}

      <div className="mt-4 space-y-2">
        {menu.map((m) => (
          <Link key={m.label} to={m.to} className="card flex items-center gap-3 p-3.5 transition-colors hover:border-gold-300">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-cream-200 bg-cream-100 text-gold-700">
              <m.icon className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium">{m.label}</span>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}

        {data?.role === 'ADMIN' && (
          <Link to="/admin" className="card flex items-center gap-3 p-3.5 transition-colors hover:border-gold-300">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-gold-300">
              <Shield className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium">Admin Dashboard</span>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </Link>
        )}

        <button
          disabled={loggingOut}
          aria-busy={loggingOut}
          onClick={async () => {
            if (loggingOut) return;
            setLoggingOut(true);
            const result = await logout();
            if (result.serverRevoked) {
              toast('Signed out', 'info');
            } else {
              toast(
                `Signed out on this device, but the server could not confirm session revocation: ${result.error ?? 'Please sign in again when online.'}`,
                'error',
              );
            }
            navigate('/login', { replace: true });
          }}
          className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-cream-300"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-50 text-danger">
            <LogOut className="h-4 w-4" />
          </span>
          <span className="flex-1 text-sm font-medium text-danger">{loggingOut ? 'Signing out…' : 'Logout'}</span>
        </button>
      </div>

      {isVipTier && data?.subscription && (
        <Card className="mt-4 flex items-center gap-3 border-gold-100 bg-gold-50">
          <BadgeCheck className="h-5 w-5 text-gold-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold">VIP active</p>
            <p className="text-xs text-ink-muted">
              Renews {data.subscription.expiresAt ? new Date(data.subscription.expiresAt).toDateString() : '—'}
            </p>
          </div>
          <Link to="/profile/subscription" className="text-xs font-bold text-gold-700">
            Manage
          </Link>
        </Card>
      )}
      <div className="h-4" />
    </div>
  );
}

function AccessStatus({ label, status, active }: { label: string; status: string; active: boolean }) {
  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50 p-3">
      <p className="text-xs font-semibold">{label}</p>
      <p className={`mt-1 text-xs font-bold ${active ? 'text-success' : 'text-ink-muted'}`}>{status}</p>
    </div>
  );
}

function roomStatus(
  accessList: { accessLevel: string; startsAt: string; expiresAt: string }[] | undefined,
  room: 'VIP_DERIV' | 'VIP_WELTRADE',
  legacyActive: boolean,
): string {
  const now = Date.now();
  const access = (accessList ?? [])
    .filter((item) => item.accessLevel === room && new Date(item.expiresAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  if (access && new Date(access.startsAt).getTime() > now) {
    return `Upcoming · starts ${new Date(access.startsAt).toLocaleDateString()}`;
  }
  if (access) return `Active · until ${new Date(access.expiresAt).toLocaleDateString()}`;
  return legacyActive ? 'Active' : 'Not active';
}
