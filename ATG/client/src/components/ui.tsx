import { clsx } from 'clsx';
import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Button({
  variant = 'gold',
  size = 'md',
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'gold' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  const variants = {
    gold: 'btn-gold',
    outline: 'btn-outline',
    ghost: 'btn-ghost',
    danger: 'btn bg-danger text-white hover:brightness-110',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3.5 text-base w-full' };
  return (
    <button className={clsx(variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin text-current', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card p-4', className)}>{children}</div>;
}

export function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('chip', active ? 'chip-active' : 'chip-idle', className)}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      <input id={fieldId} className={clsx('input', error && 'border-danger focus:border-danger focus:ring-red-100')} {...props} />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  error,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      <select id={fieldId} className={clsx('input appearance-none', error && 'border-danger focus:border-danger focus:ring-red-100')} {...props}>
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Textarea({ label, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      <textarea id={fieldId} className="input min-h-[96px] resize-y" {...props} />
    </div>
  );
}

export function Badge({
  tone = 'gold',
  children,
  className,
}: {
  tone?: 'gold' | 'green' | 'red' | 'grey';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    gold: 'bg-gold-100 text-gold-800',
    green: 'bg-green-500/15 text-success',
    red: 'bg-red-500/15 text-danger',
    grey: 'bg-cream-200 text-ink-muted',
  };
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="mb-1 text-gold-400">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {subtitle && <p className="max-w-xs text-sm text-ink-muted">{subtitle}</p>}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="card space-y-3 p-4">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-3 w-2/3" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="animate-rise w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1 text-ink-muted hover:bg-cream-200" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
