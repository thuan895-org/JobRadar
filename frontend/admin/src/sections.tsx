// Admin pages: job reports, job sources, AI usage, payments.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Spinner, api } from '@jobradar/shared';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('vi-VN');

function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = () => api<T>(path).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [path]);
  return { data, error, reload: load };
}

function Loading({ error }: { error: string }) {
  return error ? <Alert kind="error">{error}</Alert> : <div className="py-10 text-center text-brand"><Spinner /></div>;
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-bg text-xs tracking-wide text-muted uppercase"><tr>{head.map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
      {empty && <div className="px-4 py-10 text-center text-muted">Chưa có gì.</div>}
    </Card>
  );
}

// ---- Reports ----

type Report = { id: string; job_id: string; title: string; url: string; source: string; company: string; flag: string | null; kind: string; note: string;
  status: string; resolution: string | null; reporter: string | null; created_at: string; open_on_job: number };
const KIND: Record<string, string> = { scam: '⚠️ Lừa đảo', expired: '⌛ Hết hạn / link hỏng', wrong: '✏️ Sai thông tin', verify: '🔍 Nhờ kiểm tra' };

export function Reports() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useData<{ reports: Report[] }>(`/api/admin/reports?status=${status}`);
  const [busy, setBusy] = useState('');
  const act = async (r: Report, action: string) => {
    if (action === 'scam' && !confirm(`Đánh dấu lừa đảo: "${r.title}"?\nJob sẽ bị ẩn khỏi danh sách và thông báo của mọi người.`)) return;
    setBusy(r.id + action);
    await api(`/api/admin/reports/${encodeURIComponent(r.id)}/resolve`, { body: { action } }).catch((e) => alert(e.message));
    setBusy('');
    reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['open', 'Đang chờ'], ['resolved', 'Đã xử lý'], ['dismissed', 'Đã bỏ qua'], ['all', 'Tất cả']].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${status === v ? 'bg-text text-bg' : 'text-muted hover:bg-surface'}`}>{l}</button>
        ))}
      </div>
      {!data ? <Loading error={error} /> : data.reports.length === 0 ? <Card className="py-10 text-center text-muted">Không có báo cáo nào.</Card> : (
        <div className="space-y-3">
          {data.reports.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{KIND[r.kind] ?? r.kind}{r.open_on_job > 1 && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn">{r.open_on_job} báo cáo cho job này</span>}</div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-medium text-brand hover:underline">{r.title} ↗</a>
                  <div className="text-xs text-muted">{r.source}{r.company ? ` · ${r.company}` : ''} · {r.reporter ?? 'tài khoản đã xoá'} · {fmt(r.created_at)}</div>
                  {r.note && <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-sm whitespace-pre-wrap">{r.note}</p>}
                  {r.flag && <div className="mt-2 text-xs font-semibold">{r.flag === 'scam' ? '⛔ Job đang bị đánh dấu lừa đảo' : '✓ Job đã xác minh'}</div>}
                  {r.resolution && <div className="mt-1 text-xs text-muted">{r.resolution}</div>}
                </div>
                {r.status === 'open' && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" busy={busy === r.id + 'scam'} onClick={() => act(r, 'scam')}>Lừa đảo</Button>
                    <Button busy={busy === r.id + 'verified'} onClick={() => act(r, 'verified')}>Đã xác minh</Button>
                    <Button busy={busy === r.id + 'dismiss'} onClick={() => act(r, 'dismiss')}>Bỏ qua</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Sources ----

type Source = { key: string; name: string; enabled: boolean; minIntervalMinutes: number; lastAttempt: string | null; ok: boolean | null; error: string | null;
  fetched: number | null; fresh: number | null; ms: number | null; jobsTotal: number; jobsLastDay: number };

export function Sources() {
  const { data, error } = useData<{ sources: Source[] }>('/api/admin/sources');
  if (!data) return <Loading error={error} />;
  return (
    <Table head={['Nguồn', 'Trạng thái', 'Lần gọi cuối', 'Lần gọi cuối lấy về', 'Job mới 24h', 'Tổng job', 'Gọi mỗi']}>
      {data.sources.map((s) => (
        <tr key={s.key}>
          <td className="px-4 py-3"><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.key}</div></td>
          <td className="px-4 py-3">{!s.enabled ? <span className="text-muted">Tắt</span> : s.ok === false ? <span className="text-warn" title={s.error ?? ''}>● Lỗi: {s.error?.slice(0, 60)}</span> : s.ok ? <span className="text-good">● Ổn</span> : <span className="text-muted">Chưa gọi</span>}</td>
          <td className="px-4 py-3 text-muted">{fmt(s.lastAttempt)}{s.ms != null ? ` · ${(s.ms / 1000).toFixed(1)}s` : ''}</td>
          <td className="px-4 py-3">{s.fetched != null ? `${num(s.fetched)} job, ${num(s.fresh)} mới` : '—'}</td>
          <td className="px-4 py-3 font-semibold">{num(s.jobsLastDay)}</td>
          <td className="px-4 py-3">{num(s.jobsTotal)}</td>
          <td className="px-4 py-3 text-muted">{s.minIntervalMinutes} phút</td>
        </tr>
      ))}
    </Table>
  );
}

// ---- AI usage ----

type Usage = { calls: number; input: number; output: number };
type AiStats = {
  periods: Record<'day' | 'week' | 'month', { total: Usage & { costUsd: number; costKnown: boolean }; byKind: Record<string, Usage> }>;
  byModel: (Usage & { model: string; costUsd: number | null })[];
  topUsers: { email: string; calls: number; tokens: number }[];
  pricingSet: boolean;
};
const KIND_AI: Record<string, string> = { highlights: '10 điểm chính', score: 'AI chấm', kit: 'Bộ apply', cv: 'Đọc CV', other: 'Khác' };

export function AiUsage() {
  const { data, error } = useData<AiStats>('/api/admin/ai-usage');
  if (!data) return <Loading error={error} />;
  const money = (t: { costUsd: number; costKnown: boolean }) => (t.costKnown && data.pricingSet ? `$${t.costUsd.toFixed(2)}` : '—');
  return (
    <div className="space-y-6">
      {!data.pricingSet && <Alert>Chưa đặt giá token nên chưa tính được chi phí. Thêm <code>ai.pricing</code> vào <code>server/config.json</code> theo bảng giá hiện tại của Gemini, dạng <code>{'{"<tên model>": {"input": <USD/1 triệu token vào>, "output": <USD/1 triệu token ra>}}'}</code>.</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        {(['day', 'week', 'month'] as const).map((p) => {
          const t = data.periods[p].total;
          return (
            <Card key={p} className="!p-4">
              <div className="text-xs font-medium tracking-wide text-muted uppercase">{{ day: '24 giờ', week: '7 ngày', month: '30 ngày' }[p]}</div>
              <div className="mt-1 text-2xl font-bold">{num(t.calls)} <span className="text-sm font-medium text-muted">lần gọi</span></div>
              <div className="mt-1 text-sm text-muted">{num(t.input)} token vào · {num(t.output)} token ra · {money(t)}</div>
            </Card>
          );
        })}
      </div>
      <Table head={['Việc (30 ngày)', 'Lần gọi', 'Token vào', 'Token ra']} empty={!Object.keys(data.periods.month.byKind).length}>
        {Object.entries(data.periods.month.byKind).map(([k, u]) => (
          <tr key={k}><td className="px-4 py-3 font-medium">{KIND_AI[k] ?? k}</td><td className="px-4 py-3">{num(u.calls)}</td><td className="px-4 py-3">{num(u.input)}</td><td className="px-4 py-3">{num(u.output)}</td></tr>
        ))}
      </Table>
      <Table head={['Model (30 ngày)', 'Lần gọi', 'Token vào', 'Token ra', 'Chi phí']} empty={!data.byModel.length}>
        {data.byModel.map((m) => (
          <tr key={m.model}><td className="px-4 py-3 font-medium">{m.model}</td><td className="px-4 py-3">{num(m.calls)}</td><td className="px-4 py-3">{num(m.input)}</td><td className="px-4 py-3">{num(m.output)}</td><td className="px-4 py-3">{m.costUsd != null ? `$${m.costUsd.toFixed(2)}` : '—'}</td></tr>
        ))}
      </Table>
      <Table head={['Người dùng dùng nhiều nhất (30 ngày)', 'Lần gọi', 'Token']} empty={!data.topUsers.length}>
        {data.topUsers.map((u) => (
          <tr key={u.email}><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3">{num(u.calls)}</td><td className="px-4 py-3">{num(u.tokens)}</td></tr>
        ))}
      </Table>
    </div>
  );
}

// ---- Payments ----

type Payment = { id: string; email: string | null; amount_vnd: number; days: number; method: string; status: string; note: string | null; created_at: string };
const METHOD: Record<string, string> = { mock: 'Thử nghiệm', admin: 'Admin cộng', bank: 'Chuyển khoản' };

export function Payments() {
  const { data, error } = useData<{ payments: Payment[] }>('/api/admin/payments');
  if (!data) return <Loading error={error} />;
  const paid = data.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_vnd, 0);
  return (
    <div className="space-y-4">
      <Card className="!p-4"><div className="text-xs font-medium tracking-wide text-muted uppercase">Doanh thu thật</div><div className="mt-1 text-2xl font-bold">{num(paid)}đ</div><div className="text-sm text-muted">Thanh toán thử nghiệm không được tính.</div></Card>
      <Table head={['Thời gian', 'Người dùng', 'Cách', 'Số tiền', 'Số ngày', 'Ghi chú']} empty={!data.payments.length}>
        {data.payments.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3 text-muted">{fmt(p.created_at)}</td>
            <td className="px-4 py-3">{p.email ?? 'tài khoản đã xoá'}</td>
            <td className="px-4 py-3">{METHOD[p.method] ?? p.method}{p.status === 'test' && <span className="ml-2 rounded bg-bg px-1.5 text-xs text-muted">test</span>}</td>
            <td className="px-4 py-3">{num(p.amount_vnd)}đ</td>
            <td className="px-4 py-3">{p.days}</td>
            <td className="px-4 py-3 text-muted">{p.note}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
