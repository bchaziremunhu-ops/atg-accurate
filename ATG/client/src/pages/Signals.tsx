import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart3, Crown, Lock, Star } from 'lucide-react';
import { signalApi, type RoomsAccess } from '../lib/endpoints';
import { formatPrice } from '../lib/format';
import { Badge, Button, Chip, SkeletonRow } from '../components/ui';
import { useAuth } from '../store/auth';

const filters = ['All Signals', 'Boom & Crash', 'V75', 'PainX'];

const AUDIENCE_BADGE: Record<string, { label: string; className: string }> = {
  FREE: { label: 'FREE', className: 'bg-cream-200 text-ink-soft' },
  PAID: { label: 'PAID', className: 'bg-ink px-2 py-0.5 text-gold-200' },
  VIP_DERIV: { label: 'DERIV VIP', className: 'bg-ink px-2 py-0.5 text-gold-200' },
  VIP_WELTRADE: { label: 'WELTRADE VIP', className: 'bg-ink px-2 py-0.5 text-gold-200' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
}

export default function Signals() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('All Signals');
  const signals = useQuery({ queryKey: ['signals', 'all'], queryFn: () => signalApi.list() });
  const access = useQuery({ queryKey: ['rooms-access'], queryFn: signalApi.roomsAccess });

  const filtered = useMemo(() => {
    const list = signals.data ?? [];
    if (filter === 'All Signals') return list;
    if (filter === 'Boom & Crash') return list.filter((s) => /boom|crash/i.test(s.pair));
    return list.filter((s) => s.pair.toLowerCase().includes(filter.toLowerCase()));
  }, [signals.data, filter]);

  const membership = user?.membership ?? 'FREE';
  const lockedRooms = lockedRoomList(access.data);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Crown className="h-6 w-6 text-gold-500" /> Trading Signals
          </h1>
          <p className="muted">Signals and result updates from ATG, targeted to your rooms.</p>
        </div>
        <Link to="/profile/saved" className="rounded-xl border border-cream-200 bg-white p-2.5 shadow-card transition-colors hover:bg-gold-50" aria-label="Favourites">
          <Star className="h-5 w-5 text-gold-500" />
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full border border-cream-200 bg-white px-3 py-1 font-semibold text-ink-soft">You are: {membershipLabel(membership)}</span>
        {access.data?.VIP_DERIV && <span className="rounded-full bg-ink px-3 py-1 font-semibold text-gold-200">Deriv VIP room ✓</span>}
        {access.data?.VIP_WELTRADE && <span className="rounded-full bg-ink px-3 py-1 font-semibold text-gold-200">Weltrade VIP room ✓</span>}
      </div>

      {lockedRooms.length > 0 && (
        <Link to="/profile/subscription" className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-white">
          <span className="text-sm font-semibold">Unlock {lockedRooms.join(' & ')} signals — full entry, TP & SL</span>
          <Crown className="h-5 w-5" />
        </Link>
      )}

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {filters.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </Chip>
        ))}
      </div>

      <div className="space-y-3">
        {signals.isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : signals.isError ? (
          <div className="card flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm font-semibold">Signals couldn&apos;t be loaded.</p>
            <p className="text-xs text-ink-muted">Check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={() => signals.refetch()}>Try again</Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">No signals for this filter.</p>
        ) : (
          filtered.map((s) => {
            const badge = AUDIENCE_BADGE[s.audience];
            return (
              <div key={s.id} className="card p-4 transition-colors hover:border-cream-300">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold-100 bg-gold-50 text-gold-700">
                      <BarChart3 className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{s.pair}</p>
                      <p className={`text-[11px] font-medium ${s.status === 'OPEN' ? 'text-success' : 'text-ink-muted'}`}>
                        {s.status === 'OPEN' ? `Published ${timeAgo(s.publishedAt)}` : statusLabel(s.status)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.label}</span>}
                    <Badge tone={s.direction === 'BUY' ? 'green' : 'red'}>{s.direction}</Badge>
                  </div>
                </div>

                {s.locked ? (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-cream-100 px-3 py-3">
                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                      <Lock className="h-4 w-4" /> Members only
                    </span>
                    <Link to="/profile/subscription" className="text-xs font-bold text-gold-600">
                      Upgrade
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-cream-200 bg-cream-100 p-3">
                      {[
                        { label: 'Entry', value: s.entry },
                        { label: 'Take Profit', value: s.takeProfit },
                        { label: 'Stop Loss', value: s.stopLoss },
                      ].map((row) => (
                        <div key={row.label}>
                          <p className="text-[10px] font-medium text-ink-muted">{row.label}</p>
                          <p className="text-sm font-bold">{formatPrice(row.value)}</p>
                        </div>
                      ))}
                    </div>
                    <Link to={`/signals/${s.id}`} className="btn-outline mt-3 w-full py-2.5 text-sm">
                      <BarChart3 className="h-4 w-4 text-gold-600" /> View Analysis
                    </Link>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-cream-200 bg-white p-4 text-xs text-ink-muted">
        <p className="font-semibold text-ink">Risk warning</p>
        <p className="mt-1">
          Trading involves substantial risk. Signals are educational and not financial advice. Never risk more than you can
          afford to lose.
        </p>
      </div>
      <div className="h-4" />
    </div>
  );
}

function membershipLabel(m: string) {
  return { FREE: 'Free member', PAID: 'Paid course member', VIP_DERIV: 'Deriv VIP', VIP_WELTRADE: 'Weltrade VIP' }[m] ?? m;
}

function statusLabel(status: string) {
  return {
    HIT_TP: 'Take profit reached',
    HIT_SL: 'Stop loss reached',
    CANCELLED: 'Cancelled by Admin',
  }[status] ?? status.replace(/_/g, ' ');
}

function lockedRoomList(access?: RoomsAccess): string[] {
  if (!access) return [];
  const locked: string[] = [];
  if (!access.VIP_DERIV) locked.push('Deriv VIP');
  if (!access.VIP_WELTRADE) locked.push('Weltrade VIP');
  return locked;
}
