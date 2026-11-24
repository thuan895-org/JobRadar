import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; busy?: boolean; block?: boolean };

export function Button({ variant = 'ghost', busy = false, block = false, className = '', children, disabled, ...props }: ButtonProps) {
  const look = {
    primary: 'bg-brand text-on-brand border-brand hover:brightness-110',
    ghost: 'bg-surface text-text border-line hover:border-brand',
    danger: 'bg-surface text-warn border-warn hover:bg-warn-soft',
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-60 ${block ? 'w-full' : ''} ${look} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string };

export function Field({ label, hint, className = '', ...props }: FieldProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        id={id}
        className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] text-text placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const look = {
    info: 'border-brand/30 bg-brand-soft text-text',
    error: 'border-warn/40 bg-warn-soft text-warn',
    success: 'border-good/40 bg-good-soft text-good',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-sm ${look}`}>{children}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function Logo({ suffix, className = '' }: { suffix?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${className}`}>
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-brand text-base text-on-brand">📡</span>
      JobRadar
      {suffix && <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{suffix}</span>}
    </span>
  );
}

export function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Green when the server answers /healthz, orange when it does not. */
export function ServerStatus({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-sm text-muted">Đang kiểm tra server…</span>;
  return ok
    ? <span className="text-sm font-medium text-good">● Server đang chạy</span>
    : <span className="text-sm font-medium text-warn">● Không kết nối được server</span>;
}
