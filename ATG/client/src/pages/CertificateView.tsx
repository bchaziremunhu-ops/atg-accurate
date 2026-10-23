import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, Printer } from 'lucide-react';
import { userApi } from '../lib/endpoints';
import { Button, Spinner } from '../components/ui';
import { BrandLogo } from '../components/BrandLogo';

export default function CertificateView() {
  const { id = '' } = useParams();
  const cert = useQuery({ queryKey: ['certificate', id], queryFn: () => userApi.certificate(id), enabled: !!id });

  if (cert.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="h-7 w-7 text-gold-400" />
      </div>
    );
  }

  if (!cert.data) {
    return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
        <Link to="/profile/certificates" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
          <ArrowLeft className="h-4 w-4" /> Certificates
        </Link>
        <p className="text-sm text-ink-muted">This certificate could not be found.</p>
      </div>
    );
  }

  const c = cert.data;
  const shortId = c.id.slice(-8).toUpperCase();
  const issued = new Date(c.issuedAt);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link to="/profile/certificates" className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <ArrowLeft className="h-4 w-4" /> Certificates
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <div className="cert-print mx-auto max-w-2xl rounded-3xl border-2 border-gold-300 bg-white p-1 shadow-card">
        <div className="rounded-[20px] border border-gold-200 bg-gradient-to-br from-cream-50 to-gold-100 p-8 text-center sm:p-12">
          <BrandLogo size="md" />

          <p className="mt-6 text-xs font-bold tracking-[0.35em] text-gold-600">CERTIFICATE OF COMPLETION</p>

          <p className="mt-6 text-sm text-ink-muted">This certifies that</p>
          <p className="mt-1 text-3xl font-extrabold text-ink">{c.recipient}</p>

          <p className="mt-6 text-sm text-ink-muted">has successfully completed the course</p>
          <p className="gold-text mt-1 text-xl font-bold">{c.course?.title ?? c.title}</p>
          {c.course?.level && <p className="mt-1 text-xs font-semibold text-ink-muted">{c.course.level} level</p>}

          <div className="mt-8 flex items-end justify-between gap-4 border-t border-gold-200 pt-5 text-left">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Issued</p>
              <p className="text-sm font-semibold">
                {issued.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Award className="h-8 w-8 shrink-0 text-gold-500" />
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Certificate ID</p>
              <p className="text-sm font-semibold">{shortId}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="no-print mx-auto mt-3 max-w-2xl text-center text-xs text-ink-faint">
        Use “Print / Save PDF” to download a copy. ATG Traders · Best Trading Experience
      </p>
      <div className="h-6" />
    </div>
  );
}
