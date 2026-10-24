import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChartCandlestick,
  ExternalLink,
  GraduationCap,
  Headphones,
  LineChart,
  Users,
  Crown,
} from 'lucide-react';
import { courseApi, signalApi, siteSettingsApi } from '../lib/endpoints';
import { Badge, Button, Card, SkeletonRow } from '../components/ui';
import WeltradeAccountCard from '../components/WeltradeAccountCard';
import { useAuth } from '../store/auth';

const actions = [
  { label: 'Education', detail: 'Courses and lessons', icon: GraduationCap, to: '/education' },
  { label: 'VIP Signals', detail: 'Trading insights', icon: Crown, to: '/signals' },
  { label: 'Community', detail: 'Connect with members', icon: Users, to: '/community' },
  { label: 'Market Analysis', detail: 'Latest market view', icon: ChartCandlestick, to: '/signals' },
  { label: 'Strategies', detail: 'Build your skills', icon: LineChart, to: '/education' },
  { label: 'Live Support', detail: 'Get help from our team', icon: Headphones, to: '/support' },
];

export default function Home() {
  const { user } = useAuth();
  const signals = useQuery({ queryKey: ['signals', 'all'], queryFn: () => signalApi.list(), refetchOnMount: 'always' });
  const roomAccess = useQuery({ queryKey: ['rooms-access'], queryFn: signalApi.roomsAccess, refetchOnMount: 'always' });
  const courses = useQuery({ queryKey: ['courses', 'home'], queryFn: () => courseApi.list(), refetchOnMount: 'always' });
  const siteSettings = useQuery({ queryKey: ['site-settings'], queryFn: siteSettingsApi.public });
  const firstName = user?.name.trim().split(/\s+/)[0] || 'there';
  const featuredCourse = courses.data?.find((course) => course.isFree || !course.entitled) ?? courses.data?.[0];
  const featuredCourseOwned = Boolean(featuredCourse && !featuredCourse.isFree && featuredCourse.entitled);

  return (
    <div className="animate-rise mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 md:px-8 md:pt-7">
      <section className="relative isolate overflow-hidden rounded-3xl bg-ink px-5 py-6 text-white shadow-card sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-gold-600/20 blur-3xl" />
        <div className="relative z-10 max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300">Your member dashboard</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Good to see you, {firstName}</h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-white/65 sm:text-base">
            Continue learning, explore market insights, and stay connected with your community.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/education" className="btn-gold min-h-11 px-4 text-sm">
              Explore courses <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/signals" className="btn min-h-11 border border-white/20 bg-white/5 px-4 text-sm text-white hover:bg-white/10">
              View signals
            </Link>
          </div>
        </div>
        <svg aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-[45%] opacity-60 md:block" viewBox="0 0 420 200" fill="none" preserveAspectRatio="none">
          <path d="M0 40H420M0 100H420M0 160H420" stroke="white" strokeOpacity=".08" />
          <path d="M0 172 48 152 90 161 135 110 175 131 220 74 260 96 305 48 350 63 395 22 420 30" stroke="#EFB46F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M0 172 48 152 90 161 135 110 175 131 220 74 260 96 305 48 350 63 395 22 420 30V200H0Z" fill="url(#homeChartFill)" />
          <defs>
            <linearGradient id="homeChartFill" x1="210" y1="22" x2="210" y2="200" gradientUnits="userSpaceOnUse">
              <stop stopColor="#EFB46F" stopOpacity=".28" />
              <stop offset="1" stopColor="#EFB46F" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </section>

      {siteSettings.isError ? (
        <Card className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">The latest dashboard update couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => siteSettings.refetch()}>Try again</Button>
        </Card>
      ) : siteSettings.data?.dashboardPosts.some((post) => post.enabled) ? (
        <div className="mt-4 space-y-3">
          {siteSettings.data.dashboardPosts.filter((post) => post.enabled).map((post) => (
            <section key={post.id} className="rounded-2xl border border-gold-200 bg-gold-50 p-4 sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-800">ATG update</p>
              <h2 className="mt-1 text-lg font-bold text-ink">{post.title}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{post.body}</p>
              {post.linkUrl && (
                <a
                  href={post.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline mt-3 inline-flex min-h-10 items-center gap-2 px-4 text-sm"
                >
                  {post.linkLabel}
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </section>
          ))}
        </div>
      ) : null}

      <section className="mt-7">
        <div className="mb-3">
          <h2 className="section-title">Your workspace</h2>
          <p className="mt-1 text-sm text-ink-muted">Jump back into what matters to you.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className="group flex min-h-[92px] items-center gap-3 rounded-2xl border border-cream-200 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-md sm:min-h-[104px] sm:flex-col sm:items-start sm:justify-center sm:gap-2.5 sm:p-4"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-700 transition-colors group-hover:bg-gold-100">
              <a.icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-tight text-ink sm:text-sm">{a.label}</span>
              <span className="mt-1 hidden text-[11px] leading-tight text-ink-muted sm:block">{a.detail}</span>
            </span>
          </Link>
        ))}
        </div>
      </section>

      <div className="mt-7 grid gap-7 lg:grid-cols-2">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Latest signals</h2>
          <Link to="/signals" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-gold-700 hover:bg-gold-50">
            All signals
            <ArrowRight className="h-3.5 w-3.5" />
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
              <Link key={s.id} to={`/signals/${s.id}`} className="card group flex min-h-[88px] items-center gap-3 p-3 transition hover:border-gold-300 sm:p-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-700 sm:h-14 sm:w-14">
                  <LineChart className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Market signal</p>
                  <p className="mt-0.5 truncate text-sm font-semibold">{s.pair}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{s.direction} <span aria-hidden="true">·</span> {s.timeframe}</p>
                </div>
                <Badge tone={s.direction === 'BUY' ? 'green' : 'red'} className="shrink-0">{s.direction}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="text-sm text-ink-muted">No signals are available for your account right now.</Card>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Education</h2>
          <Link to="/education" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-gold-700 hover:bg-gold-50">
            Browse courses <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {courses.isLoading ? (
          <SkeletonRow />
        ) : courses.isError ? (
          <Card className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Courses couldn&apos;t be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => courses.refetch()}>Try again</Button>
          </Card>
        ) : featuredCourse ? (
          <Link to={`/education/${featuredCourse.slug}`} className="card group flex min-h-[88px] items-center gap-3 p-3 transition hover:border-gold-300 sm:p-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink text-gold-300 sm:h-14 sm:w-14">
              <GraduationCap className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{featuredCourseOwned ? 'Continue learning' : 'Start learning'}</p>
              <p className="mt-0.5 truncate text-sm font-semibold">{featuredCourse.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{featuredCourse.lessonCount} lessons <span aria-hidden="true">·</span> {featuredCourse.level}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition group-hover:text-gold-700" />
          </Link>
        ) : (
          <Card className="text-sm text-ink-muted">No courses are available right now.</Card>
        )}
      </section>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <Link to="/profile/subscription" className="group flex min-h-28 items-center gap-4 rounded-2xl border border-gold-100 bg-gold-soft p-4 transition hover:border-gold-300">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/80 text-gold-700">
            <Crown className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {roomAccess.data?.VIP_DERIV && roomAccess.data.VIP_WELTRADE ? 'Your VIP access' : 'Explore VIP access'}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
              {roomAccess.data?.VIP_DERIV && roomAccess.data.VIP_WELTRADE
                ? 'Check your active rooms and renewal details.'
                : 'See available plans for VIP rooms you do not currently access.'}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-gold-700 transition group-hover:translate-x-0.5" />
        </Link>
        <WeltradeAccountCard />
      </div>
      <div className="h-6" />
    </div>
  );
}
