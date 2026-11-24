// The main page: jobs picked for this user, with summaries, AI fit and apply kits.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Spinner, Toggle, api } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { Link, navigate } from '../router';
import { useSession } from '../session';
import { VerifyBanner } from './home';
import { KitDialog } from './kit';
import { ReportDialog } from './report';
import { AdCard, AdsConsent, useAds } from '../ads';
import { Fragment } from 'react';

type Status = 'new' | 'saved' | 'applied' | 'hidden';
type Job = {
  id: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
  kind: string;
  location: string;
  budgetText: string;
  bidCount: number | null;
  postedAt: string;
  vietnameseClient: boolean;
  score: number;
  matched: string[];
  regionOk: boolean;
  status: Status;
  ai: { score: number; reason: string; flags: string[]; scam: 'low' | 'medium' | 'high' } | null;
  hasKit: boolean;
  flag: 'scam' | 'verified' | null;
  highlights: string[] | null;
};
type Feed = { jobs: Job[]; total: number; counts: Record<Status | 'all', number>; sources: string[]; hasProfile: boolean; regionOnly: boolean; ai: boolean };

const TABS: { id: Status; label: string }[] = [
  { id: 'new', label: 'Mới' }, { id: 'saved', label: 'Đã lưu' }, { id: 'applied', label: 'Đã nộp' }, { id: 'hidden', label: 'Đã ẩn' },
];
const SORTS = [{ id: 'fit', label: 'Phù hợp nhất' }, { id: 'new', label: 'Mới nhất' }, { id: 'score', label: 'Điểm từ khoá' }];
const PAGE = 30;

function ago(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

// ---- "10 điểm chính": only for cards on screen, at most 10 per request ----

function useHighlights(enabled: boolean, jobs: Job[]) {
  const [points, setPoints] = useState<Record<string, string[] | 'loading' | 'error' | 'limited'>>({});
  const visible = useRef(new Set<string>());
  const asked = useRef(new Set<string>());
  const timer = useRef<number>(0);
  const known = useMemo(() => new Map(jobs.map((j) => [j.id, j.highlights])), [jobs]);

  const flush = useCallback(async () => {
    const ids = [...visible.current].filter((id) => !known.get(id) && !asked.current.has(id)).slice(0, 10);
    if (!ids.length) return;
    ids.forEach((id) => asked.current.add(id));
    setPoints((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, 'loading' as const])) }));
    try {
      const r = await api<{ highlights: Record<string, string[]>; limited?: boolean }>('/api/feed/highlights', { body: { ids } });
      setPoints((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, r.highlights[id] ?? (r.limited ? ('limited' as const) : ('error' as const))])) }));
    } catch {
      setPoints((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, 'error' as const])) }));
    }
    if ([...visible.current].some((id) => !known.get(id) && !asked.current.has(id))) flush();
  }, [known]);

  const observer = useMemo(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return null;
    return new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.jobId!;
        if (e.isIntersecting) visible.current.add(id);
        else visible.current.delete(id);
      }
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 350); // a fast scroll past a card costs nothing
    }, { rootMargin: '80px' });
  }, [enabled, flush]);

  useEffect(() => () => observer?.disconnect(), [observer]);

  const watch = useCallback((el: HTMLElement | null) => { if (el && observer) observer.observe(el); }, [observer]);
  const retry = (id: string) => { asked.current.delete(id); visible.current.add(id); flush(); };
  const get = (job: Job) => job.highlights ?? points[job.id];
  return { watch, get, retry };
}

// ---- One job ----

function ScoreBadge({ job }: { job: Job }) {
  const value = job.ai?.score ?? job.score;
  const tone = job.ai ? (value >= 70 ? 'bg-good-soft text-good' : value >= 45 ? 'bg-brand-soft text-brand' : 'bg-bg text-muted')
    : (value >= 25 ? 'bg-good-soft text-good' : value >= 10 ? 'bg-brand-soft text-brand' : 'bg-bg text-muted');
  return (
    <div className={`flex w-14 shrink-0 flex-col items-center rounded-xl py-2 ${tone}`} title={job.ai ? 'Mức phù hợp do AI chấm (0–100)' : 'Điểm theo từ khoá trong hồ sơ của bạn'}>
      <span className="text-lg leading-none font-bold">{value}</span>
      <span className="mt-1 text-[10px] font-semibold tracking-wide uppercase opacity-80">{job.ai ? 'AI' : 'điểm'}</span>
    </div>
  );
}

function JobCard({ job, ai, pro, highlights, onRetry, watch, onStatus, onKit, onAiScore, onReport }: {
  job: Job;
  ai: boolean;
  pro: boolean;
  highlights: string[] | 'loading' | 'error' | 'limited' | undefined;
  onRetry: () => void;
  watch: (el: HTMLElement | null) => void;
  onStatus: (s: Status) => void;
  onKit: () => void;
  onAiScore: () => Promise<void>;
  onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scoring, setScoring] = useState(false);
  const meta = [job.source, job.company, job.kind, job.bidCount != null ? `${job.bidCount} người đã bid` : '', ago(job.postedAt)].filter(Boolean);
  return (
    <article ref={watch} data-job-id={job.id} className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${job.regionOk ? '' : 'opacity-75'}`}>
      <div className="flex gap-4">
        <ScoreBadge job={job} />
        <div className="min-w-0 flex-1">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-[17px] leading-snug font-semibold hover:text-brand">{job.title}</a>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            {job.budgetText && <span className="font-semibold text-good">{job.budgetText}</span>}
            {meta.map((m) => <span key={m}>{m}</span>)}
            {job.location && <span className={job.regionOk ? '' : 'text-warn'}>{job.regionOk ? '📍' : '⛔'} {job.location}</span>}
          </div>
          {(job.matched.length > 0 || job.vietnameseClient || job.flag || (job.ai && job.ai.scam !== 'low')) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.flag === 'verified' && <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-xs font-semibold text-good" title="Đội JobRadar đã kiểm tra job này">✓ Đã xác minh</span>}
              {job.flag === 'scam' && <span className="rounded-full bg-warn px-2.5 py-0.5 text-xs font-semibold text-surface">⛔ Đã xác nhận lừa đảo</span>}
              {job.ai?.scam === 'high' && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">⚠️ Nghi lừa đảo</span>}
              {job.ai?.scam === 'medium' && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">⚠️ Cần cẩn thận</span>}
              {job.vietnameseClient && <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-xs font-semibold text-good">🇻🇳 Khách Việt</span>}
              {job.matched.filter((m) => m !== 'Khách Việt').map((m) => <span key={m} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">{m}</span>)}
            </div>
          )}
        </div>
      </div>

      {job.ai && (
        <div className="mt-4 rounded-xl bg-brand-soft/60 px-4 py-3 text-sm">
          <span className="font-semibold">🤖 {job.ai.reason}</span>
          {job.ai.flags.length > 0 && <div className="mt-1 text-warn">⚠️ {job.ai.flags.join('; ')}</div>}
        </div>
      )}

      {ai && (
        <div className="mt-4 rounded-r-xl border-l-3 border-brand bg-bg px-4 py-3">
          <div className="text-xs font-semibold tracking-wide text-brand uppercase">Điểm chính</div>
          {Array.isArray(highlights) ? (
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">{highlights.map((p, i) => <li key={i}>{p}</li>)}</ul>
          ) : highlights === 'limited' ? (
            <div className="mt-2 text-sm text-muted">Bạn đã dùng hết 20 lượt tóm tắt miễn phí hôm nay. <Link to="/pricing" className="font-semibold text-brand hover:underline">Nâng cấp Pro</Link> để tóm tắt không giới hạn.</div>
          ) : highlights === 'error' ? (
            <div className="mt-2 text-sm text-muted">Chưa tóm tắt được. <button onClick={onRetry} className="font-semibold text-brand hover:underline">Thử lại</button></div>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted"><Spinner /> Đang tóm tắt…</div>
          )}
        </div>
      )}

      {job.description && (
        <div className="mt-3">
          <button onClick={() => setOpen(!open)} className="text-sm font-medium text-muted hover:text-text">{open ? '▾ Ẩn mô tả gốc' : '▸ Xem mô tả gốc'}</button>
          {open && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted [overflow-wrap:anywhere]">{job.description}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {ai && pro && <Button variant="primary" onClick={onKit}>{job.hasKit ? '📄 Xem bộ apply' : '✍️ Chuẩn bị apply'}</Button>}
        {ai && pro && !job.ai && <Button busy={scoring} onClick={async () => { setScoring(true); await onAiScore(); setScoring(false); }}>🤖 AI chấm</Button>}
        {ai && !pro && <Button onClick={() => navigate('/pricing')} title="Có trong gói Pro">✍️ Chuẩn bị apply <span className="rounded bg-brand-soft px-1.5 text-[10px] font-bold text-brand">PRO</span></Button>}
        {job.status === 'saved' ? <Button onClick={() => onStatus('new')}>Bỏ lưu</Button> : <Button onClick={() => onStatus('saved')}>⭐ Lưu</Button>}
        {job.status !== 'applied' && <Button onClick={() => onStatus('applied')}>✅ Đã nộp</Button>}
        {job.status === 'hidden' ? <Button onClick={() => onStatus('new')}>Hiện lại</Button> : <Button onClick={() => onStatus('hidden')}>🙈 Ẩn</Button>}
        <span className="ml-auto flex items-center gap-4 self-center">
          <button onClick={onReport} className="text-sm text-muted hover:text-warn" title="Báo cáo job lừa đảo, hết hạn, sai thông tin, hoặc nhờ kiểm tra">⚑ Báo cáo</button>
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">Mở job ↗</a>
        </span>
      </div>
    </article>
  );
}

// ---- The page ----

export function FeedPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<Status>('new');
  const [sort, setSort] = useState('fit');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [regionOnly, setRegionOnly] = useState<boolean | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [kitJob, setKitJob] = useState<Job | null>(null);
  const [reportJob, setReportJob] = useState<Job | null>(null);
  const ads = useAds();

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ tab, sort, source, q: query });
    if (regionOnly !== null) p.set('regionOnly', regionOnly ? '1' : '0');
    try {
      const data = await api<Feed>(`/api/feed?${p}`);
      setFeed(data);
      if (regionOnly === null) setRegionOnly(data.regionOnly);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [tab, sort, source, query, regionOnly]);

  useEffect(() => { setShown(PAGE); load(); }, [load]);

  const { watch, get, retry } = useHighlights(Boolean(feed?.ai), feed?.jobs ?? []);

  const patch = (id: string, change: Partial<Job>) => setFeed((f) => f && { ...f, jobs: f.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) });

  const setStatus = async (job: Job, status: Status) => {
    // Leave the current tab at once; the counts catch up on the next load.
    setFeed((f) => f && {
      ...f,
      jobs: f.jobs.filter((j) => j.id !== job.id || status === tab),
      counts: { ...f.counts, [job.status]: f.counts[job.status] - 1, [status]: f.counts[status] + 1 },
    });
    await api(`/api/feed/${encodeURIComponent(job.id)}/status`, { body: { status } }).catch(() => load());
  };

  const aiScore = async (job: Job) => {
    try {
      const r = await api<{ ai: Job['ai'] }>(`/api/feed/${encodeURIComponent(job.id)}/ai-score`, { body: {} });
      patch(job.id, { ai: r.ai });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const firstName = (user?.name || '').trim().split(/\s+/).pop();
  const jobs = feed?.jobs ?? [];
  return (
    <AppLayout>
      <div className="space-y-5">
        <VerifyBanner />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Chào {firstName || 'bạn'} 👋</h1>
            <p className="mt-1 text-muted">{feed ? `${feed.counts.new} job mới dành cho bạn trong 3 tuần qua.` : 'Đang tải job…'}</p>
          </div>
          <Link to="/profile" className="text-sm font-semibold text-brand hover:underline">Sửa hồ sơ</Link>
        </div>

        {feed && !feed.hasProfile && (
          <Card className="flex flex-wrap items-center justify-between gap-4 border-brand/40 bg-brand-soft">
            <div>
              <div className="font-semibold">Tạo hồ sơ để thấy job hợp với bạn</div>
              <div className="text-sm text-muted">Chưa có hồ sơ nên job chưa được xếp theo kỹ năng của bạn. Mất khoảng 2 phút.</div>
            </div>
            <Link to="/onboarding" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Tạo hồ sơ</Link>
          </Card>
        )}

        <div className="sticky top-[61px] z-[5] -mx-4 space-y-3 border-b border-line bg-bg/95 px-4 pt-1 pb-3 backdrop-blur">
          <div role="tablist" className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${tab === t.id ? 'bg-text text-bg' : 'text-muted hover:bg-surface hover:text-text'}`}>
                {t.label}{feed ? <span className="ml-1.5 opacity-70">{feed.counts[t.id]}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo từ khoá…" aria-label="Tìm job"
              className="min-w-0 flex-1 basis-48 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm focus:border-brand focus:outline-none" />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Xếp theo" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Nguồn" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <option value="">Mọi nguồn</option>
              {feed?.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="w-full sm:w-auto sm:pl-2">
              <Toggle checked={regionOnly ?? true} onChange={setRegionOnly} label="Chỉ nhận người ở VN" />
            </div>
          </div>
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {!feed && !error && <div className="py-16 text-center text-brand"><Spinner /></div>}
        {feed && jobs.length === 0 && (
          <Card className="py-12 text-center text-muted">
            {tab === 'new' ? (query || source ? 'Không có job nào khớp bộ lọc.' : 'Chưa có job mới phù hợp. JobRadar quét các trang mỗi giờ, quay lại sau nhé.')
              : tab === 'saved' ? 'Bạn chưa lưu job nào.' : tab === 'applied' ? 'Bạn chưa đánh dấu job nào là đã nộp.' : 'Không có job nào bị ẩn.'}
          </Card>
        )}
        <div className="space-y-3">
          {jobs.slice(0, shown).map((job, i) => (
            <Fragment key={job.id}>
            {ads.show && i > 0 && i % 8 === 0 && <AdCard google={ads.google} />}
            <JobCard key={job.id} job={job} ai={Boolean(feed?.ai)} pro={Boolean(user?.proFeatures)} highlights={get(job)} onRetry={() => retry(job.id)} watch={watch}
              onStatus={(s) => setStatus(job, s)} onKit={() => setKitJob(job)} onAiScore={() => aiScore(job)} onReport={() => setReportJob(job)} />
            </Fragment>
          ))}
        </div>
        {jobs.length > shown && (
          <div className="text-center"><Button onClick={() => setShown(shown + PAGE)}>Xem thêm ({jobs.length - shown} job)</Button></div>
        )}
        {feed && feed.total > jobs.length && jobs.length <= shown && (
          <p className="text-center text-sm text-muted">Đang hiện {jobs.length} job phù hợp nhất trong {feed.total}. Dùng ô tìm kiếm để thu hẹp.</p>
        )}
        <p className="pt-4 text-center text-xs text-muted">
          Dữ liệu từ Freelancer.com, Remotive, Remote OK, Himalayas, Jobicy và We Work Remotely. Mỗi job dẫn về trang gốc để bạn tự nộp đơn.
        </p>
      </div>
      {ads.askConsent && <AdsConsent decide={ads.decide} />}
      <ReportDialog job={reportJob} onClose={() => setReportJob(null)} />
      <KitDialog job={kitJob} onClose={() => setKitJob(null)} onSaved={(id) => patch(id, { hasKit: true })} />
    </AppLayout>
  );
}
