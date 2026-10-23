import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bell, BellOff } from 'lucide-react';
import { userApi, notificationApi } from '../lib/endpoints';
import { Button, Card, Field, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import { useAuth } from '../store/auth';

export default function SettingsPage() {
  const { refreshUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const nativePlatform = Capacitor.isNativePlatform();
  const profile = useQuery({ queryKey: ['profile'], queryFn: userApi.profile });
  const hydratedUserId = useRef<string | null>(null);
  const [form, setForm] = useState<{ name: string; phone: string; country: string; bio: string; avatarUrl: string }>({
    name: '',
    phone: '',
    country: '',
    bio: '',
    avatarUrl: '',
  });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pushOn, setPushOn] = useState(false);

  const p = profile.data;
  useEffect(() => {
    if (!p || hydratedUserId.current === p.id) return;
    setForm({ name: p.name, phone: p.phone ?? '', country: p.country ?? '', bio: p.bio ?? '', avatarUrl: p.avatarUrl ?? '' });
    hydratedUserId.current = p.id;
  }, [p]);

  const save = useMutation({
    mutationFn: () =>
      userApi.update({
        name: form.name,
        phone: form.phone,
        country: form.country,
        bio: form.bio,
        ...(form.avatarUrl ? { avatarUrl: form.avatarUrl } : {}),
      }),
    onSuccess: () => {
      toast('Profile updated ✔', 'success');
      refreshUser();
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const changePw = useMutation({
    mutationFn: () => userApi.changePassword({ currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: () => {
      toast('Password changed ✔', 'success');
      setPw({ current: '', next: '' });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  async function enablePush() {
    if (nativePlatform) {
      return toast('Native push notifications are not configured; in-app alerts are still available.', 'info');
    }
    try {
      if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return toast('Push notifications are not supported on this device.', 'error');
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') return toast('Notification permission denied', 'error');
      const { publicKey } = await notificationApi.pushKey();
      if (!publicKey) {
        return toast('Browser permission is granted, but server push delivery is not configured yet.', 'info');
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await notificationApi.subscribePush(sub.toJSON() as never);
      setPushOn(true);
      toast('Push notifications enabled 🔔', 'success');
    } catch (e) {
      toast(apiError(e), 'error');
    }
  }

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">Account Settings</h1>

      {profile.isLoading ? (
        <Card className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner className="h-5 w-5 text-gold-400" /> Loading account details…
        </Card>
      ) : profile.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Account details couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => profile.refetch()}>Try again</Button>
        </Card>
      ) : (
        <Card className="space-y-4">
          <h2 className="section-title">Personal details</h2>
          <Field label="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Field label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Field label="Country" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
          <Field label="Avatar URL" placeholder="https://…" value={form.avatarUrl} onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))} />
          <div>
            <label className="label">Bio</label>
            <textarea
              className="input min-h-[80px]"
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            />
          </div>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save changes
          </Button>
        </Card>
      )}

      <Card className="mt-4 space-y-4">
        <h2 className="section-title">Change password</h2>
        <Field label="Current password" type="password" value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} />
        <Field label="New password" type="password" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} />
        <Button
          variant="outline"
          onClick={() => changePw.mutate()}
          loading={changePw.isPending}
          disabled={pw.current.length === 0 || pw.next.length < 8}
        >
          Update password
        </Button>
      </Card>

      <Card className="mt-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-600">
          {pushOn ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Push notifications</p>
          <p className="text-xs text-ink-muted">
            {nativePlatform
              ? 'In-app alerts are available; native push is not configured.'
              : 'Get alerts for new signals, payments & expiry'}
          </p>
        </div>
        <Button size="sm" variant={pushOn ? 'outline' : 'gold'} onClick={enablePush} disabled={nativePlatform || pushOn}>
          {nativePlatform ? 'Not configured' : pushOn ? 'Enabled' : 'Enable'}
        </Button>
      </Card>

      <InstallCard pushOn={pushOn} />
      <div className="h-4" />
    </div>
  );
}

/** iOS cannot receive web push, and the only way in is Safari → Add to Home Screen. */
function InstallCard({ pushOn }: { pushOn: boolean }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  if (!isIOS || Capacitor.isNativePlatform()) return null;

  return (
    <Card className="mt-4 space-y-2">
      <h2 className="section-title">Install on iPhone</h2>
      {isStandalone ? (
        <p className="text-xs leading-relaxed text-ink-muted">
          You&apos;re running the installed app — it opens full-screen from your home screen and keeps working offline.
        </p>
      ) : (
        <ol className="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-ink-muted">
          <li>Open this page in <strong className="text-ink">Safari</strong> (not Chrome or in-app browsers).</li>
          <li>Tap the <strong className="text-ink">Share</strong> button (square with an arrow).</li>
          <li>Choose <strong className="text-ink">Add to Home Screen</strong>, then <strong className="text-ink">Add</strong>.</li>
          <li>Launch it from the new ATG icon — it runs full-screen like an app.</li>
        </ol>
      )}
      <p className="rounded-xl bg-cream-100 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
        iPhone does not deliver web push notifications to home-screen apps — open ATG to see new signals and alerts
        {pushOn ? ' (in-app).' : '.'}
      </p>
    </Card>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
