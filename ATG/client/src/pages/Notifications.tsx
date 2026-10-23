import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';
import { notificationApi } from '../lib/endpoints';
import { Button, Card, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

const tone: Record<string, string> = {
  SIGNAL: 'bg-gold-soft text-gold-700',
  PAYMENT: 'bg-green-50 text-success',
  SUBSCRIPTION: 'bg-gold-soft text-gold-700',
  EDUCATION: 'bg-cream-200 text-ink-soft',
  COMMUNITY: 'bg-blue-50 text-blue-700',
  SYSTEM: 'bg-cream-200 text-ink-soft',
};

export default function Notifications() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['notifications'], queryFn: notificationApi.list });

  const readAll = useMutation({
    mutationFn: notificationApi.readAll,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toast(apiError(e), 'error'),
  });

  const read = useMutation({
    mutationFn: (id: string) => notificationApi.read(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/home" className="text-ink-muted">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-extrabold">Notifications</h1>
        </div>
        {(list.data?.unread ?? 0) > 0 && (
          <Button size="sm" variant="outline" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            <CheckCheck className="h-4 w-4" /> Mark all
          </Button>
        )}
      </header>

      {list.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : list.isError ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Notifications couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>Try again</Button>
        </Card>
      ) : (list.data?.notifications ?? []).length === 0 ? (
        <Card className="flex flex-col items-center py-10 text-ink-muted">
          <Bell className="mb-2 h-6 w-6" />
          <p className="text-sm">You&apos;re all caught up.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.data!.notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.read) read.mutate(n.id);
                if (n.link) navigate(n.link);
              }}
              className={`card flex w-full items-start gap-3 p-3.5 text-left ${!n.read ? 'border-gold-300' : ''}`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold ${tone[n.type] ?? tone.SYSTEM}`}>
                {(n.type[0] ?? 'N')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="text-xs text-ink-soft">{n.body}</p>
                <p className="mt-1 text-[10px] text-ink-faint">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold-500" />}
            </button>
          ))}
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}
