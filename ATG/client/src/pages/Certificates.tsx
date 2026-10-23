import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award } from 'lucide-react';
import { userApi } from '../lib/endpoints';
import { Card, EmptyState, Spinner } from '../components/ui';

export default function Certificates() {
  const certs = useQuery({ queryKey: ['certificates'], queryFn: userApi.certificates });

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/profile" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>
      <h1 className="mb-4 text-2xl font-extrabold">My Certificates</h1>

      {certs.isLoading ? (
        <Spinner className="h-6 w-6 text-gold-400" />
      ) : (certs.data ?? []).length === 0 ? (
        <Card>
          <EmptyState title="No certificates yet" subtitle="Complete a course to earn your first certificate." icon={<Award />} />
        </Card>
      ) : (
        <div className="space-y-2">
          {certs.data!.map((c) => (
            <Link key={c.id} to={`/profile/certificates/${c.id}`} className="card flex items-center gap-3 p-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-gradient text-white shadow-gold">
                <Award className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.course?.title ?? c.title}</p>
                <p className="text-xs text-ink-muted">
                  {c.course?.level ? `${c.course.level} · ` : ''}Issued {new Date(c.issuedAt).toLocaleDateString()}
                </p>
              </div>
              <span className="text-xs font-bold text-gold-600">View</span>
            </Link>
          ))}
        </div>
      )}
      <div className="h-4" />
    </div>
  );
}
