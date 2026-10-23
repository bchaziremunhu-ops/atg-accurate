import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Crown,
  DollarSign,
  DoorClosed,
  DoorOpen,
  ExternalLink,
  Eye,
  GraduationCap,
  Landmark,
  Megaphone,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Send,
  Shield,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { adminApi, brokerAdminApi, courseApi, signalApi, weltradeAccountAdminApi, type AdminUser } from '../lib/endpoints';
import AdminPurchaseRequests from '../components/AdminPurchaseRequests';
import { Badge, Button, Card, Chip, EmptyState, Field, Modal, Select, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import type { AccessTier, AdminBrokerAccount, AdminBrokerFunding, BrokerAuditEntry, BrokerId, Course, Group, Lesson, Membership, Resource, Signal } from '../lib/types';

type AdminPurchase = {
  id: string;
  itemType: string;
  itemTitle: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  method?: string | null;
  proofNote?: string | null;
  user?: { name: string; email: string };
};

type AdminTxn = {
  id: string;
  type: string;
  method?: string | null;
  amount: number;
  fee?: number;
  netAmount?: number | null;
  currency: string;
  status: string;
  reference: string;
  destination?: string | null;
  providerRef?: string | null;
  adminNote?: string | null;
  statusHistory?: { id: string; toStatus: string; note?: string | null; createdAt: string }[];
  user?: { name: string; email: string };
};

const tabs = ['Overview', 'Signals', 'Rooms', 'Courses', 'Purchase Requests', 'Users', 'Payments', 'Transactions', 'Broker Funds', 'Weltrade Accounts', 'Broadcast'];

const AUDIENCE_OPTIONS: { value: AccessTier; label: string }[] = [
  { value: 'FREE', label: 'Free — everyone' },
  { value: 'PAID', label: 'Paid members' },
  { value: 'VIP_DERIV', label: 'Deriv VIP room' },
  { value: 'VIP_WELTRADE', label: 'Weltrade VIP room' },
];

const AUDIENCE_LABEL: Record<string, string> = {
  FREE: 'FREE',
  PAID: 'PAID',
  VIP_DERIV: 'DERIV VIP',
  VIP_WELTRADE: 'WELTRADE VIP',
};

export default function Admin() {
  const [tab, setTab] = useState('Overview');
  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-5 flex items-center gap-3">
        <Link to="/home" className="text-ink-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Shield className="h-6 w-6 text-gold-500" /> Admin
          </h1>
          <p className="muted">Manage ATG Traders</p>
        </div>
      </header>

      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {tabs.map((t) => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>
            {t}
          </Chip>
        ))}
      </div>

      {tab === 'Overview' && <Overview />}
      {tab === 'Signals' && <SignalsAdmin />}
      {tab === 'Rooms' && <RoomsAdmin />}
      {tab === 'Courses' && <CoursesAdmin />}
      {tab === 'Purchase Requests' && <AdminPurchaseRequests />}
      {tab === 'Users' && <UsersAdmin />}
      {tab === 'Payments' && <PaymentsAdmin />}
      {tab === 'Transactions' && <TransactionsAdmin />}
      {tab === 'Broker Funds' && <BrokerFundsAdmin />}
      {tab === 'Weltrade Accounts' && <WeltradeAccountsAdmin />}
      {tab === 'Broadcast' && <BroadcastAdmin />}
      <div className="h-6" />
    </div>
  );
}

function Overview() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.stats });
  if (stats.isLoading) return <Spinner className="h-6 w-6 text-gold-400" />;
  const s = stats.data ?? {};
  const m = s.memberships ?? {};
  const cards = [
    { label: 'Users', value: s.users, icon: Users },
    { label: 'VIP members', value: s.vips, icon: Crown },
    { label: 'Signals', value: s.signals, icon: Activity },
    { label: 'Open signals', value: s.openSignals, icon: Activity },
    { label: 'Revenue', value: `$${Number(s.revenue ?? 0).toFixed(2)}`, icon: DollarSign },
    { label: 'Pending payments', value: s.pendingPurchases, icon: Wallet },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className="min-w-0">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold-100 bg-gold-50 text-gold-800">
              <c.icon className="h-4 w-4" />
            </span>
            <p className="mt-3 truncate text-xl font-extrabold tabular-nums">{c.value ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{c.label}</p>
          </Card>
        ))}
      </div>

      <h2 className="section-title mb-2 mt-6">Members by tier</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE'] as const).map((k) => (
          <Card key={k} className="border-cream-200">
            <p className="text-xs text-ink-muted">{AUDIENCE_LABEL[k]}</p>
            <p className="text-lg font-extrabold">{m[k] ?? 0}</p>
          </Card>
        ))}
      </div>

      {(s.pendingWithdrawals ?? 0) > 0 && (
        <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-danger">
          {s.pendingWithdrawals} withdrawal request(s) awaiting approval.
        </div>
      )}

      <h2 className="section-title mb-2 mt-6">Recent purchases</h2>
      <div className="space-y-2">
        {(s.recentPurchases ?? []).map((p: AdminPurchase) => (
          <Card key={p.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{p.itemTitle}</p>
              <p className="text-xs text-ink-muted">{p.user?.name}</p>
            </div>
            <p className="text-sm font-bold">${p.amount.toFixed(2)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

const emptySignal = {
  pair: 'Volatility 75 (V75)',
  market: 'Derived',
  direction: 'BUY',
  entry: '',
  takeProfit: '',
  stopLoss: '',
  audience: 'VIP_DERIV' as AccessTier,
  timeframe: '15m',
  analysis: '',
};

const MARKETS = ['Derived', 'Forex', 'Commodities', 'Crypto', 'Indices', 'Stocks'];

function SignalsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const signals = useQuery({ queryKey: ['signals', 'all'], queryFn: () => signalApi.list() });
  const [form, setForm] = useState(emptySignal);
  const [editing, setEditing] = useState<Signal | null>(null);
  const prices = [Number(form.entry), Number(form.takeProfit), Number(form.stopLoss)];
  const validPrices = prices.every((price) => Number.isFinite(price) && price > 0) &&
    (form.direction === 'BUY'
      ? prices[2] < prices[0] && prices[0] < prices[1]
      : prices[1] < prices[0] && prices[0] < prices[2]);
  const editPrices = editing ? [Number(editing.entry), Number(editing.takeProfit), Number(editing.stopLoss)] : [];
  const validEditPrices = Boolean(editing) && editPrices.every((price) => Number.isFinite(price) && price > 0) &&
    (editing?.direction === 'BUY'
      ? editPrices[2] < editPrices[0] && editPrices[0] < editPrices[1]
      : editPrices[1] < editPrices[0] && editPrices[0] < editPrices[2]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['signals'] });

  const create = useMutation({
    mutationFn: () =>
      signalApi.create({
        pair: form.pair,
        market: form.market,
        direction: form.direction as 'BUY' | 'SELL',
        entry: prices[0],
        takeProfit: prices[1],
        stopLoss: prices[2],
        audience: form.audience,
        timeframe: form.timeframe,
        analysis: form.analysis,
      }),
    onSuccess: () => {
      toast('Signal published to the selected room 📈', 'success');
      setForm(emptySignal);
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Signal> }) => signalApi.update(id, data),
    onSuccess: () => {
      toast('Signal updated', 'success');
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => signalApi.remove(id),
    onSuccess: () => {
      toast('Signal deleted', 'info');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div>
      <Card className="space-y-3">
        <h2 className="section-title">Publish a signal</h2>
        <Field label="Pair" value={form.pair} onChange={(e) => setForm((f) => ({ ...f, pair: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Market / instrument group" value={form.market} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}>
            {MARKETS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select label="Direction" value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </Select>
        </div>
        <Select label="Room / audience" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as AccessTier }))}>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-ink-muted">
          {form.audience === 'FREE'
            ? 'All users can view this signal and receive an in-app notification.'
            : form.audience === 'PAID'
              ? 'Paid and VIP members can view this signal and receive an in-app notification.'
              : `${form.audience === 'VIP_DERIV' ? 'Deriv' : 'Weltrade'} VIP members with active room access can view it and receive an in-app notification.`}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Entry" type="number" min="0" step="any" required value={form.entry} onChange={(e) => setForm((f) => ({ ...f, entry: e.target.value }))} />
          <Field label="TP" type="number" min="0" step="any" required value={form.takeProfit} onChange={(e) => setForm((f) => ({ ...f, takeProfit: e.target.value }))} />
          <Field label="SL" type="number" min="0" step="any" required value={form.stopLoss} onChange={(e) => setForm((f) => ({ ...f, stopLoss: e.target.value }))} />
        </div>
        <p className={`text-xs ${validPrices ? 'text-ink-muted' : 'text-danger'}`}>
          {validPrices
            ? 'Price order looks valid.'
            : form.direction === 'BUY'
              ? 'For BUY: set Stop Loss below Entry and Take Profit above Entry.'
              : 'For SELL: set Take Profit below Entry and Stop Loss above Entry.'}
        </p>
        <Select label="Timeframe" value={form.timeframe} onChange={(e) => setForm((f) => ({ ...f, timeframe: e.target.value }))}>
          {['1m', '5m', '15m', '30m', '1H', '4H'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Textarea label="Analysis (optional)" value={form.analysis} onChange={(e) => setForm((f) => ({ ...f, analysis: e.target.value }))} />
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.pair.trim() || !validPrices}>
          Publish signal
        </Button>
      </Card>

      <h2 className="section-title mb-2 mt-6">All signals</h2>
      <div className="space-y-2">
        {signals.isLoading && <Spinner className="mx-auto h-6 w-6 text-gold-400" />}
        {signals.isError && (
          <Card className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm">Signals could not be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => signals.refetch()}>Try again</Button>
          </Card>
        )}
        {signals.isSuccess && signals.data.length === 0 && (
          <EmptyState title="No signals yet" subtitle="Publish a signal above to share it with the selected audience." />
        )}
        {(signals.data ?? []).map((s) => (
          <Card key={s.id} className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{s.pair}</p>
                <p className="text-xs text-ink-muted">
                  {s.direction} · {AUDIENCE_LABEL[s.audience]} · {s.status}
                </p>
              </div>
              {s.status === 'OPEN' ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => update.mutate({ id: s.id, data: { status: 'HIT_TP' } })}>
                    TP
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => update.mutate({ id: s.id, data: { status: 'HIT_SL' } })}>
                    SL
                  </Button>
                </div>
              ) : (
                <Badge tone={s.status === 'HIT_TP' ? 'green' : s.status === 'HIT_SL' ? 'red' : 'grey'}>{s.status}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              {s.status === 'OPEN' && (
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: s.id, data: { status: 'CANCELLED' } })}>
                  Cancel
                </Button>
              )}
              <button onClick={() => remove.mutate(s.id)} className="ml-auto text-ink-faint hover:text-danger" aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit signal">
        {editing && (
          <div className="space-y-3">
            <Field label="Pair" value={editing.pair} onChange={(e) => setEditing({ ...editing, pair: e.target.value })} />
            <Select label="Market / instrument group" value={editing.market} onChange={(e) => setEditing({ ...editing, market: e.target.value })}>
              {(MARKETS.includes(editing.market) ? MARKETS : [editing.market, ...MARKETS]).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Direction" value={editing.direction} onChange={(e) => setEditing({ ...editing, direction: e.target.value as 'BUY' | 'SELL' })}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </Select>
              <Select label="Room" value={editing.audience} onChange={(e) => setEditing({ ...editing, audience: e.target.value as AccessTier })}>
                {AUDIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Entry" type="number" min="0" step="any" value={String(editing.entry ?? '')} onChange={(e) => setEditing({ ...editing, entry: e.target.value === '' ? null : Number(e.target.value) })} />
              <Field label="TP" type="number" min="0" step="any" value={String(editing.takeProfit ?? '')} onChange={(e) => setEditing({ ...editing, takeProfit: e.target.value === '' ? null : Number(e.target.value) })} />
              <Field label="SL" type="number" min="0" step="any" value={String(editing.stopLoss ?? '')} onChange={(e) => setEditing({ ...editing, stopLoss: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <p className={`text-xs ${validEditPrices ? 'text-ink-muted' : 'text-danger'}`}>
              {validEditPrices
                ? 'Price order looks valid.'
                : editing.direction === 'BUY'
                  ? 'For BUY: set Stop Loss below Entry and Take Profit above Entry.'
                  : 'For SELL: set Take Profit below Entry and Stop Loss above Entry.'}
            </p>
            <Select label="Status" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Signal['status'] })}>
              <option value="OPEN">OPEN — still running</option>
              <option value="HIT_TP">HIT_TP — target hit</option>
              <option value="HIT_SL">HIT_SL — stop loss hit</option>
              <option value="CANCELLED">CANCELLED — closed manually</option>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Final result %"
                type="number"
                value={String(editing.resultPct ?? '')}
                onChange={(e) => setEditing({ ...editing, resultPct: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <Field
                label="Final result (pips)"
                type="number"
                value={String(editing.resultPips ?? '')}
                onChange={(e) => setEditing({ ...editing, resultPips: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>
            <Textarea label="Analysis" value={editing.analysis ?? ''} onChange={(e) => setEditing({ ...editing, analysis: e.target.value })} />
            <Button
              size="lg"
              loading={update.isPending}
              disabled={!editing.pair.trim() || !validEditPrices}
              onClick={() =>
                update.mutate({
                  id: editing.id,
                  data: {
                    pair: editing.pair,
                    market: editing.market,
                    direction: editing.direction,
                    entry: editing.entry ?? undefined,
                    takeProfit: editing.takeProfit ?? undefined,
                    stopLoss: editing.stopLoss ?? undefined,
                    audience: editing.audience,
                    status: editing.status,
                    resultPct: editing.resultPct ?? null,
                    resultPips: editing.resultPips ?? null,
                    analysis: editing.analysis ?? undefined,
                  },
                })
              }
            >
              Save changes
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RoomsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const rooms = useQuery({ queryKey: ['admin-groups'], queryFn: adminApi.groups });
  const [form, setForm] = useState({ name: '', description: '', accessTier: 'FREE' as AccessTier, roomType: 'GENERAL' as Group['roomType'] });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-groups'] });
    qc.invalidateQueries({ queryKey: ['groups'] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, isChatOpen }: { id: string; isChatOpen: boolean }) => adminApi.updateGroup(id, { isChatOpen }),
    onSuccess: (_r, v) => {
      toast(v.isChatOpen ? 'Chat opened' : 'Chat closed', 'success');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const create = useMutation({
    mutationFn: () => adminApi.createGroup(form),
    onSuccess: () => {
      toast('Room created', 'success');
      setForm({ name: '', description: '', accessTier: 'FREE', roomType: 'GENERAL' });
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteGroup(id),
    onSuccess: () => {
      toast('Room removed', 'info');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(rooms.data ?? []).map((g) => (
          <Card key={g.id} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">{g.name}</p>
              <p className="text-xs text-ink-muted">
                {AUDIENCE_LABEL[g.accessTier] ?? g.accessTier} · {g._count?.messages ?? 0} messages ·{' '}
                {g.isChatOpen ? <span className="text-success">chat open</span> : <span className="text-danger">chat closed</span>}
              </p>
            </div>
            <Button
              size="sm"
              variant={g.isChatOpen ? 'outline' : 'gold'}
              onClick={() => toggle.mutate({ id: g.id, isChatOpen: !g.isChatOpen })}
            >
              {g.isChatOpen ? (
                <>
                  <DoorClosed className="h-3.5 w-3.5" /> Close
                </>
              ) : (
                <>
                  <DoorOpen className="h-3.5 w-3.5" /> Open
                </>
              )}
            </Button>
            <button onClick={() => remove.mutate(g.id)} className="text-ink-faint hover:text-danger" aria-label="Delete room">
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h2 className="section-title">Create a room</h2>
        <Field label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Field label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Access" value={form.accessTier} onChange={(e) => setForm((f) => ({ ...f, accessTier: e.target.value as AccessTier }))}>
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select label="Type" value={form.roomType} onChange={(e) => setForm((f) => ({ ...f, roomType: e.target.value as Group['roomType'] }))}>
            <option value="GENERAL">General</option>
            <option value="DERIV">Deriv</option>
            <option value="WELTRADE">Weltrade</option>
          </Select>
        </div>
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.name.trim().length < 2}>
          Create room
        </Button>
      </Card>
    </div>
  );
}

function UsersAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const users = useQuery({ queryKey: ['admin-users', q], queryFn: () => adminApi.users(q) });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; membership?: Membership; vipDays?: number } }) =>
      adminApi.updateUser(id, data),
    onSuccess: () => {
      toast('User updated', 'success');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div>
      <div className="mb-3">
        <input className="input" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="space-y-2">
        {users.isLoading ? (
          <Spinner className="h-6 w-6 text-gold-400" />
        ) : (
          (users.data ?? []).map((u: AdminUser) => (
            <Card key={u.id} className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-gold-200">
                  {u.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {u.name} {u.role === 'ADMIN' && <span className="text-[10px] text-gold-600">· ADMIN</span>}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{u.email}</p>
                  <p className="text-[11px] text-ink-faint">Balance ${(u.wallet?.balance ?? 0).toFixed(2)}</p>
                </div>
                <Badge tone={u.membership.startsWith('VIP') ? 'gold' : u.membership === 'PAID' ? 'green' : 'grey'}>
                  {AUDIENCE_LABEL[u.membership] ?? u.membership}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={u.membership}
                  onChange={(e) => update.mutate({ id: u.id, data: { membership: e.target.value as AccessTier, vipDays: 30 } })}
                >
                  {AUDIENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <button
                  className="text-[11px] font-semibold text-ink-muted underline"
                  onClick={() => update.mutate({ id: u.id, data: { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' } })}
                >
                  {u.role === 'ADMIN' ? 'Revoke admin' : 'Make admin'}
                </button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function PaymentsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');

  const purchases = useQuery({
    queryKey: ['admin-payments', status, provider, q],
    queryFn: () => adminApi.payments({ status: status || undefined, provider: provider || undefined, q: q || undefined }),
  });
  const refunds = useQuery({ queryKey: ['admin-refunds'], queryFn: () => adminApi.refunds() });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'verify' | 'reject' }) => adminApi.updatePurchase(id, { action }),
    onSuccess: (_r, v) => {
      toast(v.action === 'verify' ? 'Payment verified — access granted ✔' : 'Payment rejected', v.action === 'verify' ? 'success' : 'info');
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
      qc.invalidateQueries({ queryKey: ['admin-purchases'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const [refundAction, setRefundAction] = useState<{ id: string; action: 'APPROVE' | 'REJECT' | 'COMPLETE' | 'FAIL' } | null>(null);
  const [refundNote, setRefundNote] = useState('');
  const [refundRef, setRefundRef] = useState('');

  const doRefund = useMutation({
    mutationFn: (input: { id: string; action: 'APPROVE' | 'REJECT' | 'COMPLETE' | 'FAIL'; reason?: string; providerRef?: string }) =>
      adminApi.refundAction(input.id, input),
    onSuccess: (_r, v) => {
      toast(
        v.action === 'COMPLETE'
          ? 'Refund recorded as completed — access revoked'
          : v.action === 'APPROVE'
            ? 'Refund approved — complete it with the provider, then record the reference'
            : v.action === 'REJECT'
              ? 'Refund rejected'
              : 'Refund marked failed',
        v.action === 'REJECT' || v.action === 'FAIL' ? 'info' : 'success',
      );
      setRefundAction(null);
      setRefundNote('');
      setRefundRef('');
      qc.invalidateQueries({ queryKey: ['admin-refunds'] });
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const [auditFor, setAuditFor] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ['admin-payment-audit', auditFor],
    queryFn: () => adminApi.paymentAudit(auditFor ?? undefined),
    enabled: Boolean(auditFor),
  });

  const openRefunds = (refunds.data ?? []).filter((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input className="input py-2 text-xs" placeholder="Search name / email / reference" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input py-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'DISPUTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="input py-2 text-xs" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All providers</option>
            {['manual', 'stripe', 'free'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => { setStatus(''); setProvider(''); setQ(''); }}>
            Clear filters
          </Button>
        </div>
      </Card>

      {/* Orders / purchases */}
      {purchases.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : (purchases.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">No purchases match.</p>
      ) : (
        (purchases.data ?? []).map((p) => (
          <Card key={p.id} className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{p.itemTitle}</p>
                <p className="text-xs text-ink-muted">
                  {p.user?.name} ({p.user?.email}) · {p.itemType} · <span className="uppercase">{p.provider}</span> · $
                  {Number(p.amount).toFixed(2)} · {new Date(p.createdAt).toLocaleString()}
                </p>
                {p.providerRef && <p className="text-[11px] text-ink-faint">Ref: {p.providerRef}</p>}
                {p.payment?.providerTransactionRef && (
                  <p className="text-[11px] text-ink-faint">
                    Provider ref: {p.payment.providerTransactionRef} · status: {p.payment.status} · updates: {p.payment.statusUpdates}
                  </p>
                )}
                {p.receipt && <p className="text-[11px] text-ink-faint">Receipt: {p.receipt.receiptNumber}</p>}
                {p.proofNote && <p className="text-[11px] text-ink-faint">Proof: {p.proofNote}</p>}
                {p.refunds && p.refunds.length > 0 && (
                  <p className="text-[11px] text-danger">
                    Refunds: {p.refunds.map((r) => `${r.status} ($${Number(r.amount).toFixed(2)})`).join(', ')}
                  </p>
                )}
              </div>
              <Badge tone={p.status === 'PAID' ? 'green' : p.status === 'FAILED' ? 'red' : 'grey'}>{p.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {p.status !== 'PAID' && p.status !== 'FAILED' && p.provider === 'manual' && (
                <>
                  <Button size="sm" variant="gold" onClick={() => act.mutate({ id: p.id, action: 'verify' })}>
                    <BadgeCheck className="h-3.5 w-3.5" /> Verify payment
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: p.id, action: 'reject' })}>
                    Reject
                  </Button>
                </>
              )}
              {p.payment && (
                <Button size="sm" variant="outline" onClick={() => setAuditFor(auditFor === p.id ? null : p.id)}>
                  {auditFor === p.id ? 'Hide audit trail' : 'Audit trail'}
                </Button>
              )}
            </div>
            {auditFor === p.id && audit.data && (
              <div className="space-y-1 rounded-lg bg-cream-100 p-2">
                {audit.data.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">No audit entries.</p>
                ) : (
                  audit.data.map((a) => (
                    <p key={a.id} className="text-[11px] text-ink-soft">
                      {new Date(a.createdAt).toLocaleString()} · <strong>{a.action}</strong> ({a.source}){a.note ? ` — ${a.note}` : ''}
                    </p>
                  ))
                )}
              </div>
            )}
          </Card>
        ))
      )}

      {/* Refunds */}
      <h3 className="section-title mt-4">Refunds</h3>
      <p className="text-xs text-ink-muted">
        Approve refund requests, then record the provider reference when the refund is complete.
      </p>
      {(refunds.data ?? []).length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">No refund requests.</p>
      ) : (
        (refunds.data ?? []).map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  {r.purchase?.itemTitle} — {r.currency} {Number(r.amount).toFixed(2)}
                </p>
                <p className="text-xs text-ink-muted">
                  {r.user?.name} ({r.user?.email}) · {new Date(r.createdAt).toLocaleString()}
                </p>
                <p className="text-[11px] text-ink-faint">Reason: {r.reason}</p>
                {r.providerRef && <p className="text-[11px] text-ink-faint">Provider refund ref: {r.providerRef}</p>}
                {r.adminNote && <p className="text-[11px] text-ink-faint">Note: {r.adminNote}</p>}
              </div>
              <Badge tone={r.status === 'COMPLETED' ? 'green' : r.status === 'REJECTED' || r.status === 'FAILED' ? 'red' : 'grey'}>
                {r.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.status === 'REQUESTED' && (
                <>
                  <Button size="sm" variant="gold" onClick={() => setRefundAction({ id: r.id, action: 'APPROVE' })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefundAction({ id: r.id, action: 'REJECT' })}>
                    Reject
                  </Button>
                </>
              )}
              {r.status === 'APPROVED' && (
                <>
                  <Button size="sm" variant="gold" onClick={() => setRefundAction({ id: r.id, action: 'COMPLETE' })}>
                    Record completed refund
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefundAction({ id: r.id, action: 'FAIL' })}>
                    Mark failed
                  </Button>
                </>
              )}
            </div>
            {refundAction?.id === r.id && (
              <div className="space-y-2 rounded-lg bg-cream-100 p-2">
                {refundAction.action === 'COMPLETE' && (
                  <input
                    className="input py-2 text-xs"
                    placeholder="Refund provider reference (required)"
                    value={refundRef}
                    onChange={(e) => setRefundRef(e.target.value)}
                  />
                )}
                <input
                  className="input py-2 text-xs"
                  placeholder="Note / reason (optional)"
                  value={refundNote}
                  onChange={(e) => setRefundNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={doRefund.isPending}
                    disabled={refundAction.action === 'COMPLETE' && refundRef.trim().length < 3}
                    onClick={() =>
                      doRefund.mutate({
                        id: r.id,
                        action: refundAction.action,
                        reason: refundNote || undefined,
                        providerRef: refundRef || undefined,
                      })
                    }
                  >
                    Confirm {refundAction.action.toLowerCase()}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefundAction(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))
      )}
      {openRefunds.length === 0 && (refunds.data ?? []).length > 0 && (
        <p className="text-xs text-ink-muted">All refund requests have been actioned.</p>
      )}
    </div>
  );
}

function TransactionsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const txns = useQuery({ queryKey: ['admin-transactions'], queryFn: () => adminApi.transactions() });
  const [decision, setDecision] = useState<{ id: string; action: 'paid' | 'reject' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const decisionTxn = (txns.data ?? []).find((t) => t.id === decision?.id);

  const act = useMutation({
    mutationFn: (input: {
      id: string;
      action: 'approve' | 'reject' | 'processing' | 'paid';
      adminNote?: string;
      providerRef?: string;
    }) => adminApi.updateTransaction(input.id, input),
    onSuccess: (_r, v) => {
      toast(
        v.action === 'paid'
          ? 'Withdrawal marked paid with reference'
          : v.action === 'processing'
            ? 'Withdrawal moved to processing'
            : v.action === 'reject'
              ? 'Transaction rejected and funds refunded where applicable'
              : 'Deposit approved',
        'success',
      );
      setDecision(null);
      setDecisionNote('');
      setProviderRef('');
      qc.invalidateQueries({ queryKey: ['admin-transactions'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="space-y-2">
      {txns.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : (
        (txns.data ?? []).map((t: AdminTxn) => (
          <Card key={t.id} className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold capitalize">
                  {t.type.toLowerCase()} · {t.currency} {t.amount.toFixed(2)}
                </p>
                <p className="text-xs text-ink-muted">
                  {t.user?.name} · {t.method ?? '—'} · {t.reference}
                </p>
                {t.destination && <p className="text-[11px] text-ink-faint">To: {t.destination}</p>}
                {t.type === 'WITHDRAWAL' && (
                  <p className="text-[11px] text-ink-faint">
                    Fee {t.currency} {(t.fee ?? 0).toFixed(2)} · payout {t.currency} {(t.netAmount ?? t.amount - (t.fee ?? 0)).toFixed(2)}
                  </p>
                )}
                {t.providerRef && <p className="text-[11px] text-ink-faint">Payout ref: {t.providerRef}</p>}
              </div>
              <Badge tone={t.status === 'COMPLETED' ? 'green' : t.status === 'FAILED' ? 'red' : 'grey'}>{t.status}</Badge>
            </div>
            {t.adminNote && <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">{t.adminNote}</p>}
            {t.statusHistory?.length ? (
              <div className="space-y-1">
                {t.statusHistory.map((event) => (
                  <p key={event.id} className="text-[11px] text-ink-faint">
                    {event.toStatus} · {new Date(event.createdAt).toLocaleString()}
                    {event.note ? ` · ${event.note}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
            {t.status !== 'COMPLETED' && t.status !== 'FAILED' ? (
              <div className="flex gap-2">
                {t.type === 'WITHDRAWAL' ? (
                  <>
                    {t.status !== 'PROCESSING' && (
                      <Button size="sm" variant="gold" onClick={() => act.mutate({ id: t.id, action: 'processing' })}>
                        Start payout
                      </Button>
                    )}
                    {t.status === 'PROCESSING' && (
                      <Button size="sm" variant="gold" onClick={() => setDecision({ id: t.id, action: 'paid' })}>
                        Mark paid
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDecision({ id: t.id, action: 'reject' })}>
                      Reject &amp; refund
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="gold" onClick={() => act.mutate({ id: t.id, action: 'approve' })}>
                      Approve deposit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'reject' })}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </Card>
        ))
      )}
      <Modal
        open={Boolean(decision)}
        onClose={() => {
          setDecision(null);
          setDecisionNote('');
          setProviderRef('');
        }}
        title={decision?.action === 'paid' ? 'Confirm payout' : 'Reject withdrawal'}
      >
        <div className="space-y-3">
          {decision?.action === 'paid' ? (
            <>
              <p className="text-sm text-ink-muted">
                Enter the verified bank or wallet payment reference. This action records the payout as completed; it does not send money.
              </p>
              <Field
                label={decisionTxn?.method === 'USDT_TRC20' ? 'Verified TRC20 transaction hash' : 'Verified payout reference'}
                value={providerRef}
                onChange={(e) => setProviderRef(e.target.value)}
                placeholder={decisionTxn?.method === 'USDT_TRC20' ? '64-character transaction hash' : 'Provider transaction or reconciliation reference'}
                hint={decisionTxn?.method === 'USDT_TRC20' ? 'Confirm the transaction on a TRON explorer before marking it paid. A screenshot alone is not sufficient.' : undefined}
              />
            </>
          ) : (
            <Textarea
              label="Rejection reason"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="Explain why the request was rejected"
            />
          )}
          <Button
            size="lg"
            variant={decision?.action === 'reject' ? 'outline' : 'gold'}
            loading={act.isPending}
            disabled={
              !decision ||
              (decision.action === 'paid'
                ? decisionTxn?.method === 'USDT_TRC20'
                  ? !/^[a-fA-F0-9]{64}$/.test(providerRef.trim())
                  : providerRef.trim().length < 3
                : decisionNote.trim().length < 3)
            }
            onClick={() => {
              if (!decision) return;
              act.mutate({
                id: decision.id,
                action: decision.action,
                ...(decision.action === 'paid' ? { providerRef: providerRef.trim() } : { adminNote: decisionNote.trim() }),
              });
            }}
          >
            {decision?.action === 'paid' ? 'Confirm paid' : 'Reject &amp; refund'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const ACCOUNT_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
];

function WeltradeAccountsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rejecting, setRejecting] = useState<AdminBrokerAccount | null>(null);
  const [reason, setReason] = useState('');
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ['admin-weltrade-accounts', filter, query],
    queryFn: () => weltradeAccountAdminApi.list({ status: filter || undefined, q: query || undefined }),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; action: 'verify' | 'reject'; reason?: string }) =>
      weltradeAccountAdminApi.update(input.id, { action: input.action, reason: input.reason }),
    onSuccess: (_r, input) => {
      toast(
        input.action === 'verify' ? 'Client ID verified ✔' : 'Client ID rejected — member notified',
        input.action === 'verify' ? 'success' : 'info',
      );
      setRejecting(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin-weltrade-accounts'] });
      qc.invalidateQueries({ queryKey: ['weltrade-account'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const data = list.data;
  const accounts = data?.accounts ?? [];
  const savedLink = data?.registerUrl ?? '';
  const linkValue = linkDraft ?? savedLink;

  const saveLink = useMutation({
    mutationFn: (value: string) => weltradeAccountAdminApi.saveConfig(value),
    onSuccess: (res) => {
      setLinkDraft(null);
      toast(res.registerUrl ? 'Registration link saved' : 'Registration link cleared', 'success');
      qc.invalidateQueries({ queryKey: ['admin-weltrade-accounts'] });
      qc.invalidateQueries({ queryKey: ['weltrade-account'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="space-y-3">
      {/* Summary + registration link */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Pending', value: data?.pending ?? 0 },
          { label: 'Verified', value: data?.verified ?? 0 },
          { label: 'Rejected', value: data?.rejected ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="!p-3 text-center">
            <p className="text-lg font-extrabold text-gold-600">{s.value}</p>
            <p className="text-[11px] text-ink-muted">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Sign-up link: env default, editable at runtime (never invented). */}
      <Card className="space-y-2">
        <Field
          label="Weltrade registration link"
          placeholder="https://…"
          value={linkValue}
          onChange={(e) => setLinkDraft(e.target.value)}
          hint="Paste the official sign-up URL. Leave empty to fall back to WELTRADE_REGISTER_URL."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="gold"
            loading={saveLink.isPending}
            disabled={linkValue.trim() === savedLink}
            onClick={() => saveLink.mutate(linkValue.trim())}
          >
            Save link
          </Button>
          {savedLink && (
            <Button size="sm" variant="ghost" disabled={saveLink.isPending} onClick={() => saveLink.mutate('')}>
              Clear
            </Button>
          )}
          {savedLink && (
            <a href={savedLink} target="_blank" rel="noreferrer noopener" className="btn-ghost px-3 py-1.5 text-xs">
              Open ↗
            </a>
          )}
        </div>
        {!savedLink && !linkValue && (
          <p className="text-xs leading-relaxed text-ink-muted">
            No link configured — the dashboard button shows a “not configured” notice until one is saved.
          </p>
        )}
      </Card>

      {/* Search + status filter */}
      <Field
        placeholder="Search by name, email or client ID"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {ACCOUNT_FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {list.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="h-10 w-10" />}
          title="No Weltrade submissions yet"
          subtitle="Client IDs submitted from the dashboard will appear here for verification."
        />
      ) : (
        accounts.map((a) => (
          <Card key={a.id} className="space-y-2.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.user?.name ?? 'Member'}</p>
                <p className="truncate text-xs text-ink-muted">{a.user?.email}</p>
                <p className="mt-1 break-all rounded-lg bg-cream-100 px-2 py-1 text-xs font-mono font-semibold text-ink">
                  {a.clientId}
                </p>
              </div>
              <Badge tone={a.status === 'VERIFIED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'gold'}>
                {a.status}
              </Badge>
            </div>

            <p className="text-[11px] text-ink-faint">
              Submitted {new Date(a.submittedAt).toLocaleString()}
              {a.reviewedAt && ` · reviewed ${new Date(a.reviewedAt).toLocaleString()}`}
            </p>

            {a.rejectReason && (
              <p className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
                Rejected: {a.rejectReason}
              </p>
            )}

            {a.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="gold" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: 'verify' })}>
                  <BadgeCheck className="h-3.5 w-3.5" /> Verify client ID
                </Button>
                <Button size="sm" variant="danger" disabled={decide.isPending} onClick={() => { setRejecting(a); setReason(''); }}>
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            )}
            {a.status === 'REJECTED' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="gold" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: 'verify' })}>
                  <BadgeCheck className="h-3.5 w-3.5" /> Verify now
                </Button>
              </div>
            )}
            {a.status === 'VERIFIED' && (
              <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => { setRejecting(a); setReason(''); }}>
                Revoke verification
              </Button>
            )}

            {a.events.length > 0 && (
              <details className="rounded-xl border border-cream-200 bg-cream-50 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-ink-muted">Audit history</summary>
                <ul className="mt-2 space-y-1.5">
                  {a.events.map((ev) => (
                    <li key={ev.id} className="text-[11px] leading-relaxed text-ink-muted">
                      <span className="font-semibold text-ink">{ev.action}</span>
                      {ev.actorName && ` · ${ev.actorName}`}
                      {ev.reason && ` — ${ev.reason}`}
                      <span className="text-ink-faint"> · {new Date(ev.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        ))
      )}

      <Modal
        open={Boolean(rejecting)}
        onClose={() => { setRejecting(null); setReason(''); }}
        title="Reject client ID"
      >
        <p className="mb-3 text-sm text-ink-muted">
          Tell {rejecting?.user?.name ?? 'the member'} what is wrong with <span className="font-semibold">{rejecting?.clientId}</span>.
          The reason is shown to them and they can submit a corrected ID.
        </p>
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. This client ID belongs to a different account"
        />
        <div className="mt-4 flex gap-2">
          <Button
            variant="danger"
            loading={decide.isPending}
            disabled={!reason.trim()}
            onClick={() => rejecting && decide.mutate({ id: rejecting.id, action: 'reject', reason: reason.trim() })}
          >
            Reject submission
          </Button>
          <Button variant="ghost" onClick={() => { setRejecting(null); setReason(''); }}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BroadcastAdmin() {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: '', body: '', type: 'SYSTEM', audience: '' });

  const send = useMutation({
    mutationFn: () =>
      adminApi.broadcast({ title: form.title, body: form.body, type: form.type, audience: form.audience || undefined }),
    onSuccess: (res: { delivered: number }) => {
      toast(`Broadcast sent to ${res.delivered} members 📣`, 'success');
      setForm({ title: '', body: '', type: 'SYSTEM', audience: '' });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <Card className="space-y-3">
      <h2 className="section-title flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-gold-500" /> Broadcast notification
      </h2>
      <Field label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <Textarea label="Message" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
          {['SYSTEM', 'SIGNAL', 'EDUCATION', 'PAYMENT', 'SUBSCRIPTION', 'COMMUNITY'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select label="Audience" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
          <option value="">Everyone</option>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!form.title || !form.body}>
        <Send className="h-4 w-4" /> Send broadcast
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- Courses

type CourseFormState = {
  slug: string;
  title: string;
  description: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  price: string;
  currency: string;
  saleStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN' | 'SOLD_OUT';
  isVip: boolean;
  coverUrl: string;
  published: boolean;
  order: string;
};

type SetForm = Dispatch<SetStateAction<CourseFormState>>;

const emptyCourse: CourseFormState = {
  slug: '',
  title: '',
  description: '',
  level: 'Beginner',
  price: '0',
  currency: 'USD',
  saleStatus: 'AVAILABLE',
  isVip: false,
  coverUrl: '',
  published: true,
  order: '0',
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toCoursePayload(f: CourseFormState) {
  return {
    slug: f.slug.trim() || slugify(f.title),
    title: f.title.trim(),
    description: f.description.trim() || null,
    level: f.level,
    price: Number(f.price) || 0,
    currency: f.currency,
    saleStatus: f.saleStatus,
    isVip: f.isVip,
    coverUrl: f.coverUrl.trim() || null,
    published: f.published,
    order: Number(f.order) || 0,
  };
}

function CourseFields({ form, setForm }: { form: CourseFormState; setForm: SetForm }) {
  return (
    <>
      <Field label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <Field
        label="Slug"
        hint="Leave blank to auto-generate from the title"
        value={form.slug}
        onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
      />
      <Textarea label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Level" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value as CourseFormState['level'] }))}>
          {['Beginner', 'Intermediate', 'Advanced'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
        <Field label="Price (0 = free)" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" value={form.currency} maxLength={3} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
        <Select label="Sale status" value={form.saleStatus} onChange={(e) => setForm((f) => ({ ...f, saleStatus: e.target.value as CourseFormState['saleStatus'] }))}>
          <option value="AVAILABLE">Available</option>
          <option value="UNAVAILABLE">Unavailable</option>
          <option value="HIDDEN">Hidden</option>
          <option value="SOLD_OUT">Sold out</option>
        </Select>
      </div>
      <Field
        label="Cover image URL (optional)"
        value={form.coverUrl}
        onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order" type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isVip} onChange={(e) => setForm((f) => ({ ...f, isVip: e.target.checked }))} /> VIP course
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} /> Published
          </label>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Broker deposit & withdrawal management (Deriv / Weltrade) — an admin-only,
// fully auditable ledger that is separate from the ATG wallet.
// ---------------------------------------------------------------------------

const FUNDING_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

function fundingTone(status: string): 'green' | 'red' | 'gold' | 'grey' {
  if (status === 'COMPLETED') return 'green';
  if (status === 'REJECTED' || status === 'FAILED') return 'red';
  if (status === 'APPROVED' || status === 'PROCESSING') return 'gold';
  return 'grey';
}

const BROKER_LABEL: Record<BrokerId, string> = { DERIV: 'Deriv', WELTRADE: 'Weltrade' };

type BrokerQueue = 'Deposits' | 'Withdrawals' | 'Audit' | 'Balances' | 'Limits';

type FundingAction = 'review' | 'approve' | 'start_processing' | 'complete' | 'reject' | 'fail';

function BrokerFundsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [queue, setQueue] = useState<BrokerQueue>('Deposits');
  const [broker, setBroker] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [evidenceForm, setEvidenceForm] = useState({ providerRef: '', evidence: '' });
  const [note, setNote] = useState('');
  const [balForm, setBalForm] = useState({ userId: '', broker: 'DERIV', balance: '', source: 'MANUAL_VERIFICATION', reference: '' });
  const [limitsForm, setLimitsForm] = useState({ depositMin: '', depositMax: '', withdrawalMin: '', withdrawalMax: '', dailyMax: '', pendingLimit: '', feePct: '' });

  const filters = {
    broker: broker || undefined,
    status: status || undefined,
    q: q || undefined,
    minAmount: minAmount || undefined,
    maxAmount: maxAmount || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const showList = queue === 'Deposits' || queue === 'Withdrawals';

  const list = useQuery({
    queryKey: ['admin-broker', queue, filters],
    queryFn: () => (queue === 'Withdrawals' ? brokerAdminApi.withdrawals(filters) : brokerAdminApi.deposits(filters)),
    enabled: showList,
  });
  const stats = useQuery({ queryKey: ['admin-broker-stats'], queryFn: brokerAdminApi.stats });
  const audit = useQuery({ queryKey: ['admin-broker-audit'], queryFn: () => brokerAdminApi.audit(), enabled: queue === 'Audit' });
  const balances = useQuery({ queryKey: ['admin-broker-balances'], queryFn: () => brokerAdminApi.balances(), enabled: queue === 'Balances' });
  const settings = useQuery({ queryKey: ['admin-broker-settings'], queryFn: () => brokerAdminApi.settings(), enabled: queue === 'Limits' });
  const picker = useQuery({ queryKey: ['admin-users-picker'], queryFn: () => adminApi.users(), enabled: queue === 'Balances' });
  const completingTransaction = list.data?.find((tx) => tx.id === completeId);
  const completingUsdt = completingTransaction?.method === 'USDT_TRC20';
  const validUsdtHash = /^[a-fA-F0-9]{64}$/.test(evidenceForm.providerRef.trim());

  // Hydrate the limits form once the current values arrive.
  useEffect(() => {
    const s = settings.data?.settings;
    if (!s) return;
    setLimitsForm({
      depositMin: String(s.deposit.min),
      depositMax: String(s.deposit.max),
      withdrawalMin: String(s.withdrawal.min),
      withdrawalMax: String(s.withdrawal.max),
      dailyMax: String(s.withdrawal.dailyMax),
      pendingLimit: String(s.pendingLimit),
      feePct: String(s.feePct),
    });
  }, [settings.data]);
  const detail = useQuery({
    queryKey: ['admin-broker-tx', selected],
    queryFn: () => brokerAdminApi.transaction(selected!),
    enabled: Boolean(selected),
  });

  const s = stats.data;
  const reviewCount =
    (s?.deposits.PENDING ?? 0) + (s?.deposits.UNDER_REVIEW ?? 0) + (s?.withdrawals.PENDING ?? 0) + (s?.withdrawals.UNDER_REVIEW ?? 0);
  const activeCount =
    (s?.deposits.APPROVED ?? 0) + (s?.deposits.PROCESSING ?? 0) + (s?.withdrawals.APPROVED ?? 0) + (s?.withdrawals.PROCESSING ?? 0);
  const readyGateways = s?.gateways.filter((g) => g.ready).length ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-broker'] });
    qc.invalidateQueries({ queryKey: ['admin-broker-stats'] });
    qc.invalidateQueries({ queryKey: ['admin-broker-audit'] });
    qc.invalidateQueries({ queryKey: ['admin-broker-tx'] });
    qc.invalidateQueries({ queryKey: ['broker-funds'] });
    qc.invalidateQueries({ queryKey: ['broker-balances'] });
  };

  const act = useMutation({
    mutationFn: (v: { id: string; action: FundingAction; adminNote?: string; providerRef?: string; evidence?: string; failureReason?: string }) =>
      brokerAdminApi.update(v.id, {
        action: v.action,
        adminNote: v.adminNote,
        providerRef: v.providerRef,
        evidence: v.evidence,
        failureReason: v.failureReason,
      }),
    onSuccess: (_r, v) => {
      toast(`Request marked ${FUNDING_LABEL[v.action === 'start_processing' ? 'PROCESSING' : v.action === 'review' ? 'UNDER_REVIEW' : v.action.toUpperCase()] ?? v.action} ✔`, 'success');
      setCompleteId(null);
      setEvidenceForm({ providerRef: '', evidence: '' });
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const addNote = useMutation({
    mutationFn: (v: { id: string; note: string }) => brokerAdminApi.addNote(v.id, v.note),
    onSuccess: () => {
      toast('Internal note saved', 'success');
      setNote('');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const saveBal = useMutation({
    mutationFn: () =>
      brokerAdminApi.saveBalance({
        userId: balForm.userId,
        broker: balForm.broker as BrokerId,
        balance: Number(balForm.balance),
        source: balForm.source,
        reference: balForm.reference,
      }),
    onSuccess: () => {
      toast('Broker balance verified and recorded', 'success');
      setBalForm((f) => ({ ...f, balance: '', reference: '' }));
      qc.invalidateQueries({ queryKey: ['admin-broker-balances'] });
      qc.invalidateQueries({ queryKey: ['broker-balances'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const saveLimits = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
      return brokerAdminApi.saveSettings({
        deposit: { min: n(limitsForm.depositMin), max: n(limitsForm.depositMax) },
        withdrawal: { min: n(limitsForm.withdrawalMin), max: n(limitsForm.withdrawalMax), dailyMax: n(limitsForm.dailyMax) },
        pendingLimit: n(limitsForm.pendingLimit),
        feePct: n(limitsForm.feePct),
      });
    },
    onSuccess: () => {
      toast('Broker limits saved — applied immediately, no restart needed', 'success');
      qc.invalidateQueries({ queryKey: ['admin-broker-settings'] });
      qc.invalidateQueries({ queryKey: ['broker-funds'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const rowActions = (t: AdminBrokerFunding) => {
    const items: { label: string; icon: ReactNode; run: () => void }[] = [];
    if (t.status === 'PENDING') {
      items.push({ label: 'Send to review', icon: <Eye className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'review' }) });
      items.push({ label: 'Reject', icon: <XCircle className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'reject' }) });
    } else if (t.status === 'UNDER_REVIEW') {
      items.push({ label: 'Approve', icon: <BadgeCheck className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'approve' }) });
      items.push({ label: 'Reject', icon: <XCircle className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'reject' }) });
    } else if (t.status === 'APPROVED') {
      items.push({ label: 'Start processing', icon: <RotateCw className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'start_processing' }) });
      items.push({ label: 'Reject', icon: <XCircle className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'reject' }) });
    } else if (t.status === 'PROCESSING') {
      items.push({ label: 'Mark completed', icon: <CheckCircle2 className="h-3.5 w-3.5" />, run: () => setCompleteId(t.id) });
      items.push({ label: 'Mark failed', icon: <XCircle className="h-3.5 w-3.5" />, run: () => act.mutate({ id: t.id, action: 'fail', failureReason: 'Marked failed by administrator after review' }) });
    }
    return items;
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title flex items-center gap-2">
          <Landmark className="h-5 w-5 text-gold-500" /> Broker deposit &amp; withdrawal management
        </h2>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {(['Deposits', 'Withdrawals', 'Audit', 'Balances', 'Limits'] as BrokerQueue[]).map((x) => (
            <Chip key={x} active={queue === x} onClick={() => setQueue(x)}>
              {x}
            </Chip>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card className="p-3">
          <p className="text-[11px] text-ink-muted">Awaiting review</p>
          <p className="text-xl font-extrabold">{reviewCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-ink-muted">Approved / processing</p>
          <p className="text-xl font-extrabold">{activeCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-ink-muted">Completed</p>
          <p className="text-xl font-extrabold">
            {s?.completed.count ?? 0}
            <span className="ml-1 text-xs font-semibold text-ink-muted">
              {s ? `${s.currency} ${s.completed.amount.toFixed(2)}` : ''}
            </span>
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-ink-muted">Automated gateways ready</p>
          <p className="text-xl font-extrabold">
            {readyGateways}/{s?.gateways.length ?? 0}
          </p>
        </Card>
      </div>

      {showList && (
        <Card className="space-y-3">
          <p className="section-title flex items-center gap-2">
            <Search className="h-4 w-4 text-gold-500" /> Filters
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Search" placeholder="Name, email or reference" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(FUNDING_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select label="Broker" value={broker} onChange={(e) => setBroker(e.target.value)}>
              <option value="">Deriv &amp; Weltrade</option>
              <option value="DERIV">Deriv</option>
              <option value="WELTRADE">Weltrade</option>
            </Select>
            <Field label="Min amount" type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            <Field label="Max amount" type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </Card>
      )}

      {queue === 'Audit' && (
        <Card className="space-y-2">
          <p className="section-title flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gold-500" /> Audit log
          </p>
          {audit.isLoading ? (
            <Spinner className="h-6 w-6 text-gold-400" />
          ) : (audit.data ?? []).length === 0 ? (
            <EmptyState title="No audit events yet" subtitle="Every status change and webhook is recorded here." />
          ) : (
            (audit.data ?? []).map((e: BrokerAuditEntry) => (
              <div key={e.id} className="rounded-xl border border-cream-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={fundingTone(e.toStatus ?? '')}>{e.action.replace(/_/g, ' ').toUpperCase()}</Badge>
                  <span className="text-xs font-semibold text-ink">{e.transaction?.reference ?? '—'}</span>
                  <span className="text-[11px] text-ink-faint">
                    {e.source === 'PROVIDER' ? 'Webhook' : e.source === 'ADMIN' ? e.actorName ?? 'Administrator' : e.source === 'CUSTOMER' ? 'Customer' : 'System'}
                  </span>
                  <span className="ml-auto text-[11px] text-ink-faint">{new Date(e.at).toLocaleString()}</span>
                </div>
                {e.note && <p className="mt-1 text-[11px] text-ink-muted">{e.note}</p>}
                {e.eventId && <p className="text-[11px] text-ink-faint">Event {e.eventId} · {e.provider ?? '—'}</p>}
              </div>
            ))
          )}
        </Card>
      )}

      {queue === 'Balances' && (
        <>
          <Card className="space-y-3">
            <p className="section-title">Record a verified broker balance</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Member" value={balForm.userId} onChange={(e) => setBalForm((f) => ({ ...f, userId: e.target.value }))}>
                <option value="">Select a member…</option>
                {(picker.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email}
                  </option>
                ))}
              </Select>
              <Select label="Broker" value={balForm.broker} onChange={(e) => setBalForm((f) => ({ ...f, broker: e.target.value }))}>
                <option value="DERIV">Deriv</option>
                <option value="WELTRADE">Weltrade</option>
              </Select>
              <Field label="Balance" type="number" value={balForm.balance} onChange={(e) => setBalForm((f) => ({ ...f, balance: e.target.value }))} />
              <Field label="Source" value={balForm.source} onChange={(e) => setBalForm((f) => ({ ...f, source: e.target.value }))} hint="e.g. BROKER_API or MANUAL_VERIFICATION" />
            </div>
            <Field
              label="Verification reference"
              value={balForm.reference}
              onChange={(e) => setBalForm((f) => ({ ...f, reference: e.target.value }))}
              hint="Screenshot, API response id or statement reference"
            />
            <Button
              size="sm"
              onClick={() => saveBal.mutate()}
              loading={saveBal.isPending}
              disabled={!balForm.userId || !balForm.balance || Number(balForm.balance) <= 0}
            >
              Save balance
            </Button>
          </Card>

          <div className="space-y-2">
            {balances.isLoading ? (
              <Spinner className="h-6 w-6 text-gold-400" />
            ) : (balances.data ?? []).length === 0 ? (
              <EmptyState title="No verified balances yet" subtitle="Members see their balance only after you verify it here." />
            ) : (
              (balances.data ?? []).map((b) => (
                <Card key={b.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {b.user?.name ?? b.userId} · {BROKER_LABEL[b.broker]}
                    </p>
                    <p className="text-xs text-ink-muted">{b.source.replace(/_/g, ' ')} · Updated {new Date(b.updatedAt).toLocaleString()}</p>
                    {b.reference && <p className="text-[11px] text-ink-faint">Ref: {b.reference}</p>}
                  </div>
                  <p className="text-sm font-bold">
                    {b.currency} {b.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      {queue === 'Limits' && (
        <Card className="space-y-3">
          <p className="section-title">Limits &amp; fees</p>
          <p className="text-xs text-ink-muted">
            Stored in the database and enforced by the API on every request. Changes apply immediately — no restart or
            redeploy. Env vars provide the initial defaults.
          </p>
          {settings.isLoading ? (
            <Spinner className="h-6 w-6 text-gold-400" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Deposit minimum" type="number" value={limitsForm.depositMin} onChange={(e) => setLimitsForm((f) => ({ ...f, depositMin: e.target.value }))} />
                <Field label="Deposit maximum" type="number" value={limitsForm.depositMax} onChange={(e) => setLimitsForm((f) => ({ ...f, depositMax: e.target.value }))} />
                <Field label="Withdrawal minimum" type="number" value={limitsForm.withdrawalMin} onChange={(e) => setLimitsForm((f) => ({ ...f, withdrawalMin: e.target.value }))} />
                <Field label="Withdrawal maximum" type="number" value={limitsForm.withdrawalMax} onChange={(e) => setLimitsForm((f) => ({ ...f, withdrawalMax: e.target.value }))} />
                <Field label="Daily withdrawal limit" type="number" value={limitsForm.dailyMax} onChange={(e) => setLimitsForm((f) => ({ ...f, dailyMax: e.target.value }))} hint="Rolling 24h" />
                <Field label="Open requests per member" type="number" value={limitsForm.pendingLimit} onChange={(e) => setLimitsForm((f) => ({ ...f, pendingLimit: e.target.value }))} />
                <Field label="Deposit admin fee (%)" type="number" value={limitsForm.feePct} onChange={(e) => setLimitsForm((f) => ({ ...f, feePct: e.target.value }))} hint="Snapshotted on each deposit" />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => saveLimits.mutate()} loading={saveLimits.isPending}>
                  Save limits
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const s = settings.data?.settings;
                    if (!s) return;
                    setLimitsForm({
                      depositMin: String(s.deposit.min),
                      depositMax: String(s.deposit.max),
                      withdrawalMin: String(s.withdrawal.min),
                      withdrawalMax: String(s.withdrawal.max),
                      dailyMax: String(s.withdrawal.dailyMax),
                      pendingLimit: String(s.pendingLimit),
                      feePct: String(s.feePct),
                    });
                  }}
                >
                  Reset to current
                </Button>
                {settings.data && (
                  <span className="text-[11px] text-ink-faint">
                    Currently: deposit {settings.data.settings.deposit.min}–{settings.data.settings.deposit.max} · fee{' '}
                    {settings.data.settings.feePct}% · pending limit {settings.data.settings.pendingLimit}
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {showList && (
        <div className="space-y-2">
          {list.isLoading ? (
            <Spinner className="h-6 w-6 text-gold-400" />
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState title="No requests match these filters" subtitle="Try clearing the status or broker filter." />
          ) : (
            (list.data ?? []).map((t: AdminBrokerFunding) => (
              <Card key={t.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {t.direction === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · {BROKER_LABEL[t.broker]} · {t.currency} {t.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {t.user?.name ?? '—'} {t.user?.email ? `· ${t.user.email}` : ''} · {t.reference}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      {new Date(t.createdAt).toLocaleString()} · {t.method} · {t.processingMode === 'manual' ? 'Manual' : 'Automated'}
                      {t.providerRef ? ` · Provider ref ${t.providerRef}` : ''}
                    </p>
                    {t.hasDestination && <p className="text-[11px] text-ink-faint">Destination: {t.destinationMasked}</p>}
                    {t.internalNote && <p className="text-[11px] text-ink-faint">Internal note: {t.internalNote}</p>}
                    {t.failureReason && <p className="text-[11px] font-semibold text-danger">Failure: {t.failureReason}</p>}
                  </div>
                  <Badge tone={fundingTone(t.status)}>{FUNDING_LABEL[t.status] ?? t.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelected(t.id)}>
                    <Eye className="h-3.5 w-3.5" /> Details
                  </Button>
                  {rowActions(t).map((a) => (
                    <Button
                      key={a.label}
                      size="sm"
                      variant={a.label.startsWith('Reject') || a.label === 'Mark failed' ? 'danger' : 'gold'}
                      onClick={a.run}
                      disabled={act.isPending}
                    >
                      {a.icon} {a.label}
                    </Button>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Completion requires verified evidence — enforced by the API too. */}
      <Modal open={Boolean(completeId)} onClose={() => setCompleteId(null)} title="Confirm completion">
        <div className="space-y-4">
          <Field
            label={completingUsdt ? 'Verified TRC20 transaction hash' : 'Provider reference'}
            value={evidenceForm.providerRef}
            onChange={(e) => setEvidenceForm((f) => ({ ...f, providerRef: e.target.value }))}
            hint={completingUsdt ? 'Confirm the transfer on a TRON explorer before recording it as paid.' : 'Transaction id from the payment provider / broker'}
          />
          <Textarea
            label="Evidence"
            value={evidenceForm.evidence}
            onChange={(e) => setEvidenceForm((f) => ({ ...f, evidence: e.target.value }))}
            placeholder="Statement, wallet transaction id, withdrawal proof…"
          />
          <p className="text-xs text-ink-muted">
            {completingUsdt
              ? 'A 64-character transaction hash is required. Screenshots alone are not proof of a completed transfer.'
              : 'A request cannot be completed without a provider reference or an evidence note — this keeps every completed transaction provable.'}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                completeId &&
                act.mutate({
                  id: completeId,
                  action: 'complete',
                  providerRef: evidenceForm.providerRef.trim() || undefined,
                  evidence: evidenceForm.evidence.trim() || undefined,
                })
              }
              loading={act.isPending}
              disabled={completingUsdt && !validUsdtHash}
            >
              <CheckCircle2 className="h-4 w-4" /> Mark completed
            </Button>
            <Button variant="ghost" onClick={() => setCompleteId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Funding request detail">
        {detail.isLoading ? (
          <Spinner className="h-6 w-6 text-gold-400" />
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-cream-100 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {detail.data.direction === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · {BROKER_LABEL[detail.data.broker]}
                </p>
                <Badge tone={fundingTone(detail.data.status)}>{FUNDING_LABEL[detail.data.status] ?? detail.data.status}</Badge>
              </div>
              <p className="mt-1 text-2xl font-extrabold">
                {detail.data.currency} {detail.data.amount.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {detail.data.user?.name} · {detail.data.user?.email} · {detail.data.reference}
              </p>
            </div>

            <div className="grid gap-2 text-xs">
              <p>
                <span className="text-ink-muted">Destination:</span> {detail.data.destination ?? '—'}
                {detail.data.destinationType ? ` (${detail.data.destinationType.replace('_', ' ')})` : ''}
              </p>
              <p>
                <span className="text-ink-muted">Payment reference:</span> {detail.data.paymentReference ?? '—'}
              </p>
              <p>
                <span className="text-ink-muted">Evidence:</span> {detail.data.evidence ?? '—'}
              </p>
              <p>
                <span className="text-ink-muted">Provider:</span> {detail.data.provider} · mode{' '}
                {detail.data.processingMode === 'manual' ? 'manual' : 'automated'}
                {detail.data.providerRef ? ` · ${detail.data.providerRef}` : ''}
              </p>
              <p>
                <span className="text-ink-muted">Processed at:</span>{' '}
                {detail.data.processedAt ? new Date(detail.data.processedAt).toLocaleString() : '—'}
              </p>
            </div>

            <div>
              <p className="section-title mb-2">Audit trail</p>
              <div className="space-y-1.5">
                {detail.data.audit.map((a) => (
                  <div key={a.id} className="rounded-lg border border-cream-200 px-3 py-2">
                    <p className="text-[11px] font-semibold text-ink">
                      {a.action.replace(/_/g, ' ').toUpperCase()}
                      {a.actorName ? ` · ${a.actorName}` : ''}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      {new Date(a.at).toLocaleString()} · {a.source}
                      {a.provider ? ` · ${a.provider}` : ''}
                    </p>
                    {a.note && <p className="text-[11px] text-ink-muted">{a.note}</p>}
                  </div>
                ))}
              </div>
            </div>

            <Textarea
              label="Internal note (not shown to the customer)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reasoning, reconciliation details…"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => note.trim() && addNote.mutate({ id: detail.data!.id, note: note.trim() })} loading={addNote.isPending}>
                Save note
              </Button>
              {rowActions(detail.data).map((a) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={a.label.startsWith('Reject') || a.label === 'Mark failed' ? 'danger' : 'gold'}
                  onClick={a.run}
                  disabled={act.isPending}
                >
                  {a.icon} {a.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CoursesAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: courseApi.listAll });
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.stats });
  const [form, setForm] = useState<CourseFormState>(emptyCourse);
  const [editing, setEditing] = useState<Course | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-courses'] });
    qc.invalidateQueries({ queryKey: ['courses'] });
  };

  const create = useMutation({
    mutationFn: () => courseApi.create(toCoursePayload(form)),
    onSuccess: () => {
      toast('Course created', 'success');
      setForm(emptyCourse);
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => courseApi.remove(slug),
    onSuccess: () => {
      toast('Course removed', 'info');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const togglePublish = useMutation({
    mutationFn: ({ slug, published }: { slug: string; published: boolean }) => courseApi.update(slug, { published }),
    onSuccess: (_r, v) => {
      toast(v.published ? 'Course published' : 'Course unpublished', 'success');
      invalidate();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const list = courses.data ?? [];
  const freeCount = list.filter((c) => c.price <= 0).length;
  const freeLimit: number = stats.data?.freeCourseLimit ?? 0;
  const atFreeLimit = freeLimit > 0 && freeCount >= freeLimit;
  const creatingFree = atFreeLimit && (Number(form.price) || 0) <= 0;

  return (
    <div className="space-y-4">
      {courses.isLoading ? (
        <Spinner />
      ) : courses.isError ? (
        <Card className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm">Courses could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => courses.refetch()}>Try again</Button>
        </Card>
      ) : list.length === 0 ? (
        <EmptyState title="No courses yet" subtitle="Create a free or paid course below." icon={<GraduationCap className="h-6 w-6" />} />
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <Card key={c.id} className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="text-xs text-ink-muted">
                    /{c.slug} · {c.level} · {c.price <= 0 ? 'Free' : `${c.currency ?? 'USD'} ${c.price.toFixed(2)}`} · {c.lessonCount} lesson
                    {c.lessonCount === 1 ? '' : 's'}
                    {c.isVip ? ' · VIP' : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.published ? <Badge tone="green">Published</Badge> : <Badge tone="grey">Draft</Badge>}
                  {c.saleStatus && c.saleStatus !== 'AVAILABLE' && <Badge tone="red">{c.saleStatus.replace(/_/g, ' ')}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant={c.published ? 'outline' : 'gold'}
                  loading={togglePublish.isPending && togglePublish.variables?.slug === c.slug}
                  disabled={togglePublish.isPending || remove.isPending}
                  onClick={() => togglePublish.mutate({ slug: c.slug, published: !c.published })}
                >
                  {c.published ? 'Unpublish' : 'Publish'}
                </Button>
                <button
                  onClick={() => remove.mutate(c.slug)}
                  disabled={remove.isPending || togglePublish.isPending}
                  className="ml-auto text-ink-faint hover:text-danger"
                  aria-label="Delete course"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-3">
        <h2 className="section-title flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-gold-500" /> Create a course
        </h2>
        {freeLimit > 0 && (
          <p className="text-xs text-ink-muted">
            Free courses:{' '}
            <span className={atFreeLimit ? 'font-bold text-danger' : 'font-semibold text-ink'}>
              {freeCount}/{freeLimit}
            </span>
            {atFreeLimit ? ' — limit reached, set a price above 0.' : ''}
          </p>
        )}
        <CourseFields form={form} setForm={setForm} />
        <Button
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={form.title.trim().length < 3 || creatingFree}
        >
          <Plus className="h-4 w-4" /> Create course
        </Button>
      </Card>

      {editing && <CourseEditor course={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CourseEditor({ course, onClose }: { course: Course; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['admin-course', course.slug], queryFn: () => courseApi.get(course.slug) });
  return (
    <Modal open onClose={onClose} title="Edit course">
      {detail.isLoading ? (
        <Spinner />
      ) : detail.data ? (
        <CourseEditorForm course={detail.data} onClose={onClose} />
      ) : (
        <p className="text-sm text-danger">Could not load this course.</p>
      )}
    </Modal>
  );
}

function CourseEditorForm({ course, onClose }: { course: Course; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<CourseFormState>({
    slug: course.slug,
    title: course.title,
    description: course.description ?? '',
    level: course.level as CourseFormState['level'],
    price: String(course.price),
    currency: course.currency ?? 'USD',
    saleStatus: course.saleStatus ?? 'AVAILABLE',
    isVip: course.isVip,
    coverUrl: course.coverUrl ?? '',
    published: course.published ?? true,
    order: '0',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-course', course.slug] });
    qc.invalidateQueries({ queryKey: ['admin-courses'] });
    qc.invalidateQueries({ queryKey: ['courses'] });
  };

  const save = useMutation({
    mutationFn: () => courseApi.update(course.slug, toCoursePayload(form)),
    onSuccess: () => {
      toast('Course saved', 'success');
      refresh();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const deleteCourse = useMutation({
    mutationFn: () => courseApi.remove(course.slug),
    onSuccess: () => {
      toast('Course removed', 'info');
      refresh();
      onClose();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
      <section className="space-y-3">
        <CourseFields form={form} setForm={setForm} />
        <div className="flex items-center gap-2">
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={form.title.trim().length < 3}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={() => deleteCourse.mutate()} loading={deleteCourse.isPending}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </section>

      <LessonsEditor course={course} onChange={refresh} />
      <ResourcesEditor course={course} onChange={refresh} />
    </div>
  );
}

const emptyLesson = { id: '', title: '', description: '', videoUrl: '', durationMin: '0', order: '0', isFree: true };

function LessonsEditor({ course, onChange }: { course: Course; onChange: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ ...emptyLesson, order: String(course.lessons.length) });

  const payload = () => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    videoUrl: form.videoUrl.trim() || null,
    durationMin: Number(form.durationMin) || 0,
    order: Number(form.order) || 0,
    isFree: form.isFree,
  });

  const reset = () => setForm({ ...emptyLesson, order: String(course.lessons.length) });

  const save = useMutation({
    mutationFn: () =>
      form.id ? courseApi.updateLesson(course.slug, form.id, payload()) : courseApi.addLesson(course.slug, payload()),
    onSuccess: () => {
      toast(form.id ? 'Lesson updated' : 'Lesson added', 'success');
      reset();
      onChange();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => courseApi.removeLesson(course.slug, id),
    onSuccess: () => {
      toast('Lesson removed', 'info');
      onChange();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <section className="space-y-3 border-t border-cream-200 pt-4">
      <h3 className="section-title">Lessons</h3>
      {(course.lessons ?? []).length === 0 && <p className="text-xs text-ink-faint">No lessons yet.</p>}
      <div className="space-y-2">
        {(course.lessons ?? []).map((l: Lesson) => (
          <div key={l.id} className="flex items-center gap-2 rounded-xl bg-cream-100 px-3 py-2">
            <span className="w-6 text-xs text-ink-faint">{l.order}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{l.title}</p>
              <p className="truncate text-xs text-ink-muted">
                {l.durationMin} min · {l.isFree ? 'free preview' : 'paid'}
                {l.videoUrl ? ' · ' : ' · no video'}
                {l.videoUrl && (
                  <a
                    href={l.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-gold-600 hover:underline"
                  >
                    video <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </p>
            </div>
            <button
              onClick={() =>
                setForm({
                  id: l.id,
                  title: l.title,
                  description: l.description ?? '',
                  videoUrl: l.videoUrl ?? '',
                  durationMin: String(l.durationMin),
                  order: String(l.order),
                  isFree: l.isFree,
                })
              }
              className="text-ink-muted hover:text-gold-600"
              aria-label="Edit lesson"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => remove.mutate(l.id)} className="text-ink-faint hover:text-danger" aria-label="Delete lesson">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-cream-200 p-3">
        <p className="text-sm font-semibold">{form.id ? 'Edit lesson' : 'Add a lesson'}</p>
        <Field label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <Field
          label="Video URL (mp4 / YouTube embed / Vimeo)"
          value={form.videoUrl}
          onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))}
        />
        <Textarea label="Notes (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Minutes" type="number" value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} />
          <Field label="Order" type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.isFree} onChange={(e) => setForm((f) => ({ ...f, isFree: e.target.checked }))} /> Free
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={form.title.trim().length < 2}>
            {form.id ? (
              'Update lesson'
            ) : (
              <>
                <Plus className="h-4 w-4" /> Add lesson
              </>
            )}
          </Button>
          {form.id && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

const emptyResource = { title: '', type: 'PDF', url: '', sizeKb: '0', isVip: false };

function ResourcesEditor({ course, onChange }: { course: Course; onChange: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyResource);

  const add = useMutation({
    mutationFn: () =>
      adminApi.createResource({
        courseId: course.id,
        title: form.title.trim(),
        type: form.type,
        url: form.url.trim(),
        sizeKb: Number(form.sizeKb) || 0,
        isVip: form.isVip,
      }),
    onSuccess: () => {
      toast('Resource added', 'success');
      setForm(emptyResource);
      onChange();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteResource(id),
    onSuccess: () => {
      toast('Resource removed', 'info');
      onChange();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <section className="space-y-3 border-t border-cream-200 pt-4">
      <h3 className="section-title">Downloads &amp; resources</h3>
      {(course.resources ?? []).length === 0 && <p className="text-xs text-ink-faint">No resources attached.</p>}
      <div className="space-y-2">
        {(course.resources ?? []).map((r: Resource) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl bg-cream-100 px-3 py-2">
            <Badge tone="gold">{r.type}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.title}</p>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate text-xs text-gold-600 hover:underline"
              >
                {r.url} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
            <button onClick={() => remove.mutate(r.id)} className="text-ink-faint hover:text-danger" aria-label="Delete resource">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-cream-200 p-3">
        <Field label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <Field label="URL (https://…)" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {['PDF', 'EBOOK', 'SHEET'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Field label="Size (KB)" type="number" value={form.sizeKb} onChange={(e) => setForm((f) => ({ ...f, sizeKb: e.target.value }))} />
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => add.mutate()}
            loading={add.isPending}
            disabled={form.title.trim().length < 2 || !form.url.trim().startsWith('http')}
          >
            <Plus className="h-4 w-4" /> Add resource
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isVip} onChange={(e) => setForm((f) => ({ ...f, isVip: e.target.checked }))} /> VIP only
          </label>
        </div>
      </div>
    </section>
  );
}
