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
import { ChartDecor } from './ChartDecor';
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
    <div className="mx-auto flex min-h-screen w-full max-w-6xl">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-cream-200 bg-white p-5 md:flex">
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
          {/* Broker funding and Admin sit beside the main nav on desktop only —
              the mobile bottom bar keeps its four primary tabs. */}
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

      <main className="flex min-h-screen w-full flex-col pb-28 md:pb-0">
        {/* Persistent top bar — notifications + the single profile entry point.
            `mt-safe` clears the iPhone notch when installed to the home screen. */}
        <div className="mt-safe flex items-center justify-end gap-2 px-4 pt-5 md:px-8 md:pt-8">
          <button
            onClick={() => navigate('/notifications')}
            className="relative rounded-xl border border-cream-200 bg-white p-2.5 shadow-card transition-colors hover:bg-cream-50"
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
            className="relative rounded-xl border border-cream-200 bg-white p-2.5 shadow-card transition-colors hover:bg-cream-50"
            aria-label="Profile"
          >
            <UserIcon className="h-5 w-5 text-ink-soft" />
          </button>
        </div>
        <Outlet />
        <footer className="mt-auto px-4 pb-14 pt-4 text-center text-[10px] font-medium tracking-widest text-ink-faint md:pb-4">
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

      {/* Mobile bottom nav — pb-safe keeps it above the iPhone home bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-white pb-safe md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx('flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors', isActive ? 'text-gold-800' : 'text-ink-muted hover:text-ink')
              }
            >
              <item.icon className="h-5 w-5" />
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
    <div className="auth-viewport relative mx-auto mt-safe flex w-full max-w-md flex-col justify-center px-6 pb-44 pt-10">
      <ChartDecor />
      <div className="relative z-10">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        {children}
      </div>
    </div>
  );
}
