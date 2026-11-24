import { useState, type ReactNode } from 'react';
import { Logo } from '@jobradar/shared';
import { Link, navigate } from './router';
import { useSession } from './session';
import { PlanBadge } from './pages/plans';

const POINTS = [
  ['🇻🇳', 'Chỉ job nhận người ở Việt Nam', 'Lọc sẵn từ nhiều trang việc làm remote và freelance.'],
  ['📝', 'Tóm tắt 10 ý chính bằng tiếng Việt', 'Lướt nhanh, không phải đọc mô tả dài bằng tiếng Anh.'],
  ['🤝', 'AI soạn, bạn bấm gửi', 'Proposal, giá đề xuất, câu trả lời phỏng vấn: bạn đọc lại rồi tự nộp.'],
];

/** Login, sign up and similar pages: brand panel on the left (desktop), the form on the right. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(440px,520px)]">
      <aside className="relative hidden overflow-hidden bg-brand p-12 text-on-brand lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-white/5" />
        <Link to="/" className="relative"><Logo className="text-on-brand [&>span:first-child]:bg-white/20" /></Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">Việc remote cho người Việt</h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map(([icon, head, text]) => (
              <li key={head} className="flex gap-4">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 text-lg">{icon}</span>
                <span><b className="block">{head}</b><span className="text-sm opacity-85">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-75">Miễn phí tuần đầu cho mọi tính năng.</p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/" className="lg:hidden"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
        <footer className="mx-auto flex w-full max-w-sm gap-4 text-xs text-muted">
          <Link to="/terms" className="hover:text-text">Điều khoản</Link>
          <Link to="/privacy" className="hover:text-text">Quyền riêng tư</Link>
        </footer>
      </main>
    </div>
  );
}

/** Pages behind the login: top bar with navigation and the user menu. */
export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:gap-6">
          <Link to="/"><Logo /></Link>
          <nav className="flex gap-0.5 text-sm font-medium whitespace-nowrap sm:gap-1">
            <Link to="/" className="rounded-md px-2 py-1.5 text-muted hover:bg-bg hover:text-text sm:px-3">Job</Link>
            <Link to="/profile" className="rounded-md px-2 py-1.5 text-muted hover:bg-bg hover:text-text sm:px-3">Hồ sơ</Link>
            {user?.role === 'admin' && <a href="/admin/" className="rounded-md px-2 py-1.5 text-muted hover:bg-bg hover:text-text sm:px-3">Admin</a>}
          </nav>
          <div className="relative ml-auto flex items-center gap-3">
            {user && <PlanBadge user={user} />}
            <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu tài khoản"
              className="grid size-9 place-items-center rounded-full bg-brand-soft font-semibold text-brand hover:ring-2 hover:ring-brand/30">
              {initial}
            </button>
            {open && (
              <div className="absolute top-full right-0 mt-2 w-60 rounded-xl border border-line bg-surface p-2 shadow-lg" onMouseLeave={() => setOpen(false)}>
                <div className="px-3 py-2">
                  <div className="truncate font-medium">{user?.name || 'Bạn'}</div>
                  <div className="truncate text-xs text-muted">{user?.email}</div>
                </div>
                <Link to="/profile" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-bg">Hồ sơ</Link>
                <Link to="/telegram" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-bg">Telegram</Link>
                <Link to="/pricing" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-bg">Gói dịch vụ</Link>
                <Link to="/account" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-bg">Tài khoản</Link>
                <button onClick={async () => { await logout(); navigate('/login'); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-warn hover:bg-warn-soft">Đăng xuất</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

/** Terms and privacy: readable on any screen, reachable logged in or not. */
export function DocLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/"><Logo /></Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link to="/terms" className="hover:text-text">Điều khoản</Link>
            <Link to="/privacy" className="hover:text-text">Quyền riêng tư</Link>
          </nav>
        </div>
      </header>
      <article className="doc mx-auto max-w-3xl px-4 py-10">{children}</article>
    </div>
  );
}
