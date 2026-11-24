import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Logo, Spinner, api, ApiError, daysLeft, type User } from '@jobradar/shared';
import { AiUsage, Payments, Reports, Sources } from './sections';

const PLAN = { trial: 'Dùng thử', pro: 'Pro', free: 'Free' } as const;

const SECTIONS = [
  { id: 'users', label: 'Người dùng', ready: true },
  { id: 'reports', label: 'Báo cáo job', ready: true },
  { id: 'sources', label: 'Nguồn job', ready: true },
  { id: 'ai', label: 'Chi phí AI', ready: true },
  { id: 'payments', label: 'Thanh toán', ready: true },
  { id: 'blog', label: 'Blog', ready: false },
];
const PAGES: Record<string, () => React.JSX.Element> = { users: Users, reports: Reports, sources: Sources, ai: AiUsage, payments: Payments };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Gate({ state }: { state: 'login' | 'forbidden' | 'error' }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm text-center">
        <Logo suffix="Admin" />
        <p className="mt-6 text-sm text-muted">
          {state === 'login' && 'Đăng nhập bằng tài khoản admin để tiếp tục.'}
          {state === 'forbidden' && 'Tài khoản này không có quyền admin. Thêm email vào ADMIN_EMAILS trên server để cấp quyền.'}
          {state === 'error' && 'Không kết nối được server.'}
        </p>
        <a href="/app/login" className="mt-6 inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Đến trang đăng nhập</a>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="!p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </Card>
  );
}

function Users() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ users: User[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);
  const grant = async (u: User) => {
    if (!confirm(`Cộng 30 ngày Pro cho ${u.email}? (ghi vào lịch sử thanh toán với số tiền 0đ)`)) return;
    try {
      const r = await api<{ user: User }>(`/api/admin/users/${encodeURIComponent(u.id)}/pro`, { body: { days: 30 } });
      setUsers((list) => list && list.map((x) => (x.id === u.id ? r.user : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const shown = useMemo(() => (users ?? []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase())), [users, q]);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!users) return <div className="py-10 text-center text-brand"><Spinner /></div>;
  const weekAgo = Date.now() - 7 * 864e5;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tổng người dùng" value={users.length} />
        <Stat label="Mới trong 7 ngày" value={users.filter((u) => Date.parse(u.createdAt) > weekAgo).length} />
        <Stat label="Đã xác minh email" value={users.filter((u) => u.emailVerified).length} />
        <Stat label="Đang Pro / dùng thử" value={users.filter((u) => u.plan !== 'free').length} />
      </div>
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h2 className="font-semibold">Người dùng ({shown.length})</h2>
          <input type="search" placeholder="Tìm theo tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-bg text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Người dùng</th><th className="px-4 py-3">Gói</th><th className="px-4 py-3">Đăng nhập bằng</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Vai trò</th><th className="px-4 py-3">Tạo lúc</th><th className="px-4 py-3">Lần cuối</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((u) => (
                <tr key={u.id} className="hover:bg-bg/60">
                  <td className="px-4 py-3"><div className="font-medium">{u.name || '—'}</div><div className="text-xs text-muted">{u.email}</div></td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{PLAN[u.plan]}{u.plan === 'pro' ? ` · đến ${fmt(u.proUntil).split(' ')[0]}` : u.plan === 'trial' ? ` · còn ${daysLeft(u.trialEndsAt)} ngày` : ''}</div>
                    <button onClick={() => grant(u)} className="text-xs font-semibold text-brand hover:underline">+30 ngày Pro</button>
                  </td>
                  <td className="px-4 py-3">{[u.hasPassword && 'Mật khẩu', u.googleLinked && 'Google'].filter(Boolean).join(' + ')}{u.telegramLinked ? ' · Telegram' : ''}</td>
                  <td className="px-4 py-3">{u.emailVerified ? <span className="text-good">Đã xác minh</span> : <span className="text-warn">Chưa</span>}</td>
                  <td className="px-4 py-3">{u.role === 'admin' ? <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">admin</span> : 'user'}</td>
                  <td className="px-4 py-3 text-muted">{fmt(u.createdAt)}</td>
                  <td className="px-4 py-3 text-muted">{fmt(u.lastLoginAt)}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Không có người dùng nào khớp.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'login' | 'forbidden' | 'error'>('loading');
  const [section, setSection] = useState('users');
  useEffect(() => {
    api<{ user: User }>('/api/auth/me')
      .then(({ user }) => { setMe(user); setState(user.role === 'admin' && !user.needsConsent ? 'ok' : 'forbidden'); })
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? 'login' : 'error'));
  }, []);
  if (state === 'loading') return <div className="grid min-h-screen place-items-center text-brand"><Spinner /></div>;
  if (state !== 'ok') return <Gate state={state} />;
  const current = SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-surface p-4 lg:min-h-screen lg:border-r lg:border-b-0">
        <Logo suffix="Admin" />
        <nav className="mt-6 flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium ${s.id === section ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-bg hover:text-text'}`}>
              {s.label}
              {!s.ready && <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase text-muted">sắp có</span>}
            </button>
          ))}
        </nav>
        <div className="mt-6 hidden border-t border-line pt-4 text-xs text-muted lg:block">
          <div className="truncate font-medium text-text">{me?.name}</div>
          <div className="truncate">{me?.email}</div>
          <a href="/app/" className="mt-3 inline-block text-brand hover:underline">← Về ứng dụng</a>
        </div>
      </aside>
      <main className="p-4 sm:p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{current.label}</h1>
        {PAGES[section] ? (() => { const Page = PAGES[section]; return <Page />; })() : <Card><p className="text-muted">Phần này đang được xây dựng.</p></Card>}
      </main>
    </div>
  );
}
