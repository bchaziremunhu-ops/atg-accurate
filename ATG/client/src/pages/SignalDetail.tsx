import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Star } from 'lucide-react';
import { signalApi, userApi } from '../lib/endpoints';
import { CandleChart } from '../components/Charts';
import { Badge, Button, Card, Chip, Spinner } from '../components/ui';
import { formatPrice } from '../lib/format';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

const frames = ['1m', '5m', '15m', '30m', '1H', '4H'];

const ROOM_LABEL: Record<string, string> = {
  FREE: 'Free signals',
  PAID: 'Paid members',
  VIP_DERIV: 'Deriv VIP',
  VIP_WELTRADE: 'Weltrade VIP',
};

const STATUS_META: Record<string, { label: string; tone: 'green' | 'red' | 'grey' | 'gold' }> = {
  OPEN: { label: 'OPEN', tone: 'gold' },
  HIT_TP: { label: 'TARGET HIT', tone: 'green' },
  HIT_SL: { label: 'STOP LOSS HIT', tone: 'red' },
  CANCELLED: { label: 'CANCELLED', tone: 'grey' },
};

export default function SignalDetail() {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [frame, setFrame] = useState<string | null>(null);

  const signal = useQuery({
    queryKey: ['signal', id],
    queryFn: () => signalApi.get(id),
    retry: (failureCount, error) =>
      !(isAxiosError(error) && error.response?.status === 402) && failureCount < 1,
  });
  const watchlist = useQuery({ queryKey: ['watchlist'], queryFn: userApi.watchlist });
  const isStarred =
    watchlist.data?.some((item: { pair: string }) => item.pair === signal.data?.pair) ?? false;
  const activeFrame = frame ?? signal.data?.timeframe ?? '15m';
  const chart = useQuery({
    queryKey: ['signal', id, 'chart', activeFrame],
    queryFn: () => signalApi.chart(id, activeFrame),
    enabled: !!id && signal.isSuccess,
  });

  const watch = useMutation({
    mutationFn: (pair: string) =>
      isStarred ? userApi.removeWatch(pair) : userApi.addWatch(pair),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      toast(isStarred ? 'Removed from favourites' : 'Added to favourites', 'success');
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  if (signal.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-gold-400" />
      </div>
    );
  }
  if (signal.isError || !signal.data) {
    const accessDenied = isAxiosError(signal.error) && signal.error.response?.status === 402;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-semibold">{accessDenied ? 'This signal is for a members-only room.' : 'This signal couldn’t be loaded.'}</p>
        <p className="text-sm text-ink-muted">
          {accessDenied ? 'Buy a membership that includes this VIP room. Your signal access starts after your payment is approved.' : 'It may have been removed or your connection may have dropped.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => signal.refetch()}>Try again</Button>
          {accessDenied && <Link to="/profile/subscription" className="btn-gold px-4 py-2">View VIP plans &amp; prices</Link>}
          <Link to="/signals" className="btn-outline px-4 py-2">Back to signals</Link>
        </div>
      </div>
    );
  }

  const s = signal.data;
  const starred = isStarred;
  const data = chart.data;
  const live = Boolean(data?.configured && data.candles.length);
  const candles = data?.candles ?? [];
  const last = candles.length ? candles[candles.length - 1] : undefined;
  const change = last && last.open ? ((last.close - last.open) / last.open) * 100 : 0;
  const positive = change >= 0;
  const status = STATUS_META[s.status] ?? { label: s.status, tone: 'grey' as const };

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-3 flex items-center justify-between">
        <Link to="/signals" className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <ArrowLeft className="h-4 w-4" /> Signals
        </Link>
        <button
          className="rounded-xl border border-cream-200 bg-white p-2 transition-colors hover:bg-gold-50"
          onClick={() => watch.mutate(s.pair)}
          aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
          disabled={watch.isPending || watchlist.isLoading || watchlist.isError}
          title={watchlist.isError ? 'Favourites could not be loaded' : undefined}
        >
          <Star className={starred ? 'h-5 w-5 fill-gold-500 text-gold-500' : 'h-5 w-5 text-ink-faint'} />
        </button>
      </header>

      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{s.pair}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[10px] font-semibold text-ink-soft">
              {ROOM_LABEL[s.audience] ?? 'Signals'}
            </span>
            <span className="text-[10px] font-medium text-ink-faint">{s.timeframe} · {s.market}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={s.direction === 'BUY' ? 'green' : 'red'}>{s.direction}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      <Card className="mb-3 border-cream-300 p-4">
        {live && last ? (
          <>
            <p className="text-3xl font-extrabold tracking-tight">{formatPrice(last.close)}</p>
            <p className={`text-sm font-semibold ${positive ? 'text-success' : 'text-danger'}`}>
              {positive ? '+' : ''}
              {(last.close - last.open).toFixed(2)} ({change.toFixed(2)}%)
              <span className="ml-2 font-normal text-ink-muted">live · {data?.provider}</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] font-medium text-ink-muted">Signal entry</p>
            <p className="text-3xl font-extrabold tracking-tight">{formatPrice(s.entry)}</p>
            <p className="text-xs text-ink-muted">
              Prices are published by an ATG analyst — no live feed is connected.
            </p>
          </>
        )}
      </Card>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {frames.map((f) => (
          <Chip key={f} active={activeFrame === f} onClick={() => setFrame(f)}>
            {f}
          </Chip>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="h-64 w-full p-2">
          {chart.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6 text-gold-400" />
            </div>
          ) : chart.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-semibold text-ink-soft">Chart data couldn&apos;t be loaded.</p>
              <Button size="sm" variant="outline" onClick={() => chart.refetch()}>Retry chart</Button>
            </div>
          ) : live ? (
            <CandleChart candles={candles} className="h-full w-full" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <BarChart3 className="h-8 w-8 text-ink-faint" />
              <p className="text-sm font-semibold text-ink-soft">Live chart not connected</p>
              <p className="text-xs text-ink-muted">
                {data?.stale
                  ? 'The market-data feed did not return candles for this instrument.'
                  : 'ATG publishes signals manually. Connect a market-data feed to view live candles here.'}
              </p>
            </div>
          )}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-2 rounded-2xl border border-cream-200 bg-white p-4 min-[480px]:grid-cols-3">
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

      {s.status !== 'OPEN' && (
        <div className="mt-3 rounded-2xl border border-cream-200 bg-white p-4">
          <p className="text-[10px] font-medium text-ink-muted">Final result</p>
          <p className="text-sm font-bold">
            {status.label}
            {s.resultPct != null && ` · ${s.resultPct > 0 ? '+' : ''}${s.resultPct}%`}
            {s.resultPips != null && ` · ${s.resultPips > 0 ? '+' : ''}${s.resultPips} pips`}
          </p>
          {s.closedAt && <p className="text-[11px] text-ink-faint">Closed {new Date(s.closedAt).toLocaleString()}</p>}
        </div>
      )}

      {s.analysis && (
        <>
          <h2 className="section-title mb-2 mt-5">Analysis</h2>
          <p className="text-sm leading-relaxed text-ink-soft">{s.analysis}</p>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Published {new Date(s.publishedAt).toLocaleString()}</span>
        {s.author && (
          <span className="inline-flex items-center gap-1.5">
            <span>by</span>
            {s.author.avatarUrl ? (
              <img src={s.author.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[8px] font-bold text-gold-200">
                {s.author.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="font-semibold text-ink-soft">{s.author.name}</span>
            {s.author.role === 'ADMIN' && <span>· ATG Admin</span>}
          </span>
        )}
      </div>

      <div className="mt-5 rounded-2xl bg-cream-200 p-4 text-xs text-ink-muted">
        <p className="font-semibold text-ink">Educational signal — not trade execution</p>
        <p className="mt-1">
          ATG Traders does not place trades or connect to your trading account. Place any order yourself, in
          your own broker account, and manage your own risk. Never risk more than you can afford to lose.
        </p>
      </div>
      <div className="h-6" />
    </div>
  );
}
