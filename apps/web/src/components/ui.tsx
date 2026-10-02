import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../lib/api';

export function Card({ children, className, title, actions, id }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={clsx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'primary', className, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'danger' && 'border border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
        variant === 'ghost' && 'text-brand-800 hover:bg-brand-50',
        className,
      )}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

const CHIP: Record<string, string> = {
  // exchange
  PROPOSED: 'bg-sky-50 text-sky-800 ring-sky-200',
  ACCEPTED: 'bg-brand-50 text-brand-800 ring-brand-200',
  DISPUTED: 'bg-amber-50 text-amber-900 ring-amber-300',
  SETTLED: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  RELEASED: 'bg-slate-100 text-slate-700 ring-slate-300',
  CANCELLED: 'bg-slate-100 text-slate-700 ring-slate-300',
  DECLINED: 'bg-slate-100 text-slate-700 ring-slate-300',
  WITHDRAWN: 'bg-slate-100 text-slate-700 ring-slate-300',
  // reservations
  ACTIVE: 'bg-brand-50 text-brand-800 ring-brand-200',
  FROZEN: 'bg-amber-50 text-amber-900 ring-amber-300',
  // vouch
  PENDING: 'bg-sky-50 text-sky-800 ring-sky-200',
  EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-300',
  REVOKED: 'bg-red-50 text-red-800 ring-red-200',
  // dispute
  AWAITING_ATTESTATION: 'bg-sky-50 text-sky-800 ring-sky-200',
  PANEL_REVIEW: 'bg-violet-50 text-violet-800 ring-violet-200',
  NEEDS_REVIEW: 'bg-red-50 text-red-800 ring-red-200',
  RESOLVED: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  CONFIRMED: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  REFUTED: 'bg-red-50 text-red-800 ring-red-200',
  UNCLEAR: 'bg-violet-50 text-violet-800 ring-violet-200',
  OPEN: 'bg-brand-50 text-brand-800 ring-brand-200',
  LEFT: 'bg-slate-200 text-slate-700 ring-slate-300',
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', CHIP[status] ?? 'bg-slate-100 text-slate-700 ring-slate-300')}>
      {label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

/** A number with a "Why?" disclosure explaining how the backend computed it. */
export function Stat({ label, value, why, tone = 'default', sub }: { label: string; value: ReactNode; why?: ReactNode; tone?: 'default' | 'warn' | 'good' | 'muted'; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={clsx('num mt-1 text-2xl font-semibold', tone === 'warn' && 'text-amber-700', tone === 'good' && 'text-brand-700', tone === 'muted' && 'text-slate-500')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      {why && <Why>{why}</Why>}
    </div>
  );
}

export function Why({ children, label = 'Why?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-2">
      <button type="button" className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide explanation' : label}
      </button>
      {open && (
        <div id={id} className="mt-1.5 rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-700">
          {children}
        </div>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, title = 'This action was blocked' }: { error: unknown; title?: string }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 leading-relaxed">{e.message}</p>
      {e.code && (
        <p className="mt-2 font-mono text-[11px] text-red-700">
          {e.code} · module: {e.module}
          {e.correlationId ? ` · correlation: ${e.correlationId}` : ''}
        </p>
      )}
    </div>
  );
}

export function Success({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
      {children}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
