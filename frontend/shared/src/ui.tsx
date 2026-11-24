import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' };

export function Button({ variant = 'ghost', className = '', ...props }: ButtonProps) {
  const look = variant === 'primary'
    ? 'bg-brand text-on-brand border-brand hover:opacity-90'
    : 'bg-surface text-text border-line hover:border-brand';
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition disabled:cursor-default disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
      <span aria-hidden="true">📡</span> JobRadar
      {suffix && <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{suffix}</span>}
    </span>
  );
}

/** Green when the server answers /healthz, orange when it does not. */
export function ServerStatus({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-sm text-muted">Đang kiểm tra server…</span>;
  return ok
    ? <span className="text-sm font-medium text-good">● Server đang chạy</span>
    : <span className="text-sm font-medium text-warn">● Không kết nối được server (chạy npm run dev:server)</span>;
}
