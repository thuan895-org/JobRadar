// "Report this job": scam, expired, wrong details, or ask the team to check it.
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Pills, TextArea, api } from '@jobradar/shared';

const KINDS = [
  { value: 'scam', label: '⚠️ Có dấu hiệu lừa đảo' },
  { value: 'expired', label: '⌛ Hết hạn / link hỏng' },
  { value: 'wrong', label: '✏️ Sai thông tin' },
  { value: 'verify', label: '🔍 Nhờ kiểm tra giúp' },
];

export function ReportDialog({ job, onClose }: { job: { id: string; title: string } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState('scam');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!job) return;
    setKind('scam'); setNote(''); setState('idle'); setError('');
    ref.current?.showModal();
  }, [job?.id]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(520px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-0 text-text backdrop:bg-black/50">
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        setError('');
        try {
          await api(`/api/feed/${encodeURIComponent(job!.id)}/report`, { body: { kind, note } });
          setState('done');
        } catch (err) {
          setError((err as Error).message);
          setState('idle');
        }
      }}>
        <div>
          <div className="text-xs font-semibold tracking-wide text-brand uppercase">Báo cáo job</div>
          <h2 className="mt-0.5 font-semibold">{job?.title}</h2>
        </div>
        {state === 'done' ? (
          <>
            <Alert kind="success">Cảm ơn bạn! Đội JobRadar sẽ kiểm tra. Job bị xác nhận lừa đảo sẽ được gỡ khỏi danh sách của mọi người.</Alert>
            <div className="text-right"><Button type="button" onClick={() => ref.current?.close()}>Đóng</Button></div>
          </>
        ) : (
          <>
            <Pills options={KINDS} value={kind} onChange={setKind} label="Lý do" />
            <TextArea label="Chi tiết (không bắt buộc)" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'scam' ? 'Ví dụ: đòi chuyển phí trước, yêu cầu nhắn qua Telegram…' : ''} />
            {error && <Alert kind="error">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => ref.current?.close()}>Huỷ</Button>
              <Button variant="primary" type="submit" busy={state === 'busy'}>Gửi báo cáo</Button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
