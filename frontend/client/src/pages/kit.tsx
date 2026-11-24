// The "apply kit": everything the AI drafted for one job, each part with a Copy button.
// The user reads, edits and sends it themselves; JobRadar never applies on their behalf.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Spinner, api } from '@jobradar/shared';

export type Kit = {
  language?: string;
  job_summary_vi?: string;
  subject_line?: string;
  proposal?: string;
  bid?: { amount?: number; currency?: string; unit?: string; delivery_days?: number; rationale_vi?: string };
  milestones?: { title: string; amount?: number; days?: number }[];
  screening_answers?: { question: string; answer: string }[];
  questions_for_client?: string[];
  profile_highlights?: string[];
  missing_info_vi?: string[];
  tips_vi?: string[];
  model?: string;
  created_at?: string;
};

const UNIT: Record<string, string> = { fixed: 'trọn gói', hourly: '/giờ', monthly_salary: '/tháng', yearly_salary: '/năm' };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
      {done ? '✓ Đã copy' : 'Copy'}
    </button>
  );
}

function Part({ title, copy, tone, children }: { title: string; copy?: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <section className={`rounded-xl border p-4 ${tone === 'warn' ? 'border-warn/40 bg-warn-soft' : 'border-line'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className={`text-xs font-semibold tracking-wide uppercase ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{title}</h3>
        {copy && <CopyButton text={copy} />}
      </div>
      <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{children}</div>
    </section>
  );
}

const bullets = (items: string[]) => <ul className="list-disc space-y-1 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export function KitDialog({ job, onClose, onSaved }: { job: { id: string; title: string; url: string } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kit, setKit] = useState<Kit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (regenerate: boolean) => {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ kit: Kit }>(`/api/feed/${encodeURIComponent(job.id)}/apply-kit`, { body: { regenerate }, timeoutMs: 150000 });
      setKit(r.kit);
      onSaved(job.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!job) return;
    setKit(null);
    ref.current?.showModal();
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const b = kit?.bid ?? {};
  return (
    <dialog ref={ref} onClose={onClose}
      className="m-auto max-h-[calc(100vh-2rem)] w-[min(780px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-0 text-text backdrop:bg-black/50">
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold tracking-wide text-brand uppercase">Chuẩn bị apply</div>
          <h2 className="mt-0.5 truncate text-lg font-semibold">{job?.title}</h2>
        </div>
        <Button onClick={() => load(true)} disabled={busy}>↻ Viết lại</Button>
        <Button onClick={() => ref.current?.close()}>Đóng</Button>
      </div>
      <div className="space-y-3 px-5 py-5">
        {busy && <Alert><span className="inline-flex items-center gap-2"><Spinner /> AI đang đọc job và soạn bộ apply, thường mất 10–40 giây…</span></Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {kit && !busy && (
          <>
            <p className="text-sm text-muted">
              Đây là bản nháp. Đọc lại, sửa cho đúng với bạn rồi tự gửi trên{' '}
              <a href={job?.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">trang job ↗</a>.
              {kit.created_at && <> Soạn lúc {new Date(kit.created_at).toLocaleString('vi-VN')}.</>}
            </p>
            {kit.job_summary_vi && <Part title="Khách cần gì">{kit.job_summary_vi}</Part>}
            {kit.missing_info_vi?.length ? <Part title="⚠️ Bạn cần điền hoặc kiểm tra trước khi gửi" tone="warn">{bullets(kit.missing_info_vi)}</Part> : null}
            {kit.subject_line && <Part title="Tiêu đề / dòng mở đầu" copy={kit.subject_line}>{kit.subject_line}</Part>}
            {kit.proposal && <Part title="Proposal / cover letter" copy={kit.proposal}>{kit.proposal}</Part>}
            {b.amount != null && (
              <Part title="Giá đề xuất" copy={String(b.amount)}>
                <div className="font-semibold">{b.amount} {b.currency} {UNIT[b.unit ?? ''] ?? b.unit}{b.delivery_days ? ` · giao trong ${b.delivery_days} ngày` : ''}</div>
                {b.rationale_vi && <div className="mt-1 text-sm text-muted">{b.rationale_vi}</div>}
              </Part>
            )}
            {kit.milestones?.length ? (() => {
              const text = kit.milestones.map((m, i) => `${i + 1}. ${m.title}${m.amount != null ? ` — ${m.amount} ${b.currency ?? ''}` : ''}${m.days ? ` (${m.days} ngày)` : ''}`).join('\n');
              return <Part title="Milestones" copy={text}>{text}</Part>;
            })() : null}
            {kit.screening_answers?.length ? (
              <Part title="Câu hỏi trong form và câu trả lời">
                <div className="space-y-4">
                  {kit.screening_answers.map((qa, i) => (
                    <div key={i}>
                      <div className="flex items-start justify-between gap-3"><b className="text-sm">{qa.question}</b><CopyButton text={qa.answer} /></div>
                      <div className="mt-1">{qa.answer}</div>
                    </div>
                  ))}
                </div>
              </Part>
            ) : null}
            {kit.questions_for_client?.length ? <Part title="Câu nên hỏi lại khách" copy={kit.questions_for_client.join('\n')}>{bullets(kit.questions_for_client)}</Part> : null}
            {kit.profile_highlights?.length ? <Part title="Điểm mạnh nên nêu" copy={kit.profile_highlights.map((x) => `• ${x}`).join('\n')}>{bullets(kit.profile_highlights)}</Part> : null}
            {kit.tips_vi?.length ? <Part title="Mẹo cho job này">{bullets(kit.tips_vi)}</Part> : null}
          </>
        )}
      </div>
    </dialog>
  );
}
