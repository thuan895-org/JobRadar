import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Alert, Button, Card, Field, Pills, Spinner, TagInput, TextArea, Toggle, api, ApiError } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { Link, navigate } from '../router';

// ---- Types shared with the server (/api/profile) ----

type Level = 'main' | 'good' | 'some';
type CatalogSkill = { id: string; level: Level };
type CustomSkill = { label: string; weight: number; terms: string[]; requireAny?: string[] };
type Answers = { years?: string; english?: string; workTypes?: string[]; hourlyRate?: number | null };
type Profile = {
  skills: (CatalogSkill | CustomSkill)[];
  exclude_terms: string[];
  answers: Answers;
  summary: string;
  region_only: boolean;
  min_budget_usd: number;
  cv_name: string | null;
  cv_uploaded_at: string | null;
  updated_at?: string;
};
type ProfileResponse = { profile: Profile; catalog: { id: string; label: string }[] };
export type Draft = { skills: CatalogSkill[]; extraKeywords: string[]; years?: string; english?: string; intro: string; headline?: string };

const KEYWORDS_LABEL = 'Từ khoá riêng';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'main', label: 'Thế mạnh' },
  { value: 'good', label: 'Khá' },
  { value: 'some', label: 'Biết chút' },
];
const YEARS = [
  { value: '0-1', label: 'Dưới 1 năm' }, { value: '1-3', label: '1–3 năm' }, { value: '3-5', label: '3–5 năm' },
  { value: '5-10', label: '5–10 năm' }, { value: '10+', label: 'Trên 10 năm' },
];
const ENGLISH = [
  { value: 'basic', label: 'Cơ bản' }, { value: 'reading', label: 'Đọc viết tốt' },
  { value: 'conversational', label: 'Giao tiếp được' }, { value: 'fluent', label: 'Thành thạo' },
];
const WORK = [
  { value: 'project', label: 'Dự án trọn gói' }, { value: 'hourly', label: 'Freelance theo giờ' },
  { value: 'parttime', label: 'Part-time remote' }, { value: 'fulltime', label: 'Full-time remote' },
];

const isCatalog = (s: CatalogSkill | CustomSkill): s is CatalogSkill => 'id' in s;

function Step({ n, title, text, children }: { n: number; title: string; text?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {text && <p className="mt-0.5 text-sm text-muted">{text}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </Card>
  );
}

/** The whole profile: used in onboarding (optionally prefilled from a CV) and on the profile page. */
function ProfileForm({ initial, catalog, draft, submitLabel, onSaved }: {
  initial: Profile;
  catalog: { id: string; label: string }[];
  draft?: Draft | null;
  submitLabel: string;
  onSaved: () => void;
}) {
  const keywordGroup = initial.skills.find((s) => !isCatalog(s) && s.label === KEYWORDS_LABEL) as CustomSkill | undefined;
  const otherCustom = initial.skills.filter((s) => !isCatalog(s) && s.label !== KEYWORDS_LABEL) as CustomSkill[];
  const [skills, setSkills] = useState<CatalogSkill[]>(draft?.skills.length ? draft.skills : initial.skills.filter(isCatalog));
  const [custom, setCustom] = useState<CustomSkill[]>(otherCustom);
  const [keywords, setKeywords] = useState<string[]>([...new Set([...(keywordGroup?.terms ?? []), ...(draft?.extraKeywords ?? [])])]);
  const [exclude, setExclude] = useState<string[]>(initial.exclude_terms ?? []);
  const [answers, setAnswers] = useState<Answers>({ ...initial.answers, ...(draft?.years ? { years: draft.years } : {}), ...(draft?.english ? { english: draft.english } : {}) });
  const [summary, setSummary] = useState(initial.summary || draft?.intro || '');
  const [regionOnly, setRegionOnly] = useState(initial.region_only ?? true);
  const [minBudget, setMinBudget] = useState(String(initial.min_budget_usd ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const level = (id: string) => skills.find((s) => s.id === id)?.level;
  const toggleSkill = (id: string) => setSkills(level(id) ? skills.filter((s) => s.id !== id) : [...skills, { id, level: 'good' }]);
  const setLevel = (id: string, l: Level) => setSkills(skills.map((s) => (s.id === id ? { ...s, level: l } : s)));
  const hasAnySkill = skills.length + custom.length + keywords.length > 0;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/profile', {
        body: {
          skills: [...skills, ...custom, ...(keywords.length ? [{ label: KEYWORDS_LABEL, level: 'main', terms: keywords }] : [])],
          excludeTerms: exclude,
          answers: { ...answers, hourlyRate: answers.hourlyRate ? Number(answers.hourlyRate) : null },
          summary,
          regionOnly,
          minBudgetUsd: Number(minBudget) || 0,
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {draft && <Alert kind="success">AI đã điền sẵn từ CV của bạn{draft.headline ? `: ${draft.headline}` : ''}. Kiểm tra lại, sửa chỗ chưa đúng rồi bấm lưu.</Alert>}

      <Step n={1} title="Bạn làm được những việc gì?" text="Chọn tất cả lĩnh vực phù hợp, rồi chọn mức độ cho từng cái.">
        <div className="flex flex-wrap gap-2">
          {catalog.map((c) => (
            <button key={c.id} type="button" aria-pressed={Boolean(level(c.id))} onClick={() => toggleSkill(c.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${level(c.id) ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:border-brand'}`}>
              {level(c.id) ? '✓ ' : ''}{c.label}
            </button>
          ))}
        </div>
        {skills.length > 0 && (
          <div className="mt-5 divide-y divide-line rounded-xl border border-line">
            {skills.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium">{catalog.find((c) => c.id === s.id)?.label}</span>
                <Pills options={LEVELS} value={s.level} onChange={(l: Level) => setLevel(s.id, l)} label={`Mức độ ${s.id}`} />
              </div>
            ))}
          </div>
        )}
        {custom.length > 0 && (
          <div className="mt-4 text-sm">
            <span className="text-muted">Nhóm kỹ năng riêng: </span>
            {custom.map((c) => (
              <span key={c.label} className="mr-2 inline-flex items-center gap-1 rounded-md bg-bg px-2 py-1">
                {c.label}
                <button type="button" aria-label={`Bỏ ${c.label}`} onClick={() => setCustom(custom.filter((x) => x !== c))} className="text-muted hover:text-text">×</button>
              </span>
            ))}
          </div>
        )}
      </Step>

      <Step n={2} title="Kinh nghiệm và tiếng Anh">
        <div className="space-y-5">
          <div><div className="mb-2 text-sm font-medium">Số năm kinh nghiệm</div><Pills options={YEARS} value={answers.years ?? null} onChange={(v) => setAnswers({ ...answers, years: v })} label="Số năm kinh nghiệm" /></div>
          <div><div className="mb-2 text-sm font-medium">Tiếng Anh</div><Pills options={ENGLISH} value={answers.english ?? null} onChange={(v) => setAnswers({ ...answers, english: v })} label="Tiếng Anh" /></div>
        </div>
      </Step>

      <Step n={3} title="Bạn muốn làm theo hình thức nào?" text="Chọn một hoặc nhiều.">
        <div className="space-y-5">
          <Pills options={WORK} multiple value={answers.workTypes ?? []} onChange={(v) => setAnswers({ ...answers, workTypes: v })} label="Hình thức" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Giá mong muốn (USD/giờ)" type="number" min={0} max={500} inputMode="numeric" placeholder="ví dụ 20"
              value={answers.hourlyRate ?? ''} onChange={(e) => setAnswers({ ...answers, hourlyRate: e.target.value ? Number(e.target.value) : null })} />
            <Field label="Bỏ qua dự án dưới (USD)" type="number" min={0} inputMode="numeric" value={minBudget} onChange={(e) => setMinBudget(e.target.value)}
              hint="Job có ngân sách thấp hơn sẽ bị xếp xuống." />
          </div>
          <Toggle checked={regionOnly} onChange={setRegionOnly} label="Chỉ hiện job nhận người ở Việt Nam" hint="Ẩn job giới hạn quốc gia khác (ví dụ chỉ nhận người ở Mỹ)." />
        </div>
      </Step>

      <Step n={4} title="Từ khoá" text="Giúp lọc chính xác hơn. Gõ rồi nhấn Enter.">
        <div className="space-y-5">
          <TagInput label="Công nghệ, công cụ bạn dùng" value={keywords} onChange={setKeywords} placeholder="ví dụ: twilio, nestjs, figma" hint="Job có các từ này trong tiêu đề sẽ được xếp lên trên." />
          <TagInput label="Không muốn thấy job có từ" value={exclude} onChange={setExclude} placeholder="ví dụ: sales, crypto" hint="Job có các từ này trong tiêu đề sẽ bị xếp xuống." />
        </div>
      </Step>

      <Step n={5} title="Giới thiệu ngắn về bạn" text="AI dùng đoạn này khi soạn proposal. Không bắt buộc.">
        <TextArea label="Giới thiệu" maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)}
          placeholder="Ví dụ: Mình là backend developer 5 năm, chuyên Node.js và tích hợp tổng đài. Đã làm hệ thống gọi tự động cho 3 công ty..." />
      </Step>

      {error && <Alert kind="error">{error}</Alert>}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <span className="text-sm text-muted">{hasAnySkill ? 'Lưu xong là có danh sách job dành cho bạn.' : 'Chọn ít nhất một lĩnh vực hoặc từ khoá.'}</span>
        <Button variant="primary" busy={busy} type="submit" disabled={!hasAnySkill}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function useProfile() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState('');
  const load = () => api<ProfileResponse>('/api/profile').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return { data, error, reload: load };
}

// ---- CV upload ----

function CvUpload({ onDone, onSkip }: { onDone: (draft: Draft) => void; onSkip: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return setError('Chỉ nhận CV dạng PDF.');
    if (f.size > 2 * 1048576) return setError('CV tối đa 2 MB.');
    setFile(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/profile/cv?analyze=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name), 'X-AI-Consent': 'yes' },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error ?? `Lỗi ${res.status}`);
      onDone(data.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${over ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand'}`}>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <div className="text-3xl" aria-hidden="true">📄</div>
        <div className="mt-2 font-medium">{file ? file.name : 'Kéo CV vào đây hoặc bấm để chọn'}</div>
        <div className="mt-1 text-sm text-muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : 'PDF, tối đa 2 MB'}</div>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Tôi đồng ý lưu CV trong tài khoản và gửi CV cho Google Gemini để phân tích, như mô tả trong <Link to="/privacy" className="text-brand underline">Chính sách quyền riêng tư</Link>. Tôi có thể xoá CV bất cứ lúc nào.</span>
      </label>
      <p className="text-xs text-muted">Mẹo: bỏ số điện thoại, địa chỉ nhà và số CCCD khỏi CV trước khi tải lên; JobRadar không cần chúng.</p>
      {error && <Alert kind="error">{error}</Alert>}
      {busy && <Alert><span className="inline-flex items-center gap-2"><Spinner /> AI đang đọc CV, thường mất 10–40 giây…</span></Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" busy={busy} disabled={!file || !consent} onClick={analyze}>Phân tích CV</Button>
        <Button onClick={onSkip} disabled={busy}>Điền bảng hỏi thay vì vậy</Button>
      </div>
    </Card>
  );
}

// ---- Pages ----

export function Onboarding() {
  const { data, error } = useProfile();
  const [mode, setMode] = useState<'choose' | 'cv' | 'form'>('choose');
  const [draft, setDraft] = useState<Draft | null>(null);
  if (error) return <AppLayout><Alert kind="error">{error}</Alert></AppLayout>;
  if (!data) return <AppLayout><div className="py-20 text-center text-brand"><Spinner /></div></AppLayout>;
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tạo hồ sơ của bạn</h1>
        <p className="mt-2 text-muted">JobRadar dùng hồ sơ để chọn job hợp với bạn và để AI soạn hồ sơ ứng tuyển.</p>
        <div className="mt-8">
          {mode === 'choose' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['📄', 'Tải CV lên', 'AI đọc CV và điền sẵn hồ sơ, bạn chỉ cần kiểm tra lại.', 'cv'],
                ['📝', 'Trả lời câu hỏi', 'Khoảng 2 phút, không cần CV.', 'form'],
              ].map(([icon, title, text, m]) => (
                <button key={m} onClick={() => setMode(m as 'cv' | 'form')}
                  className="group rounded-2xl border border-line bg-surface p-6 text-left transition hover:border-brand hover:shadow-sm">
                  <div className="text-3xl" aria-hidden="true">{icon}</div>
                  <div className="mt-4 text-lg font-semibold group-hover:text-brand">{title}</div>
                  <p className="mt-1 text-sm text-muted">{text}</p>
                </button>
              ))}
            </div>
          )}
          {mode === 'cv' && <CvUpload onDone={(d) => { setDraft(d); setMode('form'); }} onSkip={() => setMode('form')} />}
          {mode === 'form' && <ProfileForm initial={data.profile} catalog={data.catalog} draft={draft} submitLabel="Lưu và xem job" onSaved={() => navigate('/', { replace: true })} />}
        </div>
      </div>
    </AppLayout>
  );
}

export function ProfilePage() {
  const { data, error, reload } = useProfile();
  const [saved, setSaved] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  if (error) return <AppLayout><Alert kind="error">{error}</Alert></AppLayout>;
  if (!data) return <AppLayout><div className="py-20 text-center text-brand"><Spinner /></div></AppLayout>;
  const cv = data.profile;
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hồ sơ</h1>
            <p className="mt-1 text-sm text-muted">Sửa hồ sơ là danh sách job được xếp lại ngay.</p>
          </div>
          <Link to="/onboarding" className="text-sm font-semibold text-brand hover:underline">Tải CV mới để AI điền lại</Link>
        </div>
        {saved && <Alert kind="success">Đã lưu hồ sơ.</Alert>}
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">CV</div>
            <div className="text-sm text-muted">{cv.cv_name ? `${cv.cv_name} · tải lên ${new Date(cv.cv_uploaded_at!).toLocaleDateString('vi-VN')}` : 'Chưa có CV.'}</div>
          </div>
          {cv.cv_name && (
            <div className="flex gap-2">
              <a href="/api/profile/cv" className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-brand">Tải về</a>
              <Button variant="danger" busy={cvBusy} onClick={async () => { setCvBusy(true); await api('/api/profile/cv/remove', { body: {} }).catch(() => {}); await reload(); setCvBusy(false); }}>Xoá CV</Button>
            </div>
          )}
        </Card>
        <ProfileForm key={data.profile.updated_at} initial={data.profile} catalog={data.catalog} submitLabel="Lưu hồ sơ"
          onSaved={() => { setSaved(true); window.scrollTo(0, 0); reload(); }} />
      </div>
    </AppLayout>
  );
}
