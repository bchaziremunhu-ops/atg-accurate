import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ExternalLink, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { weltradeAccountApi } from '../lib/endpoints';
import { apiError } from '../lib/api';
import { useToast } from './Toast';
import type { BrokerAccountStatus } from '../lib/types';
import clsx from 'clsx';


const STEPS = [
  'Open a Weltrade account using the official registration link below.',
  'Return to ATG Traders and enter the Weltrade Client ID you were issued.',
  'Fund the account using a supported payment method.',
] as const;

const STATUS_META: Record<BrokerAccountStatus, { label: string; tone: 'gold' | 'green' | 'red' }> = {
  PENDING: { label: 'Pending verification', tone: 'gold' },
  VERIFIED: { label: 'Verified', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};

const STATUS_TONE: Record<BrokerAccountStatus, string> = {
  PENDING: 'bg-gold-400/15 text-gold-200 ring-1 ring-gold-300/40',
  VERIFIED: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/40',
  REJECTED: 'bg-red-400/15 text-red-300 ring-1 ring-red-300/40',
};

export default function WeltradeAccountCard({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const config = useQuery({ queryKey: ['weltrade-account'], queryFn: weltradeAccountApi.get });

  const [clientId, setClientId] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const account = config.data?.account ?? null;
  const registerUrl = config.data?.registerUrl ?? null;
  const status = account?.status ?? null;

  const submit = useMutation({
    mutationFn: (value: string) => weltradeAccountApi.submit(value),
    onSuccess: (res) => {
      setClientId('');
      setFieldError(null);
      toast(res.message, 'success');
      qc.invalidateQueries({ queryKey: ['weltrade-account'] });
      qc.invalidateQueries({ queryKey: ['admin-weltrade-accounts'] });
    },
    onError: (e) => {
      const msg = apiError(e);
      setFieldError(msg);
      toast(msg, 'error');
    },
  });

  function validate(value: string): string | null {
    const v = value.trim();
    if (!v) return 'Enter your Weltrade Client ID.';
    if (v.length < 3) return 'Client ID must be at least 3 characters.';
    if (v.length > 64) return 'Client ID must be at most 64 characters.';
    if (!/^[A-Za-z0-9._-]+$/.test(v)) return 'Only letters, numbers, dots, dashes and underscores are allowed.';
    return null;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validate(clientId);
    setFieldError(error);
    if (error) return;
    submit.mutate(clientId.trim());
  }

  function openRegistration() {
    if (!registerUrl) {
      toast('The registration link has not been configured yet — please ask an administrator.', 'error');
      return;
    }
    window.open(registerUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <section
      className={clsx(
        'min-w-0 overflow-hidden rounded-3xl border border-white/10 shadow-[0_20px_45px_-22px_rgba(20,14,60,0.9)]',
        'bg-[linear-gradient(155deg,#171236_0%,#241B54_58%,#31215F_100%)]',
        'text-white',
        className,
      )}
    >
      <div className="p-4 sm:p-6">
        {/* Branding */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-300/80">Powered by</p>
            <p className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight text-white">
              <ShieldCheck className="h-5 w-5 shrink-0 text-gold-300" />
              <span className="truncate">Weltrade</span>
            </p>
          </div>
          {status && (
            <span
              className={clsx(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
                STATUS_TONE[status],
              )}
            >
              {status === 'VERIFIED' && <BadgeCheck className="h-3.5 w-3.5" />}
              {status === 'REJECTED' && <XCircle className="h-3.5 w-3.5" />}
              {STATUS_META[status].label}
            </span>
          )}
        </div>

        {/* Instructions */}
        <ol className="mt-4 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-gradient text-[11px] font-bold text-ink shadow-gold">
                {i + 1}
              </span>
              <span className="min-w-0 text-sm leading-relaxed text-white/85 break-words">{step}</span>
            </li>
          ))}
        </ol>

        {/* Primary call to action */}
        {registerUrl ? (
          <a
            href={registerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-gold mt-5 w-full py-3.5 text-center text-sm sm:text-base"
          >
            Create a Weltrade Account
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <button
            type="button"
            onClick={openRegistration}
            className="btn-gold mt-5 w-full py-3.5 text-center text-sm sm:text-base"
          >
            Create a Weltrade Account
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
        {!registerUrl && config.isSuccess && (
          <p className="mt-2 text-[11px] leading-relaxed text-gold-200/70">
            The registration link is not configured yet — an administrator needs to set it before this button opens
            Weltrade.
          </p>
        )}

        {/* Client ID submission */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-3 sm:p-4">
          {config.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your account status…
            </div>
          ) : account && status === 'VERIFIED' ? (
            <div className="min-w-0 space-y-1.5">
              <p className="label text-white/60">Your Weltrade Client ID</p>
              <p className="break-all rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white">
                {account.clientId}
              </p>
              <p className="text-xs leading-relaxed text-white/65">
                Verified on {new Date(account.reviewedAt ?? account.updatedAt).toLocaleDateString()}. Deposits and
                withdrawals for this account are handled under Broker Funds.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="min-w-0 space-y-3">
              <div>
                <label className="label !text-white/60" htmlFor="weltrade-client-id">
                  Weltrade Client ID
                </label>
                <input
                  id="weltrade-client-id"
                  className={clsx('input !border-white/20 !bg-white/10 !text-white placeholder:!text-white/40', fieldError && '!border-red-400/70')}
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  placeholder={account?.clientId ?? 'e.g. 1234567'}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  aria-invalid={Boolean(fieldError)}
                />
                {fieldError && <p className="mt-1 text-xs text-red-300">{fieldError}</p>}
              </div>
              <button
                type="submit"
                disabled={submit.isPending}
                className="btn w-full border border-gold-300/50 bg-white/10 py-3 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
              >
                {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'PENDING' || status === 'REJECTED' ? 'Update Client ID' : 'Submit Client ID'}
              </button>
              <p className="text-[11px] leading-relaxed text-white/55">
                Your submission is reviewed by an administrator — it is not verified automatically.
              </p>
            </form>
          )}

          {account && status === 'REJECTED' && account.rejectReason && (
            <p className="mt-3 rounded-xl bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200">
              Rejected: {account.rejectReason}
            </p>
          )}
          {account && status === 'PENDING' && (
            <p className="mt-3 text-xs leading-relaxed text-white/60">
              Submitted {new Date(account.submittedAt).toLocaleString()} — awaiting review.
            </p>
          )}
        </div>

        <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/55">
          Your trading account is held with Weltrade, not ATG Traders. ATG Traders is not a broker, holds no broker
          funds and executes no trades. Review Weltrade&apos;s own terms, risk disclosure and privacy policy before you
          fund an account.
        </p>
      </div>
    </section>
  );
}
