import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Heart, Star, Trash2 } from 'lucide-react';
import { userApi, signalApi } from '../lib/endpoints';
import { Card, EmptyState, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

interface Watch {
  id: string;
  pair: string;
}

export default function Saved() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const watchlist = useQuery({ queryKey: ['watchlist'], queryFn: () => userApi.watchlist() as Promise<Watch[]> });
  const signals = useQuery({ queryKey: ['signals', 'all'], queryFn: () => signalApi.list() });

  const remove = useMutation({
    mutationFn: (pair: string) => userApi.removeWatch(pair),
    onSuccess: () => {
      toast('Removed', 'info');
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">Saved Content</h1>

      <h2 className="section-title mb-2 flex items-center gap-2">
        <Star className="h-4 w-4 text-gold-500" /> Saved pairs
      </h2>
      {watchlist.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : (watchlist.data ?? []).length === 0 ? (
        <Card>
          <EmptyState title="No saved pairs" subtitle="Star a signal to save its pair here." icon={<Heart />} />
        </Card>
      ) : (
        <div className="space-y-2">
          {watchlist.data!.map((w) => {
            const match = signals.data?.find((s) => s.pair === w.pair);
            return (
              <Card key={w.id} className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-soft text-gold-600">
                  <Star className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{w.pair}</p>
                  {match && (
                    <Link to={`/signals/${match.id}`} className="text-xs text-gold-600">
                      View latest signal →
                    </Link>
                  )}
                </div>
                <button onClick={() => remove.mutate(w.pair)} className="rounded-lg p-2 text-danger hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            );
          })}
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}
