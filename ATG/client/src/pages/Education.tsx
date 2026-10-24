import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, Play, Search } from 'lucide-react';
import { courseApi } from '../lib/endpoints';
import { Button, Chip, SkeletonRow } from '../components/ui';
import type { Course } from '../lib/types';

const levels = ['All Courses', 'Beginner', 'Intermediate', 'Advanced'];

function CourseCard({ course, owned = false }: { course: Course; owned?: boolean }) {
  const first = course.lessons[0];
  return (
    <Link to={`/education/${course.slug}`} className="card group flex items-center gap-3 p-3 transition-colors hover:border-gold-300 sm:gap-4 sm:p-4">
      <div className="relative grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink sm:h-20 sm:w-28">
        {course.coverUrl ? (
          <img src={course.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Play className="h-6 w-6 text-gold-300" />
        )}
        {!course.isFree && (
          <span className="absolute right-1 top-1 rounded-full bg-ink/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {course.currency ?? 'USD'} {course.price.toFixed(2)}
          </span>
        )}
        {course.isFree && (
          <span className="absolute right-1 top-1 rounded-full bg-green-600/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
            FREE
          </span>
        )}
        {!course.isFree && (
          <span className="absolute bottom-1 left-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-ink">
            ONE-TIME
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{course.title}</p>
        <p className="text-xs text-ink-muted">
          {first ? `${first.title} · ${first.durationMin} min` : `${course.lessonCount} lessons`}
        </p>
        {owned ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-success">
            <CheckCircle2 className="h-3 w-3" /> Purchased · access confirmed
          </p>
        ) : !course.isFree ? (
          <p className="mt-1 text-[10px] text-ink-muted">Buy once · unlock after payment review</p>
        ) : null}
        {course.saleStatus && course.saleStatus !== 'AVAILABLE' && (
          <p className="mt-1 text-[10px] font-semibold text-danger">
            {course.saleStatus === 'SOLD_OUT' ? 'Sold out' : 'Not currently available'}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200">
            <div className="h-full rounded-full bg-gold-gradient" style={{ width: `${course.progress}%` }} />
          </div>
          <span className="text-[10px] font-semibold tabular-nums text-ink-muted">{course.progress}%</span>
        </div>
      </div>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors ${owned || course.isFree || !course.saleStatus || course.saleStatus === 'AVAILABLE' ? 'bg-gold-50 text-gold-800 group-hover:bg-gold-100' : 'bg-cream-200 text-ink-muted'}`}>
        {owned || course.isFree ? <Play className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      </span>
    </Link>
  );
}

export default function Education() {
  const [level, setLevel] = useState('All Courses');
  const [q, setQ] = useState('');
  const courses = useQuery({
    queryKey: ['courses', level],
    queryFn: () => courseApi.list(level),
    refetchOnMount: 'always',
  });

  const filtered = (courses.data ?? []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const ownedCourses = filtered.filter((course) => !course.isFree && course.entitled);
  const catalogCourses = filtered.filter((course) => course.isFree || !course.entitled);

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Education</h1>
          <p className="muted">Learn. Practice. Grow.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-cream-300 bg-white px-3 py-2.5">
            <Search className="h-4 w-4 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="w-24 bg-transparent px-2 text-sm outline-none placeholder:text-ink-faint md:w-36"
            />
          </div>
        </div>
      </header>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {levels.map((l) => (
          <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
            {l}
          </Chip>
        ))}
      </div>

      <section className="mb-6">
        <h2 className="section-title mb-2">Your courses</h2>
        {courses.isLoading ? (
          <SkeletonRow />
        ) : courses.isError ? (
          <p className="text-sm text-ink-muted">Purchased course access couldn&apos;t be loaded.</p>
        ) : ownedCourses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-cream-300 px-4 py-3 text-sm text-ink-muted">
            Purchased courses will appear here after payment is approved.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {ownedCourses.map((course) => <CourseCard key={course.id} course={course} owned />)}
          </div>
        )}
      </section>

      <h2 className="section-title mb-2">Course catalogue</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {courses.isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : courses.isError ? (
          <div className="card flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm font-semibold">Courses couldn&apos;t be loaded.</p>
            <p className="text-xs text-ink-muted">Check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={() => courses.refetch()}>Try again</Button>
          </div>
        ) : catalogCourses.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            {q.trim()
              ? 'No courses match your search.'
              : ownedCourses.length > 0
                ? 'You have purchased all courses matching this level. Your access is listed above.'
                : 'No courses are available in this level yet.'}
          </p>
        ) : (
          catalogCourses.map((c) => <CourseCard key={c.id} course={c} />)
        )}
      </div>
      <div className="h-4" />
    </div>
  );
}
