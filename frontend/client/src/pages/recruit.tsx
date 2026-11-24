// Phase 2 pages: post a job, my posts and their applicants (employer side);
// a posted job's detail and the apply form, and my applications (candidate side).
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Pills, Spinner, TagInput, TextArea, api } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { Link, navigate } from '../router';

type Post = {
  id: string; title: string; company: string; companyUrl: string; description: string; skills: string[]; kind: string;
  budgetText: string; budgetMinUsd: number | null; budgetMaxUsd: number | null; applyMode: 'in_app' | 'url'; applyUrl: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'closed'; createdAt: string; approvedAt: string | null; expiresAt: string | null;
  applicants?: number; unread?: number; rejectReason?: string | null; contactEmail?: string;
};
type Application = { id: string; name: string; email: string; message: string; profile: string; hasCv: boolean; status: 'sent' | 'viewed' | 'shortlisted' | 'rejected'; createdAt: string };

const KINDS = ['Freelance (trọn gói)', 'Freelance (theo giờ)', 'Part-time remote', 'Full-time remote'];
const STATUS: Record<Post['status'], [string, string]> = {
  pending: ['Chờ duyệt', 'bg-brand-soft text-brand'], approved: ['Đang mở', 'bg-good-soft text-good'],
  rejected: ['Cần sửa', 'bg-warn-soft text-warn'], closed: ['Đã đóng', 'bg-bg text-muted'],
};
const APP_STATUS: Record<Application['status'], string> = { sent: 'Mới', viewed: 'Đã xem', shortlisted: 'Vào vòng sau', rejected: 'Không phù hợp' };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');

function Badge({ status }: { status: Post['status'] }) {
  const [label, look] = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${look}`}>{label}</span>;
}

// ---- Employer ----

function PostForm({ initial, onSaved, onCancel }: { initial?: Post; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    title: initial?.title ?? '', company: initial?.company ?? '', companyUrl: initial?.companyUrl ?? '', description: initial?.description ?? '',
    kind: initial?.kind ?? KINDS[0], budgetText: initial?.budgetText ?? '', budgetMinUsd: initial?.budgetMinUsd ?? '', budgetMaxUsd: initial?.budgetMaxUsd ?? '',
    applyMode: initial?.applyMode ?? 'in_app', applyUrl: initial?.applyUrl ?? '', contactEmail: initial?.contactEmail ?? '',
  });
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api(initial ? `/api/employer/posts/${initial.id}` : '/api/employer/posts', { body: { ...f, skills } });
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <h2 className="text-lg font-semibold">{initial ? 'Sửa tin tuyển dụng' : 'Đăng tin tuyển dụng'}</h2>
        <Alert>Tin được đội JobRadar duyệt trước khi hiện (thường trong 24 giờ), mở trong 30 ngày. <b>Không thu phí ứng viên</b> dưới bất kỳ hình thức nào.</Alert>
        <Field label="Tiêu đề công việc" required minLength={8} maxLength={150} value={f.title} onChange={set('title')} placeholder="Ví dụ: Lập trình viên React làm landing page" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Công ty / người tuyển" required maxLength={120} value={f.company} onChange={set('company')} />
          <Field label="Website (không bắt buộc)" type="url" value={f.companyUrl} onChange={set('companyUrl')} placeholder="https://" />
        </div>
        <div><div className="mb-2 text-sm font-medium">Hình thức</div><Pills options={KINDS.map((k) => ({ value: k, label: k }))} value={f.kind} onChange={(v: string) => setF({ ...f, kind: v })} label="Hình thức" /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ngân sách (hiển thị)" maxLength={80} value={f.budgetText} onChange={set('budgetText')} placeholder="$300–$500 hoặc 15–20 triệu/tháng" />
          <Field label="Tối thiểu (USD)" type="number" min={0} value={String(f.budgetMinUsd)} onChange={set('budgetMinUsd')} />
          <Field label="Tối đa (USD)" type="number" min={0} value={String(f.budgetMaxUsd)} onChange={set('budgetMaxUsd')} />
        </div>
        <TagInput label="Kỹ năng cần" value={skills} onChange={setSkills} placeholder="react, figma, tiếng anh…" hint="Giúp JobRadar gửi tin tới đúng người." />
        <TextArea label="Mô tả công việc" required rows={10} minLength={80} maxLength={20000} value={f.description} onChange={set('description')}
          placeholder="Việc cần làm, yêu cầu, thời hạn, cách làm việc, quyền lợi…" hint="Ít nhất 80 ký tự." />
        <div>
          <div className="mb-2 text-sm font-medium">Nhận hồ sơ</div>
          <Pills options={[{ value: 'in_app', label: 'Trên JobRadar' }, { value: 'url', label: 'Qua link của tôi' }]} value={f.applyMode} onChange={(v: string) => setF({ ...f, applyMode: v as 'in_app' | 'url' })} label="Nhận hồ sơ" />
        </div>
        {f.applyMode === 'url'
          ? <Field label="Link ứng tuyển" type="url" required value={f.applyUrl ?? ''} onChange={set('applyUrl')} placeholder="https://" />
          : <Field label="Email nhận thông báo (không bắt buộc)" type="email" value={f.contactEmail} onChange={set('contactEmail')} hint="Mặc định là email tài khoản của bạn." />}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex gap-2"><Button variant="primary" type="submit" busy={busy}>{initial ? 'Gửi lại để duyệt' : 'Gửi để duyệt'}</Button><Button type="button" onClick={onCancel}>Huỷ</Button></div>
      </form>
    </Card>
  );
}

export function EmployerPage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const load = () => api<{ posts: Post[] }>('/api/employer/posts').then((r) => setPosts(r.posts)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-2xl font-bold tracking-tight">Đăng tuyển</h1><p className="mt-1 text-sm text-muted">Tìm freelancer và người làm remote tại Việt Nam. Miễn phí trong giai đoạn đầu.</p></div>
          {!editing && <Button variant="primary" onClick={() => setEditing('new')}>Đăng tin mới</Button>}
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {editing && <PostForm initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
        {!posts && !error && <div className="py-10 text-center text-brand"><Spinner /></div>}
        {posts && !posts.length && !editing && <Card className="py-10 text-center text-muted">Bạn chưa đăng tin nào.</Card>}
        {posts?.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Badge status={p.status} />{p.unread ? <span className="text-xs font-semibold text-brand">{p.unread} hồ sơ mới</span> : null}</div>
                <h2 className="mt-2 font-semibold">{p.title}</h2>
                <div className="text-sm text-muted">{p.company} · {p.kind}{p.status === 'approved' ? ` · mở đến ${date(p.expiresAt)}` : ` · gửi ${date(p.createdAt)}`}</div>
                {p.status === 'rejected' && p.rejectReason && <div className="mt-2 text-sm text-warn">Lý do: {p.rejectReason}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                {p.applyMode === 'in_app' && (p.status === 'approved' || p.status === 'closed') && <Link to={`/employer/${p.id}`} className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-brand">{p.applicants ?? 0} ứng viên</Link>}
                {p.status === 'approved' && <a href={`/viec-lam/${p.id}`} target="_blank" rel="noopener" className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-brand">Xem tin ↗</a>}
                {p.status !== 'closed' && <Button onClick={() => setEditing(p)}>Sửa</Button>}
                {p.status === 'approved' && <Button variant="danger" onClick={async () => { if (confirm('Đóng tin này? Tin sẽ không nhận thêm hồ sơ.')) { await api(`/api/employer/posts/${p.id}/close`, { body: {} }); load(); } }}>Đóng tin</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}

export function ApplicantsPage({ postId }: { postId: string }) {
  const [data, setData] = useState<{ post: Post; applications: Application[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api<{ post: Post; applications: Application[] }>(`/api/employer/posts/${postId}/applications`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [postId]);
  const setStatus = async (a: Application, status: Application['status']) => {
    await api(`/api/employer/applications/${a.id}/status`, { body: { status } });
    load();
  };
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/employer" className="text-sm text-muted hover:text-text">← Tin của tôi</Link>
        {error && <Alert kind="error">{error}</Alert>}
        {!data && !error && <div className="py-10 text-center text-brand"><Spinner /></div>}
        {data && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{data.post.title}</h1>
            <p className="text-sm text-muted">{data.applications.length} ứng viên. Hãy liên hệ ứng viên qua email họ cung cấp; không yêu cầu ứng viên trả bất kỳ khoản phí nào.</p>
            {!data.applications.length && <Card className="py-10 text-center text-muted">Chưa có ai ứng tuyển.</Card>}
            {data.applications.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.name || 'Ứng viên'} <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-muted">{APP_STATUS[a.status]}</span></div>
                    <a href={`mailto:${a.email}`} className="text-sm text-brand">{a.email}</a>
                    <div className="text-xs text-muted">Gửi {new Date(a.createdAt).toLocaleString('vi-VN')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.hasCv && <a href={`/api/employer/applications/${a.id}/cv`} onClick={() => setTimeout(load, 800)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand">Tải CV</a>}
                    <Button onClick={() => setStatus(a, 'shortlisted')} disabled={a.status === 'shortlisted'}>Vào vòng sau</Button>
                    <Button onClick={() => setStatus(a, 'rejected')} disabled={a.status === 'rejected'}>Không phù hợp</Button>
                  </div>
                </div>
                <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm whitespace-pre-wrap">{a.message}</p>
                <button onClick={() => { setOpen(open === a.id ? null : a.id); if (a.status === 'sent') setStatus(a, 'viewed'); }} className="mt-2 text-sm font-medium text-muted hover:text-text">{open === a.id ? '▾ Ẩn hồ sơ' : '▸ Xem hồ sơ'}</button>
                {open === a.id && <pre className="mt-2 rounded-lg border border-line p-3 text-sm whitespace-pre-wrap font-sans">{a.profile}</pre>}
              </Card>
            ))}
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ---- Candidate ----

export function JobDetailPage({ postId }: { postId: string }) {
  const [data, setData] = useState<{ post: Post; myApplication: { status: Application['status']; created_at: string } | null; own: boolean; hasCv: boolean } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shareCv, setShareCv] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const load = () => api<NonNullable<typeof data>>(`/api/board/${postId}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [postId]);
  if (error) return <AppLayout><div className="mx-auto max-w-3xl space-y-4"><Alert kind="error">{error}</Alert><Link to="/" className="text-sm text-brand">← Danh sách job</Link></div></AppLayout>;
  if (!data) return <AppLayout><div className="py-20 text-center text-brand"><Spinner /></div></AppLayout>;
  const p = data.post;
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/" className="text-sm text-muted hover:text-text">← Danh sách job</Link>
        <Card>
          <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-xs font-semibold text-good">✓ Đăng trực tiếp trên JobRadar</span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{p.title}</h1>
          <div className="mt-1 text-sm text-muted">{p.companyUrl ? <a href={p.companyUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand">{p.company}</a> : p.company} · {p.kind}{p.budgetText ? <> · <b className="text-good">{p.budgetText}</b></> : null} · hạn {date(p.expiresAt)}</div>
          {p.skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs text-brand">{s}</span>)}</div>}
          <p className="mt-5 text-[15px] leading-relaxed whitespace-pre-line">{p.description}</p>
        </Card>
        {data.own ? <Alert>Đây là tin của bạn. <Link to={`/employer/${p.id}`} className="font-semibold underline">Xem ứng viên</Link></Alert>
          : p.applyMode === 'url' ? (
            <Card><p className="text-sm">Nhà tuyển dụng nhận hồ sơ qua trang của họ.</p><a href={p.applyUrl!} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Ứng tuyển ↗</a></Card>
          ) : data.myApplication ? (
            <Alert kind="success">Bạn đã ứng tuyển ngày {date(data.myApplication.created_at)}. Trạng thái: <b>{APP_STATUS[data.myApplication.status]}</b>. Nhà tuyển dụng sẽ liên hệ qua email của bạn.</Alert>
          ) : (
            <Card>
              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setSendError('');
                try {
                  await api(`/api/board/${p.id}/apply`, { body: { message, shareCv, consent } });
                  load();
                } catch (err) {
                  setSendError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
                <h2 className="text-lg font-semibold">Ứng tuyển</h2>
                <TextArea label="Lời nhắn cho nhà tuyển dụng" required rows={6} minLength={20} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Giới thiệu ngắn: bạn đã làm việc tương tự chưa, làm được trong bao lâu, link sản phẩm…" />
                {data.hasCv ? (
                  <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={shareCv} onChange={(e) => setShareCv(e.target.checked)} /> Gửi kèm CV trong hồ sơ của tôi</label>
                ) : <p className="text-sm text-muted">Bạn chưa có CV trong hồ sơ. <Link to="/profile" className="text-brand">Tải CV lên</Link> để gửi kèm.</p>}
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                  <span>Tôi đồng ý chia sẻ tên, email, hồ sơ{shareCv && data.hasCv ? ' và CV' : ''} của tôi với nhà tuyển dụng này để họ xem xét và liên hệ.</span>
                </label>
                {sendError && <Alert kind="error">{sendError}</Alert>}
                <Button variant="primary" type="submit" busy={busy} disabled={!consent}>Gửi hồ sơ</Button>
                <p className="text-xs text-muted">Nhà tuyển dụng không được thu phí ứng viên. Nếu được yêu cầu chuyển tiền, đừng làm theo và hãy báo cáo tin này.</p>
              </form>
            </Card>
          )}
      </div>
    </AppLayout>
  );
}

export function MyApplicationsPage() {
  const [rows, setRows] = useState<{ id: string; status: Application['status']; created_at: string; post_id: string; title: string; company: string; post_status: string }[] | null>(null);
  useEffect(() => { api<{ applications: NonNullable<typeof rows> }>('/api/applications').then((r) => setRows(r.applications)).catch(() => setRows([])); }, []);
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Đơn đã gửi</h1>
        <p className="text-sm text-muted">Các tin tuyển dụng trên JobRadar bạn đã ứng tuyển. Job ở trang khác, đánh dấu "Đã nộp" trong danh sách job.</p>
        {!rows && <div className="py-10 text-center text-brand"><Spinner /></div>}
        {rows && !rows.length && <Card className="py-10 text-center text-muted">Bạn chưa ứng tuyển tin nào trên JobRadar.</Card>}
        {rows?.map((a) => (
          <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button onClick={() => navigate(`/jobs/${a.post_id}`)} className="text-left font-semibold hover:text-brand">{a.title}</button>
              <div className="text-sm text-muted">{a.company} · gửi {date(a.created_at)}{a.post_status === 'closed' ? ' · tin đã đóng' : ''}</div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.status === 'shortlisted' ? 'bg-good-soft text-good' : a.status === 'rejected' ? 'bg-bg text-muted' : 'bg-brand-soft text-brand'}`}>{APP_STATUS[a.status]}</span>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
