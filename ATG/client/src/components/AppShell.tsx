import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  GraduationCap,
  Home,
  Landmark,
  LayoutDashboard,
  User as UserIcon,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../store/auth';
import { useQuery } from '@tanstack/react-query';
import { notificationApi } from '../lib/endpoints';
import { disableOfflineMode, OFFLINE_MODE } from '../lib/api';

const nav = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/education', label: 'Education', icon: GraduationCap },
  { to: '/signals', label: 'Signals', icon: Activity },
  { to: '/community', label: 'Community', icon: Users },
];

export function AppShell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationApi.list,
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const unread = data?.unread ?? 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-cream-200 bg-white px-4 py-6 lg:flex lg:w-64 lg:px-5">
        <div className="mb-8 flex flex-col items-center border-b border-cream-200 pb-6 text-center">
          <BrandLogo size="sm" />
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-gold-50 text-gold-800 ring-1 ring-gold-100' : 'text-ink-soft hover:bg-cream-100 hover:text-ink',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/broker-funds"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-gold-50 text-gold-800 ring-1 ring-gold-100' : 'text-ink-soft hover:bg-cream-100 hover:text-ink',
              )
            }
          >
            <Landmark className="h-5 w-5" />
            Broker Funds
          </NavLink>
          {user?.role === 'ADMIN' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-ink text-white' : 'text-ink-soft hover:bg-cream-100 hover:text-ink',
                )
              }
            >
              <LayoutDashboard className="h-5 w-5" />
              Admin
            </NavLink>
          )}
        </nav>
        <div className="mt-auto">
          <button
            onClick={() => navigate('/notifications')}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-cream-200 bg-white px-3 py-2.5 text-sm shadow-card transition-colors hover:bg-cream-50"
          >
            <span className="text-ink-soft">Notifications</span>
            {unread > 0 && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{unread}</span>
            )}
          </button>
          <div className="rounded-2xl border border-gold-100 bg-gold-50 p-3">
            <p className="text-xs text-ink-muted">Signed in as</p>
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-ink-faint">{user?.email}</p>
          </div>
          <p className="mt-3 text-center text-[10px] font-medium tracking-widest text-ink-faint">
            Powered by Nbchazi
          </p>
        </div>
      </aside>

      <main className="app-main flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
        <div className="mt-safe sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-cream-200/80 bg-cream-100/95 px-4 py-3 backdrop-blur-md lg:static lg:min-h-0 lg:justify-end lg:border-0 lg:bg-transparent lg:px-8 lg:pt-8">
          <div className="lg:hidden">
            <p className="text-sm font-extrabold tracking-[0.08em] text-gold-700">ATG TRADERS</p>
            <p className="text-[11px] text-ink-muted">Member workspace</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/notifications')}
              className="relative grid h-11 w-11 place-items-center rounded-xl border border-cream-200 bg-white shadow-card transition-colors hover:bg-cream-50"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 text-ink-soft" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="relative grid h-11 w-11 place-items-center rounded-xl border border-cream-200 bg-white shadow-card transition-colors hover:bg-cream-50"
              aria-label="Profile"
            >
              <UserIcon className="h-5 w-5 text-ink-soft" />
            </button>
          </div>
        </div>
        <Outlet />
        <footer className="mt-auto px-4 pb-14 pt-4 text-center text-[10px] font-medium tracking-widest text-ink-faint lg:pb-4">
          Powered by Nbchazi
          {OFFLINE_MODE && (
            <>
              {' · '}
              <button type="button" onClick={disableOfflineMode} className="underline decoration-dotted underline-offset-4">
                OFFLINE MODE (tap for server)
              </button>
            </>
          )}
        </footer>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-white/95 pb-safe shadow-[0_-8px_24px_-20px_rgba(23,25,29,0.35)] backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx('flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition-colors', isActive ? 'bg-gold-50 text-gold-800' : 'text-ink-muted hover:text-ink')
              }
            >
              <item.icon className="h-5 w-5" strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-viewport grid w-full bg-cream-100 px-4 py-6 sm:px-8 sm:py-10 lg:min-h-dvh lg:grid-cols-2 lg:gap-10 lg:px-10 lg:py-8 xl:gap-16 xl:px-16">
      <section className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden rounded-3xl bg-ink p-10 text-white lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-24 -top-20 h-80 w-80 rounded-full bg-gold-600/20 blur-3xl" />
        <div className="relative">
          <BrandLogo size="sm" />
        </div>
        <div className="relative max-w-lg py-12">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-gold-300">Accurate Trading Group</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
            Build your trading knowledge with confidence.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-white/65">
            Learn at your pace, follow market insights, and stay connected with your trading community.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {['Practical education', 'Market insights', 'Member community'].map((item) => (
              <span key={item} className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white/80">
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="relative flex items-center justify-between border-t border-white/10 pt-5 text-xs text-white/45">
          <span>Learn. Practice. Grow.</span>
          <span>ATG Traders</span>
        </div>
        <svg aria-hidden="true" className="pointer-events-none absolute bottom-24 right-8 h-44 w-3/4 opacity-35" viewBox="0 0 420 150" fill="none">
          <path d="M0 124H420M0 80H420M0 36H420" stroke="white" strokeOpacity=".12" />
          <path d="m0 118 44-14 38 8 42-36 38 18 44-52 39 31 44-42 42 10 45-34 44 7" stroke="#EFB46F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m0 118 44-14 38 8 42-36 38 18 44-52 39 31 44-42 42 10 45-34 44 7v136H0Z" fill="url(#authChartFill)" opacity=".18" />
          <defs>
            <linearGradient id="authChartFill" x1="210" y1="20" x2="210" y2="150" gradientUnits="userSpaceOnUse">
              <stop stopColor="#EFB46F" />
              <stop offset="1" stopColor="#EFB46F" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </section>
      <div className="mx-auto flex w-full max-w-md flex-col justify-start py-4 sm:py-6 lg:justify-center lg:py-10">
        <div className="mb-7 flex justify-center lg:hidden">
          <BrandLogo size="lg" />
        </div>
        <div>
          {children}
        </div>
      </div>
    </div>
  );
}
