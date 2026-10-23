import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  ChevronRight,
  Clock,
  Info,
  Landmark,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { brokerApi } from '../lib/endpoints';
import { apiError } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Chip, EmptyState, Field, Modal, Select, Spinner } from '../components/ui';
import type { BrokerId } from '../lib/types';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

function statusTone(status: string): 'green' | 'red' | 'gold' | 'grey' {
  if (status === 'COMPLETED') return 'green';
  if (status === 'REJECTED' || status === 'FAILED') return 'red';
  if (status === 'APPROVED' || status === 'PROCESSING') return 'gold';
  return 'grey';
}

const DESTINATION_TYPES = [
  { id: 'MOBILE_WALLET', label: 'Mobile wallet' },
  { id: 'BANK_ACCOUNT', label: 'Bank account' },
  { id: 'BROKER_ACCOUNT', label: 'Broker account' },
  { id: 'CRYPTO_WALLET', label: 'USDT wallet (TRC20)' },
] as const;

function MethodLogo({ logo, size = 'md' }: { logo: string | null; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  if (!logo) {
    return (
      <span className={`grid ${box} place-items-center rounded-xl bg-cream-100 text-gold-600`}>
        <Building2 className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-xl border border-cream-200 bg-white`}>
      <img src={logo} alt="" className="max-h-[70%] max-w-[70%] object-contain" loading="lazy" />
    </span>
  );
}

type Mode = 'deposit' | 'withdraw';

export default function BrokerFunds() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [broker, setBroker] = useState<BrokerId>('DERIV');
  const [direction, setDirection] = useState<'ALL' | 'DEPOSIT' | 'WITHDRAWAL'>('ALL');
  const [mode, setMode] = useState<Mode>('deposit');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ reference: string; status: string; instructions?: string | null } | null>(null);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ECOCASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationType, setDestinationType] = useState<'MOBILE_WALLET' | 'BANK_ACCOUNT' | 'BROKER_ACCOUNT' | 'CRYPTO_WALLET'>('MOBILE_WALLET');
  const [error, setError] = useState('');

  // One idempotency key per opened form — a double tap can never create two
  // funding requests.
  const idemKey = useRef('');

  const config = useQuery({ queryKey: ['broker-config'], queryFn: brokerApi.config });
  const balances = useQuery({ queryKey: ['broker-balances'], queryFn: brokerApi.balances });
  const funds = useQuery({
    queryKey: ['broker-funds', broker, direction],
    queryFn: () => brokerApi.transactions({ broker, direction: direction === 'ALL' ? undefined : direction }),
  });
  const detail = useQuery({
    queryKey: ['broker-fund', selected],
    queryFn: () => brokerApi.transaction(selected!),
    enabled: Boolean(selected),
  });

  const limits = config.data?.limits;
  const brokerBalance = balances.data?.balances.find((b) => b.broker === broker);

  const submit = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      const key = idemKey.current;
      if (mode === 'deposit') {
        return brokerApi.deposit({ broker, amount: value, method, paymentReference: paymentReference.trim() }, key);
      }
      return brokerApi.withdraw(
        {
          broker,
          amount: value,
          method,
          destination: destination.trim(),
          destinationType,
          paymentReference: paymentReference.trim() || undefined,
        },
        key,
      );
    },
    onSuccess: (res) => {
      setSubmitted({
        reference: res.transaction.reference,
        status: res.transaction.status,
        instructions: res.instructions ?? null,
      });
      toast(res.duplicate ? 'This request was already submitted' : 'Funding request submitted', 'success');
      qc.invalidateQueries({ queryKey: ['broker-funds'] });
      qc.invalidateQueries({ queryKey: ['broker-balances'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  useEffect(() => {
    if (!open) return;
    idemKey.current = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, [open]);

  function openForm(next: Mode) {
    setMode(next);
    setSubmitted(null);
    setAmount('');
    setPaymentReference('');
    setDestination('');
    setError('');
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setSubmitted(null);
    setError('');
  }

  function validate(): boolean {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount');
      return false;
    }
    if (mode === 'deposit' && limits) {
      if (value < limits.deposit.min || value > limits.deposit.max) {
        setError(`Amount must be between ${limits.deposit.min} and ${limits.deposit.max} ${limits.currency}`);
        return false;
      }
      if (paymentReference.trim().length < 3) {
        setError('Enter the payment reference (broker account or sender wallet)');
        return false;
      }
      if (method === 'USDT_TRC20' && !/^[a-fA-F0-9]{64}$/.test(paymentReference.trim())) {
        setError('Enter the 64-character USDT TRC20 transaction hash');
        return false;
      }
    }
    if (mode === 'withdraw' && limits) {
      if (value < limits.withdrawal.min || value > limits.withdrawal.max) {
        setError(`Amount must be between ${limits.withdrawal.min} and ${limits.withdrawal.max} ${limits.currency}`);
        return false;
      }
      if (destination.trim().length < 4) {
        setError('Enter the destination account details');
        return false;
      }
      if (paymentReference.trim().length < 3) {
        setError(`Enter your ${broker === 'DERIV' ? 'Deriv account ID' : 'Weltrade client ID'}`);
        return false;
      }
      if (method === 'USDT_TRC20' && destinationType !== 'CRYPTO_WALLET') {
        setError('Choose a USDT wallet destination on TRC20');
        return false;
      }
      if (method === 'USDT_TRC20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination.trim())) {
        setError('Enter a valid TRON wallet address for USDT (TRC20)');
        return false;
      }
      if (method !== 'USDT_TRC20' && destinationType === 'CRYPTO_WALLET') {
        setError('USDT wallet destinations require the USDT (TRC20) method');
        return false;
      }
    }
    return true;
  }

  const rows = useMemo(() => funds.data ?? [], [funds.data]);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold">Broker Funds</h1>
        <p className="muted">Deposits and withdrawals for your Deriv &amp; Weltrade accounts.</p>
      </header>

      <Card className="mb-4 flex items-start justify-between gap-3 border-gold-100 bg-gold-50">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
        <p className="flex-1 text-xs text-ink-muted">
          {config.isLoading ? 'Loading broker funding information…' : config.isError ? 'Broker funding settings couldn’t be loaded.' : config.data?.notice}
        </p>
        {config.isError && <Button size="sm" variant="outline" onClick={() => config.refetch()}>Retry</Button>}
      </Card>

      {/* Broker selector — Deriv and Weltrade records are always separate. */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {(config.data?.brokers ?? [{ id: 'DERIV', label: 'Deriv' }, { id: 'WELTRADE', label: 'Weltrade' }]).map((b) => (
          <Chip key={b.id} active={broker === b.id} onClick={() => setBroker(b.id)}>
            {b.label}
          </Chip>
        ))}
      </div>

      <Card className="border-cream-300">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-ink-muted">{broker === 'DERIV' ? 'Deriv' : 'Weltrade'} balance</p>
            {brokerBalance?.available ? (
              <p className="mt-1 text-3xl font-extrabold">
                {brokerBalance.currency}{' '}
                {(brokerBalance.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            ) : (
              <p className="mt-1 text-lg font-semibold text-ink-muted">Not available</p>
            )}
            <p className="mt-1 text-[11px] text-ink-faint">
              {brokerBalance?.available
                ? `Verified ${new Date(brokerBalance.verifiedAt!).toLocaleString()} · ${brokerBalance.source?.replace('_', ' ')}`
                : 'Shown only after the balance has been verified against the broker.'}
            </p>
          </div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold-100 bg-gold-50 text-gold-700">
            <Landmark className="h-6 w-6" />
          </span>
        </div>
        <div className="mt-4 flex gap-3">
          <button className="btn-gold flex-1 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50" onClick={() => openForm('deposit')} disabled={config.isLoading || config.isError}>
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </button>
          <button className="btn-outline flex-1 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50" onClick={() => openForm('withdraw')} disabled={config.isLoading || config.isError}>
            <ArrowUpFromLine className="h-4 w-4" /> Withdraw
          </button>
        </div>
      </Card>

      {config.data?.manualProcessing && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-cream-200 bg-white p-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
          <p className="text-xs text-ink-muted">
            Manual processing: requests are reviewed and confirmed by an administrator. Nothing is marked completed
            without verified evidence from the payment provider.
          </p>
        </div>
      )}

      <div className="no-scrollbar -mx-4 mb-3 mt-6 flex gap-2 overflow-x-auto px-4">
        {(['ALL', 'DEPOSIT', 'WITHDRAWAL'] as const).map((d) => (
          <Chip key={d} active={direction === d} onClick={() => setDirection(d)}>
            {d === 'ALL' ? 'All activity' : d === 'DEPOSIT' ? 'Deposits' : 'Withdrawals'}
          </Chip>
        ))}
      </div>

      <div className="space-y-2">
        {funds.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-gold-400" />
          </div>
        ) : funds.isError ? (
          <div className="card flex items-center justify-between gap-3 p-3">
            <p className="text-sm text-ink-muted">Broker funding history couldn&apos;t be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => funds.refetch()}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No broker funding requests yet"
            subtitle="Submit a deposit or withdrawal and it will appear here with its status."
            icon={<WalletIcon className="h-8 w-8" />}
          />
        ) : (
          rows.map((t) => (
            <button key={t.id} className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-gold-300 hover:shadow-card" onClick={() => setSelected(t.id)}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream-100 text-gold-600">
                {t.direction === 'DEPOSIT' ? <ArrowDownToLine className="h-5 w-5" /> : <ArrowUpFromLine className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {t.direction === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · {t.brokerLabel}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {t.methodLabel} · {t.reference}
                </p>
                <p className="text-[11px] text-ink-faint">{new Date(t.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className={`text-sm font-bold ${t.direction === 'DEPOSIT' ? 'text-success' : 'text-ink'}`}>
                  {t.direction === 'DEPOSIT' ? '+' : '-'}
                  {t.currency} {t.amount.toFixed(2)}
                </p>
                {t.direction === 'DEPOSIT' && t.feeAmount > 0 && (
                  <p className="text-[10px] text-ink-faint">
                    {t.feePct}% fee: {t.currency} {t.feeAmount.toFixed(2)}
                  </p>
                )}
                <Badge tone={statusTone(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                <ChevronRight className="h-4 w-4 text-ink-faint" />
              </div>
            </button>
          ))
        )}
      </div>
      <div className="h-4" />

      {/* ---- Request form ---- */}
      <Modal open={open} onClose={close} title={mode === 'deposit' ? 'Deposit to broker account' : 'Withdraw from broker account'}>
        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-cream-200 bg-cream-100 p-4 text-center">
              <p className="text-xs text-ink-muted">Your reference</p>
              <p className="text-lg font-extrabold gold-text">{submitted.reference}</p>
              <div className="mt-2 flex justify-center">
                <Badge tone={statusTone(submitted.status)}>{STATUS_LABEL[submitted.status] ?? submitted.status}</Badge>
              </div>
            </div>
            {submitted.instructions && <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">{submitted.instructions}</p>}
            <p className="text-xs text-ink-faint">
              Keep this reference. You will be notified as soon as the request is reviewed or completed.
            </p>
            <Button size="lg" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Chip active={mode === 'deposit'} onClick={() => setMode('deposit')}>
                Deposit
              </Chip>
              <Chip active={mode === 'withdraw'} onClick={() => setMode('withdraw')}>
                Withdraw
              </Chip>
            </div>

            <Field
              label={`Amount (${limits?.currency ?? 'USD'})`}
              type="number"
              inputMode="decimal"
              min="1"
              placeholder={mode === 'deposit' ? 'e.g. 50' : 'e.g. 100'}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              error={error && error.startsWith('Amount') ? error : undefined}
              hint={
                limits
                  ? mode === 'deposit'
                    ? limits.feePct > 0
                      ? `${limits.deposit.min} to ${limits.deposit.max}, before the ${limits.feePct}% admin fee`
                      : `Min ${limits.deposit.min} · Max ${limits.deposit.max}`
                    : `Min ${limits.withdrawal.min} · Max ${limits.withdrawal.max} · ${limits.withdrawal.dailyMax} per day`
                  : undefined
              }
            />

            <div>
              <label className="label">Payment method</label>
              <div className="grid grid-cols-2 gap-2">
                {(config.data?.methods ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMethod(m.id);
                      if (m.id === 'USDT_TRC20') setDestinationType('CRYPTO_WALLET');
                      else if (destinationType === 'CRYPTO_WALLET') setDestinationType('MOBILE_WALLET');
                      setError('');
                    }}
                    className={clsx(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium',
                      method === m.id ? 'border-gold-500 bg-gold-50 text-gold-800' : 'border-cream-300 bg-white text-ink-soft hover:border-gold-300',
                    )}
                  >
                    <MethodLogo logo={m.logo} size="sm" />
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'deposit' ? (
              <Field
                label={method === 'USDT_TRC20' ? 'USDT TRC20 transaction hash' : 'Payment reference'}
                placeholder={method === 'USDT_TRC20' ? '64-character transaction hash' : 'Broker account ID or sender wallet'}
                value={paymentReference}
                onChange={(e) => {
                  setPaymentReference(e.target.value);
                  setError('');
                }}
                error={error && (error.startsWith('Payment') || error.startsWith('Enter the 64-character')) ? error : undefined}
                hint={method === 'USDT_TRC20' ? 'The hash is stored for administrator review; funds are credited only after the transfer is verified on-chain.' : 'The account/wallet used for the payment — required to match your transfer.'}
              />
            ) : (
              <>
                <Select
                  label="Destination type"
                  value={destinationType}
                  onChange={(e) => setDestinationType(e.target.value as typeof destinationType)}
                >
                  {DESTINATION_TYPES.filter((d) => method === 'USDT_TRC20' ? d.id === 'CRYPTO_WALLET' : d.id !== 'CRYPTO_WALLET').map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
                <Field
                  label={destinationType === 'CRYPTO_WALLET' ? 'USDT destination address (TRC20)' : destinationType === 'MOBILE_WALLET' ? 'Mobile money number' : destinationType === 'BANK_ACCOUNT' ? 'Bank account details' : 'Receiving broker account details'}
                  placeholder={destinationType === 'CRYPTO_WALLET' ? 'Enter a TRON address starting with T' : destinationType === 'MOBILE_WALLET' ? 'Enter the registered mobile number' : 'Account name and account reference'}
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setError('');
                  }}
                  error={error && (error.startsWith('Destination') || error.includes('TRON wallet')) ? error : undefined}
                  hint="Only your own verified destination is accepted. It is masked in listings."
                />
                <Field
                  label={broker === 'DERIV' ? 'Deriv account ID' : 'Weltrade client ID'}
                  placeholder={broker === 'DERIV' ? 'Enter your Deriv account ID' : 'Enter your Weltrade client ID'}
                  value={paymentReference}
                  onChange={(e) => {
                    setPaymentReference(e.target.value);
                    setError('');
                  }}
                  error={error.includes('account ID') || error.includes('client ID') ? error : undefined}
                  hint="Required so the administrator can verify the broker account. It is not used as proof of payout."
                />
              </>
            )}

            <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">
              {mode === 'deposit'
                ? 'Deposits are credited only after the funds are received and verified — never automatically.'
                : 'Withdrawals require administrator review before they are processed. Funds are never moved without evidence.'}
            </p>

            <Button
              size="lg"
              onClick={() => {
                if (!validate()) return;
                submit.mutate();
              }}
              loading={submit.isPending}
              disabled={config.isLoading || config.isError || !limits}
            >
              {mode === 'deposit' ? 'Submit deposit' : 'Request withdrawal'}
            </Button>
          </div>
        )}
      </Modal>

      {/* ---- Detail / status timeline ---- */}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Funding request">
        {detail.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-gold-400" />
          </div>
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-cream-200 bg-cream-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  {detail.data.direction === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · {detail.data.brokerLabel}
                </p>
                <Badge tone={statusTone(detail.data.status)}>{STATUS_LABEL[detail.data.status] ?? detail.data.status}</Badge>
              </div>
              <p className="mt-1 text-2xl font-extrabold">
                {detail.data.currency} {detail.data.amount.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {detail.data.reference} · {detail.data.methodLabel} · {detail.data.processingMode === 'manual' ? 'Manual processing' : 'Automated'}
              </p>
              {detail.data.providerRef && <p className="text-[11px] text-ink-faint">Provider ref: {detail.data.providerRef}</p>}
              {detail.data.destination && <p className="text-[11px] text-ink-faint">Destination: {detail.data.destination}</p>}
              {detail.data.paymentReference && <p className="text-[11px] text-ink-faint">Payment ref: {detail.data.paymentReference}</p>}
            </div>

            {detail.data.adminNote && <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-ink-muted">{detail.data.adminNote}</p>}
            {detail.data.failureReason && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-danger">{detail.data.failureReason}</p>
            )}

            <div>
              <p className="section-title mb-2 text-sm">Status history</p>
              <div className="space-y-2">
                {detail.data.timeline.map((e) => (
                  <div key={e.id} className="flex items-start gap-3">
                    <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cream-100 text-gold-600">
                      <Clock className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">
                        {STATUS_LABEL[e.toStatus ?? ''] ?? e.action.replace(/_/g, ' ').toLowerCase()}
                        {e.fromStatus ? ` · from ${STATUS_LABEL[e.fromStatus] ?? e.fromStatus.toLowerCase()}` : ''}
                      </p>
                      <p className="text-[11px] text-ink-faint">
                        {e.source === 'PROVIDER' ? 'Payment provider' : e.source === 'ADMIN' ? 'Administrator' : e.source === 'CUSTOMER' ? 'You' : 'System'} ·{' '}
                        {new Date(e.at).toLocaleString()}
                      </p>
                      {e.note && <p className="text-[11px] text-ink-muted">{e.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button variant="outline" size="lg" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
