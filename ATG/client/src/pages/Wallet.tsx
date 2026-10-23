import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Building2, ChevronRight, Wallet as WalletIcon } from 'lucide-react';
import { walletApi } from '../lib/endpoints';
import { Badge, Button, Card, Chip, Field, Modal, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

const methods = [
  { id: 'BANK_TRANSFER', label: 'Local Bank Transfer', logo: null },
  { id: 'ECOCASH', label: 'EcoCash', logo: '/payments/ecocash.png' },
  { id: 'ONEMONEY', label: 'OneMoney', logo: '/payments/onemoney.jpg' },
  { id: 'INNBUCKS', label: 'InnBucks', logo: '/payments/innbucks.png' },
  { id: 'CASHSMILE', label: 'CashSmile', logo: '/payments/cashsmile.jpg' },
] as const;

const withdrawalMethods = [...methods, { id: 'USDT_TRC20', label: 'USDT (TRC20)', logo: null }] as const;

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

function transactionTone(status: string): 'green' | 'red' | 'gold' | 'grey' {
  if (status === 'COMPLETED') return 'green';
  if (status === 'FAILED') return 'red';
  if (status === 'PENDING' || status === 'PROCESSING') return 'gold';
  return 'grey';
}

export default function Wallet() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const action = params.get('action');
  const [mode, setMode] = useState<'deposit' | 'withdraw'>(action === 'withdraw' ? 'withdraw' : 'deposit');
  const [method, setMethod] = useState('ECOCASH');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [amountError, setAmountError] = useState('');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [confirmedDestination, setConfirmedDestination] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<{ reference: string; status: string } | null>(null);
  const withdrawalKey = useRef('');

  useEffect(() => {
    if (action === 'withdraw' || action === 'deposit') {
      setMode(action);
      setStep(1);
      setWithdrawalResult(null);
      setAmount('');
      setDestination('');
      setConfirmedDestination(false);
      withdrawalKey.current = '';
    }
  }, [action]);

  const wallet = useQuery({ queryKey: ['wallet'], queryFn: walletApi.get });
  const txns = useQuery({ queryKey: ['transactions'], queryFn: walletApi.transactions });
  const withdrawalConfig = useQuery({ queryKey: ['wallet-withdrawal-config'], queryFn: walletApi.withdrawalConfig });

  const deposit = useMutation({
    mutationFn: () => walletApi.deposit({ amount: Number(amount), method }),
    onSuccess: (res) => {
      toast(
        res.transaction?.status === 'COMPLETED'
          ? 'Deposit confirmed ✔'
          : `Deposit submitted — awaiting confirmation. Ref ${res.transaction?.reference}`,
        'success',
      );
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      close();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const withdraw = useMutation({
    mutationFn: () => {
      if (!withdrawalKey.current) withdrawalKey.current = crypto.randomUUID();
      return walletApi.withdraw(
        { amount: Number(amount), method, destination: destination.trim(), idempotencyKey: withdrawalKey.current },
        withdrawalKey.current,
      );
    },
    onSuccess: (res) => {
      setWithdrawalResult({ reference: res.transaction.reference, status: res.transaction.status });
      setStep(4);
      toast(res.duplicate ? 'This withdrawal was already submitted' : 'Withdrawal request submitted', 'success');
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  function close() {
    setAmount('');
    setDestination('');
    setAmountError('');
    setStep(1);
    setWithdrawalResult(null);
    setConfirmedDestination(false);
    withdrawalKey.current = '';
    setParams({}, { replace: true });
  }

  function submit() {
    const value = Number(amount);
    if (mode === 'deposit') {
      if (!value || value <= 0) return setAmountError('Enter a valid amount');
      deposit.mutate();
      return;
    }
    if (!withdrawalConfig.data) return setAmountError('Withdrawal limits are still loading. Try again shortly.');
    if (!value || value <= 0) return setAmountError('Enter a valid amount');
    if (value < withdrawalConfig.data.min || value > withdrawalConfig.data.max) {
      return setAmountError(`Amount must be between ${withdrawalConfig.data.min} and ${withdrawalConfig.data.max}`);
    }
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) return setAmountError('Use no more than two decimal places');
    if (wallet.isLoading) return setAmountError('Your available balance is still loading. Try again shortly.');
    if (wallet.isError || !wallet.data) return setAmountError('Your available balance couldn’t be checked. Reload it before requesting a withdrawal.');
    if (value > (wallet.data?.balance ?? 0)) return setAmountError('Amount exceeds your available balance');
    if (!destination.trim()) return setAmountError('Enter the payout destination details');
    if (!confirmedDestination) return setAmountError('Confirm that the payout destination is correct');
    withdraw.mutate();
  }

  const open = action === 'deposit' || action === 'withdraw';

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold">Wallet</h1>
        <p className="muted">Manage your funds securely.</p>
      </header>

      <Card className="border-cream-300">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-ink-muted">Available Balance</p>
            {wallet.isLoading ? (
              <Spinner className="mt-2 h-6 w-6 text-gold-600" />
            ) : wallet.isError ? (
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm font-semibold text-danger">Balance unavailable</p>
                <Button size="sm" variant="outline" onClick={() => wallet.refetch()}>Retry</Button>
              </div>
            ) : (
              <p className="mt-1 text-3xl font-extrabold">
                ${(wallet.data?.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold-100 bg-gold-50 text-gold-700">
            <WalletIcon className="h-6 w-6" />
          </span>
        </div>
        <div className="mt-4 flex gap-3">
          <Link to="/wallet?action=deposit" className="btn-gold flex-1 py-3 text-sm">
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </Link>
          <Link to="/wallet?action=withdraw" className="btn-outline flex-1 py-3 text-sm">
            <ArrowUpFromLine className="h-4 w-4" /> Withdraw
          </Link>
        </div>
      </Card>

      <h2 className="section-title mb-2 mt-6">Select Payment Method</h2>
      <div className="space-y-2">
        {methods.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMethod(m.id);
              setMode('deposit');
              setParams({ action: 'deposit' }, { replace: false });
            }}
            className={`card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-gold-300 ${method === m.id ? 'border-gold-500 bg-gold-50' : ''}`}
          >
            <MethodLogo logo={m.logo} />
            <span className="flex-1 text-sm font-medium">{m.label}</span>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </button>
        ))}
      </div>

      <h2 className="section-title mb-2 mt-6 flex items-center justify-between">
        Transaction History
        <Link to="/profile/purchases" className="text-xs font-semibold text-gold-600">
          See all
        </Link>
      </h2>

      <div className="space-y-2">
        {txns.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-gold-400" />
          </div>
        ) : txns.isError ? (
          <div className="card flex items-center justify-between gap-3 p-3">
            <p className="text-sm text-ink-muted">Transactions couldn&apos;t be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => txns.refetch()}>Retry</Button>
          </div>
        ) : (txns.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">No transactions yet.</p>
        ) : (
          txns.data!.map((t) => (
            <div key={t.id} className="card flex items-center gap-3 p-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-600">
                {t.type === 'DEPOSIT' ? <ArrowDownToLine className="h-5 w-5" /> : <ArrowUpFromLine className="h-5 w-5" />}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold capitalize">{t.type.toLowerCase()}</p>
                <p className="text-xs text-ink-muted">{t.method ?? '—'} · {t.reference}</p>
                <p className="text-[11px] text-ink-muted">{new Date(t.createdAt).toLocaleString()}</p>
                {t.type === 'WITHDRAWAL' && (
                  <p className="text-[11px] text-ink-faint">
                    Fee {t.currency} {t.fee.toFixed(2)} · payout {t.currency} {(t.netAmount ?? t.amount - t.fee).toFixed(2)}
                  </p>
                )}
                {t.statusHistory?.length ? (
                  <p className="text-[11px] text-ink-faint">
                    Updated {new Date(t.statusHistory[t.statusHistory.length - 1].createdAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${t.type === 'DEPOSIT' ? 'text-success' : 'text-ink'}`}>
                  {t.type === 'DEPOSIT' ? '+' : '-'}${t.amount.toFixed(2)}
                </p>
                <Badge tone={transactionTone(t.status)}>{t.status}</Badge>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="h-4" />

      <Modal open={open} onClose={close} title={mode === 'deposit' ? 'Deposit funds' : 'Withdraw funds'}>
        <div className="space-y-4">
          {mode === 'deposit' ? (
            <>
              <div className="flex gap-2">
                <Chip active>Deposit</Chip>
                <Chip active={false} onClick={() => setMode('withdraw')}>Withdraw</Chip>
              </div>
              <Field
                label="Amount (USD)"
                type="number"
                inputMode="decimal"
                min="1"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError('');
                }}
                error={amountError}
              />
              <div>
                <label className="label">Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {withdrawalMethods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id)}
                      className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${method === m.id ? 'border-gold-500 bg-gold-50 text-gold-800' : 'border-cream-300 bg-white text-ink-soft hover:border-gold-300'}`}
                    >
                      <MethodLogo logo={m.logo} size="sm" />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">
                Deposits are credited only after the funds are received and verified — never automatically.
              </p>
              <Button size="lg" onClick={submit} loading={deposit.isPending}>
                Submit deposit
              </Button>
            </>
          ) : (
            <>
              <ol aria-label="Withdrawal progress" className="grid grid-cols-4 gap-1">
                {(['PAYOUT', 'DETAILS', 'TRANSFER', 'DONE'] as const).map((label, index) => {
                  const active = step >= index + 1;
                  return (
                    <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                      <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${active ? 'bg-gold-700 text-white' : 'border border-cream-300 bg-white text-ink-muted'}`}>
                        {index + 1}
                      </span>
                      <span className={`text-[9px] font-bold tracking-wide sm:text-[10px] ${active ? 'text-gold-800' : 'text-ink-muted'}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>

              {step === 1 && (
                <>
                  <p className="text-sm text-ink-muted">Choose where your payout should be sent.</p>
                  <div className="space-y-2">
                    {methods.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
                        className={`card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-gold-300 ${method === m.id ? 'border-gold-500 bg-gold-50' : ''}`}
                      >
                        <MethodLogo logo={m.logo} />
                        <span className="flex-1 text-sm font-medium">{m.label}</span>
                        {method === m.id && <span className="text-xs font-bold text-gold-700">Selected</span>}
                      </button>
                    ))}
                  </div>
                  <Button size="lg" onClick={() => setStep(2)}>Continue</Button>
                </>
              )}

              {step === 2 && (
                <>
                  <Field
                    label="Amount (USD)"
                    type="number"
                    inputMode="decimal"
                    min={withdrawalConfig.data?.min ?? 1}
                    max={withdrawalConfig.data?.max}
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountError('');
                    }}
                    error={amountError}
                    hint={withdrawalConfig.data
                        ? wallet.isError || !wallet.data
                          ? `Minimum ${withdrawalConfig.data.min} · Maximum ${withdrawalConfig.data.max} · Available balance couldn’t be checked`
                          : `Minimum ${withdrawalConfig.data.min} · Maximum ${withdrawalConfig.data.max} · Available ${wallet.data.currency} ${wallet.data.balance.toFixed(2)}`
                        : 'Loading withdrawal limits…'}
                    />
                    {wallet.isError && (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
                        <span>Available balance couldn&apos;t be loaded.</span>
                        <Button size="sm" variant="outline" onClick={() => wallet.refetch()}>Retry</Button>
                      </div>
                    )}
                  <Field
                    label={
                      method === 'USDT_TRC20'
                        ? 'TRON wallet address (TRC20)'
                        : method === 'BANK_TRANSFER'
                        ? 'Bank name, account name and account number'
                        : method === 'INNBUCKS'
                          ? 'InnBucks mobile number or account'
                          : 'Registered mobile number'
                    }
                    placeholder={
                      method === 'USDT_TRC20'
                        ? 'Enter a TRON address starting with T'
                        : method === 'BANK_TRANSFER'
                          ? 'Enter bank and account details'
                          : 'Enter the payout number'
                    }
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      setAmountError('');
                    }}
                    error={amountError && amountError.includes('destination') ? amountError : undefined}
                  />
                  {withdrawalConfig.data && Number(amount) > 0 && (
                    <div className="rounded-xl bg-cream-100 p-3 text-sm">
                      <div className="flex justify-between"><span>Request amount</span><span>{wallet.data?.currency ?? 'USD'} {Number(amount).toFixed(2)}</span></div>
                      <div className="mt-1 flex justify-between text-ink-muted"><span>Fee ({withdrawalConfig.data.feePct}%)</span><span>{wallet.data?.currency ?? 'USD'} {(Math.round(Number(amount) * withdrawalConfig.data.feePct) / 100).toFixed(2)}</span></div>
                      <div className="mt-2 flex justify-between border-t border-cream-300 pt-2 font-bold"><span>Estimated payout</span><span>{wallet.data?.currency ?? 'USD'} {(Number(amount) - Math.round(Number(amount) * withdrawalConfig.data.feePct) / 100).toFixed(2)}</span></div>
                    </div>
                  )}
                  <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">
                    {method === 'USDT_TRC20'
                      ? 'Network is TRON (TRC20) only. A submitted request is manually reviewed; the administrator records the on-chain transaction hash only after verifying the payout.'
                      : 'The request is validated and the amount is held by the server when submitted. Limits and fees are calculated by the server.'}
                  </p>
                  {amountError && <p className="text-xs text-danger">{amountError}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setStep(1); setAmountError(''); }}>Back</Button>
                    <Button
                      size="lg"
                      className="flex-1"
                      disabled={
                        !withdrawalConfig.data ||
                        wallet.isLoading ||
                        wallet.isError ||
                        !wallet.data ||
                        !amount ||
                        Number(amount) < withdrawalConfig.data.min ||
                        Number(amount) > withdrawalConfig.data.max ||
                        Number(amount) > (wallet.data?.balance ?? 0) ||
                        !destination.trim()
                      }
                      onClick={() => {
                        const value = Number(amount);
                        if (!Number.isFinite(value) || value <= 0) return setAmountError('Enter a valid amount');
                        if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) return setAmountError('Use no more than two decimal places');
                        if (value < (withdrawalConfig.data?.min ?? 0) || value > (withdrawalConfig.data?.max ?? 0)) {
                          return setAmountError('Amount is outside the configured withdrawal limits');
                        }
                        if (!wallet.data) return setAmountError('Your available balance couldn’t be checked. Reload it before continuing.');
                        if (value > wallet.data.balance) return setAmountError('Amount exceeds your available balance');
                        if (!destination.trim()) return setAmountError('Enter the payout destination details');
                        if (method === 'USDT_TRC20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination.trim())) {
                          return setAmountError('Enter a valid TRON wallet address for USDT (TRC20)');
                        }
                        setConfirmedDestination(false);
                        setAmountError('');
                        setStep(3);
                      }}
                    >
                      Continue
                    </Button>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="rounded-2xl bg-cream-100 p-4">
                    <p className="text-sm font-bold">Review payout request</p>
                    <p className="mt-2 text-xs text-ink-muted">{withdrawalMethods.find((m) => m.id === method)?.label}</p>
                    <p className="mt-1 break-words text-xs text-ink-muted">Destination: {destination}</p>
                    <div className="mt-3 border-t border-cream-300 pt-3 text-sm">
                      <p className="flex justify-between"><span>Request</span><span>{wallet.data?.currency ?? 'USD'} {Number(amount).toFixed(2)}</span></p>
                      <p className="mt-1 flex justify-between"><span>Fee</span><span>{wallet.data?.currency ?? 'USD'} {(Math.round(Number(amount) * (withdrawalConfig.data?.feePct ?? 0)) / 100).toFixed(2)}</span></p>
                      <p className="mt-2 flex justify-between font-bold"><span>Payout after fee</span><span>{wallet.data?.currency ?? 'USD'} {(Number(amount) - Math.round(Number(amount) * (withdrawalConfig.data?.feePct ?? 0)) / 100).toFixed(2)}</span></p>
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={confirmedDestination}
                      onChange={(e) => {
                        setConfirmedDestination(e.target.checked);
                        setAmountError('');
                      }}
                      className="mt-0.5 accent-gold-500"
                    />
                    I confirm that the payout method and destination details are correct.
                  </label>
                  <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-ink-muted">
                    This submits a request for manual review. It does not send money or mark a payout as completed. The wallet amount will be held until the request is paid or rejected.
                  </p>
                  {amountError && <p className="text-xs text-danger">{amountError}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setStep(2); setAmountError(''); }}>Back</Button>
                    <Button size="lg" className="flex-1" onClick={submit} loading={withdraw.isPending} disabled={!confirmedDestination}>
                      Submit withdrawal
                    </Button>
                  </div>
                </>
              )}

              {step === 4 && withdrawalResult && (
                <>
                  <div className="rounded-2xl bg-cream-100 p-4 text-center">
                    <p className="text-xs text-ink-muted">Request reference</p>
                    <p className="mt-1 text-lg font-extrabold gold-text">{withdrawalResult.reference}</p>
                    <p className="mt-2 text-sm font-semibold">{withdrawalResult.status === 'COMPLETED' ? 'Paid' : 'Submitted — pending review'}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {wallet.data?.currency ?? 'USD'} {(Number(amount) - Math.round(Number(amount) * (withdrawalConfig.data?.feePct ?? 0)) / 100).toFixed(2)} estimated payout via {withdrawalMethods.find((m) => m.id === method)?.label}
                    </p>
                  </div>
                  <p className="text-xs text-ink-muted">You can track this request in Transaction History. A submitted request is not the same as a completed payout.</p>
                  <Button size="lg" onClick={close}>Done</Button>
                </>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
