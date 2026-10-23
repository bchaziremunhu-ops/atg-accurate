import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, Lock, PlayCircle, ShoppingCart } from 'lucide-react';
import { courseApi } from '../lib/endpoints';
import { Button, Card, Modal, Spinner } from '../components/ui';
import PurchaseRequestForm from '../components/PurchaseRequestForm';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

export default function CourseDetail() {
  const { slug = '' } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeLesson, setActiveLesson] = useState<string | null>(null);

  const [buyOpen, setBuyOpen] = useState(false);

  const courseQuery = useQuery({ queryKey: ['course', slug], queryFn: () => courseApi.get(slug) });
  const { data: course, isLoading } = courseQuery;

  const complete = useMutation({
    mutationFn: (lessonId: string) => courseApi.progress(slug, { lessonId, completed: true }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['course', slug] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      if (res.completed) toast('Course completed! Certificate earned 🏅', 'success');
      else toast('Lesson marked complete', 'success');
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const enroll = useMutation({
    mutationFn: () => courseApi.enroll(slug),
    onSuccess: () => {
      toast('Enrolled — happy learning!', 'success');
      qc.invalidateQueries({ queryKey: ['course', slug] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-gold-400" />
      </div>
    );
  }
  if (courseQuery.isError || !course) {
    const unavailable = isAxiosError(courseQuery.error) && courseQuery.error.response?.status === 404;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-semibold">{unavailable ? 'This course is not available.' : 'This course couldn’t be loaded.'}</p>
        <p className="text-sm text-ink-muted">
          {unavailable ? 'It may have been unpublished or removed by an administrator.' : 'Check your connection and try again.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => courseQuery.refetch()}>Try again</Button>
          <Link to="/education" className="btn-outline px-4 py-2">Back to education</Link>
        </div>
      </div>
    );
  }

  const entitled = course.entitled ?? course.isFree ?? course.price <= 0;
  const isFree = course.isFree ?? course.price <= 0;
  const saleAvailable = !course.saleStatus || course.saleStatus === 'AVAILABLE';
  const current = course.lessons.find((l) => l.id === activeLesson) ?? course.lessons.find((l) => !l.locked);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <Link to="/education" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted">
        <ArrowLeft className="h-4 w-4" /> Education
      </Link>

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{course.title}</h1>
          <p className="muted">
            {course.level} · {course.lessonCount} lessons · {course.durationMin} min
          </p>
        </div>
        {isFree ? (
          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-success">FREE</span>
        ) : (
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-gold-200">{course.currency ?? 'USD'} {course.price.toFixed(2)}</span>
        )}
      </div>

      {/* Player */}
      <Card className="mb-4 overflow-hidden p-0">
        <div className="relative grid aspect-video w-full place-items-center bg-ink">
          {current?.videoUrl && !current.locked ? (
            <video key={current.id} src={current.videoUrl} controls className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-cream-100">
              <Lock className="h-8 w-8 text-gold-300" />
              <p className="text-sm">
                {current?.locked ? 'Complete payment to unlock this lesson' : 'No video available'}
              </p>
            </div>
          )}
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold">{current?.title ?? 'Select a lesson'}</p>
          <p className="muted mt-1">{current?.description ?? course.description}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream-200">
              <div className="h-full rounded-full bg-gold-700" style={{ width: `${course.progress}%` }} />
            </div>
            <span className="text-xs font-semibold text-ink-muted">{course.progress}% complete</span>
          </div>
        </div>
      </Card>

      {!course.enrollmentId && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-gold-100 bg-gold-50">
          <div>
            <p className="text-sm font-semibold">Get full access</p>
            <p className="text-xs text-ink-muted">
              {isFree
                ? 'Free short course — enroll now'
                : `${course.currency ?? 'USD'} ${course.price.toFixed(2)} one-time · access after admin approval`}
            </p>
          </div>
          {isFree ? (
            <Button onClick={() => enroll.mutate()} loading={enroll.isPending} disabled={!saleAvailable}>
              Enroll
            </Button>
          ) : (
            <Button onClick={() => setBuyOpen(true)} disabled={!saleAvailable}>
              <ShoppingCart className="h-4 w-4" /> {course.saleStatus === 'AVAILABLE' ? 'Request purchase' : course.saleStatus?.replace('_', ' ') ?? 'Unavailable'}
            </Button>
          )}
        </Card>
      )}
      {!saleAvailable && !entitled && (
        <p className="mb-4 text-center text-xs text-ink-muted">This course is not currently available for enrollment or purchase.</p>
      )}

      {entitled && !course.enrollmentId && (
        <p className="mb-4 text-center text-xs text-success">✓ Payment verified — you have full access to this course.</p>
      )}

      {/* Lessons */}
      <h2 className="section-title mb-2">Lessons</h2>
      <div className="space-y-2">
        {course.lessons.length === 0 && (
          <Card className="py-6 text-center text-sm text-ink-muted">
            Course lessons are being prepared. Please check back later.
          </Card>
        )}
        {course.lessons.map((l, i) => (
          <div key={l.id} className="card flex cursor-pointer items-center gap-3 p-3 transition-colors hover:border-gold-300" onClick={() => setActiveLesson(l.id)} role="button">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-200 text-xs font-bold text-ink-soft">
              {l.completed ? <CheckCircle2 className="h-5 w-5 text-success" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.title}</p>
              <p className="text-xs text-ink-muted">
                {l.durationMin} min {l.isFree && <span className="ml-1 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">PREVIEW</span>}
              </p>
            </div>
            {l.locked ? (
              <Lock className="h-4 w-4 text-ink-faint" />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  complete.mutate(l.id);
                }}
                className="text-xs font-semibold text-gold-600"
                disabled={complete.isPending}
              >
                {l.completed ? 'Done' : 'Mark done'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Resources */}
      {course.resources && course.resources.length > 0 && (
        <>
          <h2 className="section-title mb-2 mt-6">Downloads</h2>
          <div className="space-y-2">
            {course.resources.map((r) => (
              <a
                key={r.id}
                href={r.locked ? undefined : r.url}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center gap-3 p-3 transition-colors hover:border-gold-300"
                onClick={(e) => r.locked && e.preventDefault()}
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-soft text-gold-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-ink-muted">
                    {r.type} · {(r.sizeKb / 1024).toFixed(1)} MB
                  </p>
                </div>
                {r.locked ? <Lock className="h-4 w-4 text-ink-faint" /> : <PlayCircle className="h-4 w-4 text-gold-600" />}
              </a>
            ))}
          </div>
        </>
      )}
      <div className="h-4" />

      <Modal open={buyOpen} onClose={() => setBuyOpen(false)} title="Request course purchase">
        <PurchaseRequestForm
          item={{
            itemType: 'COURSE',
            itemId: course.id,
            title: course.title,
            description: course.description,
            price: course.price,
            currency: course.currency ?? 'USD',
          }}
          onSubmitted={() => {
            setBuyOpen(false);
            qc.invalidateQueries({ queryKey: ['purchase-requests'] });
          }}
        />
      </Modal>
    </div>
  );
}
