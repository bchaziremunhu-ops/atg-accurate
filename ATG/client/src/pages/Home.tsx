import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ChartCandlestick,
  GraduationCap,
  Headphones,
  LineChart,
  Users,
  Crown,
} from 'lucide-react';
import { courseApi, signalApi } from '../lib/endpoints';
import { Badge, Button, Card, SkeletonRow } from '../components/ui';
import WeltradeAccountCard from '../components/WeltradeAccountCard';

const actions = [
  { label: 'Education', icon: GraduationCap, to: '/education' },
  { label: 'VIP Signals', icon: Crown, to: '/signals' },
  { label: 'Community', icon: Users, to: '/community' },
  { label: 'Market Analysis', icon: ChartCandlestick, to: '/signals' },
  { label: 'Strategies', icon: LineChart, to: '/education' },
  { label: 'Live Support', icon: Headphones, to: '/support' },
];

export default function Home() {
  const signals = useQuery({ queryKey: ['signals', 'all'], queryFn: () => signalApi.list() });
  const courses = useQuery({ queryKey: ['courses', 'home'], queryFn: () => courseApi.list() });

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        {actions.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className="flex flex-col items-center gap-2 rounded-2xl border border-cream-200 bg-white p-3 text-center shadow-card transition hover:border-gold-300"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold-soft text-gold-600">
              <a.icon className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-medium leading-tight text-ink-soft">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Balance card */}
      <Card className="relative mt-5 overflow-hidden">
        <div className="flex gap-3">
          <Link to="/wallet?action=deposit" className="btn-gold flex-1 py-3 text-sm">
            Deposit
          </Link>
          <Link to="/wallet?action=withdraw" className="btn-outline flex-1 py-3 text-sm">
            Withdraw
          </Link>
        </div>
      </Card>

      {/* Latest updates */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Latest signals</h2>
          <Link to="/signals" className="text-xs font-semibold text-gold-600">
            All signals
          </Link>
        </div>

        {signals.isLoading ? (
          <SkeletonRow />
        ) : signals.isError ? (
          <Card className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Signals couldn&apos;t be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => signals.refetch()}>Try again</Button>
          </Card>
        ) : signals.data?.length ? (
          <div className="space-y-3">
            {signals.data.slice(0, 2).map((s) => (
              <Link key={s.id} to={`/signals/${s.id}`} className="card flex items-center gap-3 p-3">
                <div className="grid h-14 w-20 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 text-white">
                  <LineChart className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gold-600">Signal</p>
                  <p className="truncate text-sm font-semibold">{s.pair}</p>
                  <p className="text-xs text-ink-muted">{s.direction} · {s.timeframe}</p>
                </div>
                <Badge tone={s.direction === 'BUY' ? 'green' : 'red'}>{s.direction}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="text-sm text-ink-muted">No signals are available for your account right now.</Card>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Education</h2>
          <Link to="/education" className="text-xs font-semibold text-gold-600">Browse courses</Link>
        </div>
        {courses.isLoading ? (
          <SkeletonRow />
        ) : courses.isError ? (
          <Card className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Courses couldn&apos;t be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => courses.refetch()}>Try again</Button>
          </Card>
        ) : courses.data?.[0] ? (
          <Link to={`/education/${courses.data[0].slug}`} className="card flex items-center gap-3 p-3">
            <div className="grid h-14 w-20 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ink to-ink-soft text-gold-300">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gold-600">Featured course</p>
              <p className="truncate text-sm font-semibold">{courses.data[0].title}</p>
              <p className="text-xs text-ink-muted">{courses.data[0].lessonCount} lessons · {courses.data[0].level}</p>
            </div>
          </Link>
        ) : (
          <Card className="text-sm text-ink-muted">No courses are available right now.</Card>
        )}
      </section>

      {/* VIP promo / account registration */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link to="/profile/subscription" className="card bg-gold-soft p-4">
          <Crown className="h-6 w-6 text-gold-600" />
          <p className="mt-2 text-sm font-bold">Go VIP</p>
          <p className="text-xs text-ink-muted">Unlock high-probability signals</p>
        </Link>
        <WeltradeAccountCard className="col-span-2" />
      </div>
      <div className="h-4" />
    </div>
  );
}
