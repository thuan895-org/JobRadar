// Plans (Free / Pro), the checkout page, and personal Telegram settings.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Pills, Spinner, Toggle, api, daysLeft, type User } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { Link, navigate } from '../router';
import { useSession } from '../session';

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');

/** Small badge for the top bar: trial days left, Pro, or Free with an upgrade link. */
export function PlanBadge({ user }: { user: User }) {
  const look = user.plan === 'free' ? 'bg-bg text-muted' : 'bg-good-soft text-good';
  const text = user.plan === 'pro' ? 'Pro' : user.plan === 'trial' ? `Dùng thử · ${daysLeft(user.trialEndsAt)} ngày` : 'Free · Nâng cấp';
  return <Link to="/pricing" className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap sm:inline-block ${look}`}>{text}</Link>;
}

const FEATURES: [string, boolean, boolean][] = [
  ['Danh sách job nhận người ở Việt Nam, xếp theo hồ sơ của bạn', true, true],
  ['Lưu, ẩn, đánh dấu đã nộp', true, true],
  ['Tóm tắt 10 điểm chính bằng tiếng Việt', true, true],
  ['Bản tin job hằng ngày trên channel Telegram chung', true, true],
  ['Không giới hạn số tóm tắt mỗi ngày (Free: 20 job/ngày)', false, true],
  ['AI chấm mức phù hợp và cảnh báo lừa đảo', false, true],
  ['AI soạn bộ apply: proposal, giá đề xuất, câu trả lời form', false, true],
  ['Telegram riêng: báo ngay job hợp hồ sơ, có giờ nghỉ', false, true],
];

export function PricingPage() {
  const { user, config } = useSession();
  const price = config?.priceVnd ?? 79000;
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Chọn gói phù hợp</h1>
          <p className="mt-2 text-muted">Tài khoản mới được dùng thử mọi tính năng trong 7 ngày.</p>
          {user?.plan === 'trial' && <p className="mt-3 inline-block rounded-full bg-good-soft px-3 py-1 text-sm font-semibold text-good">Bạn đang dùng thử, còn {daysLeft(user.trialEndsAt)} ngày</p>}
          {user?.plan === 'pro' && <p className="mt-3 inline-block rounded-full bg-good-soft px-3 py-1 text-sm font-semibold text-good">Bạn đang dùng Pro đến {date(user.proUntil)}</p>}
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {[
            { name: 'Free', price: '0đ', sub: 'mãi mãi', pro: false },
            { name: 'Pro', price: vnd(price), sub: '/ tháng', pro: true },
          ].map((p) => (
            <Card key={p.name} className={p.pro ? 'relative border-2 border-brand' : ''}>
              {p.pro && <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand">Khuyên dùng</span>}
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <div className="mt-2"><span className="text-3xl font-bold">{p.price}</span> <span className="text-muted">{p.sub}</span></div>
              <ul className="mt-6 space-y-2.5 text-sm">
                {FEATURES.map(([text, free, pro]) => {
                  const on = p.pro ? pro : free;
                  return <li key={text} className={`flex gap-2 ${on ? '' : 'text-muted line-through decoration-line'}`}><span aria-hidden="true">{on ? '✓' : '–'}</span>{text}</li>;
                })}
              </ul>
              <div className="mt-6">
                {p.pro
                  ? <Button variant="primary" block onClick={() => navigate('/checkout')}>{user?.plan === 'pro' ? 'Gia hạn thêm 1 tháng' : 'Nâng cấp lên Pro'}</Button>
                  : <Button block disabled>{user?.plan === 'free' ? 'Gói hiện tại' : 'Sau khi hết dùng thử'}</Button>}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

type Checkout = { mode: string; priceVnd: number; days: number; transferNote: string; bank: { name: string; account: string; holder: string } };

export function CheckoutPage() {
  const { setUser } = useSession();
  const [info, setInfo] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<Checkout>('/api/billing/checkout').then(setInfo).catch((e) => setError(e.message)); }, []);
  const mock = info?.mode === 'mock';
  return (
    <AppLayout>
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Thanh toán gói Pro</h1>
        {error && <Alert kind="error">{error}</Alert>}
        {!info && !error && <div className="py-10 text-center text-brand"><Spinner /></div>}
        {info && (
          <>
            {mock && <Alert>🧪 <b>Chế độ thử nghiệm:</b> thông tin chuyển khoản bên dưới chỉ là mẫu và <b>không thu tiền</b>. Bấm nút xác nhận để bật Pro {info.days} ngày.</Alert>}
            <Card className="space-y-5">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">Pro · {info.days} ngày</span>
                <span className="text-2xl font-bold">{vnd(info.priceVnd)}</span>
              </div>
              <div className="grid place-items-center rounded-xl border border-dashed border-line bg-bg py-8">
                <div aria-hidden="true" className="grid size-40 grid-cols-8 gap-0.5 rounded-lg bg-white p-2">
                  {Array.from({ length: 64 }, (_, i) => <span key={i} className={(i * 7 + (i >> 3) * 3) % 5 < 2 ? 'bg-black' : ''} />)}
                </div>
                <div className="mt-3 text-sm text-muted">{mock ? 'Mã VietQR mẫu' : 'Quét mã bằng ứng dụng ngân hàng'}</div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Ngân hàng</dt><dd className="font-medium">{info.bank.name}</dd>
                <dt className="text-muted">Số tài khoản</dt><dd className="font-mono font-medium">{info.bank.account}</dd>
                <dt className="text-muted">Chủ tài khoản</dt><dd className="font-medium">{info.bank.holder}</dd>
                <dt className="text-muted">Nội dung</dt><dd className="font-mono font-semibold text-brand">{info.transferNote}</dd>
              </dl>
              {mock ? (
                <Button variant="primary" block busy={busy} onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setUser((await api<{ user: User }>('/api/billing/mock-pay', { body: {} })).user);
                    navigate('/pricing');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}>Xác nhận đã thanh toán (thử nghiệm)</Button>
              ) : (
                <p className="text-sm text-muted">Sau khi chuyển khoản với đúng nội dung trên, gói Pro được kích hoạt trong vòng 24 giờ.</p>
              )}
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}

type TgSettings = { quietEnabled: boolean; quietStart: string; quietEnd: string; timezone: string; minScore: number };

export function TelegramPage() {
  const { user, config } = useSession();
  const [data, setData] = useState<{ linked: boolean; linkedAt: string | null; settings: TgSettings; botReady: boolean } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<typeof data>('/api/me/telegram').then(setData).catch((e) => setMsg({ kind: 'error', text: e.message }));
  useEffect(() => { load(); }, []);
  const pro = user?.proFeatures;
  const s = data?.settings;
  const set = (patch: Partial<TgSettings>) => data && setData({ ...data, settings: { ...data.settings, ...patch } });
  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Thông báo Telegram</h1>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Card>
          <h2 className="font-semibold">Channel chung (mọi gói)</h2>
          <p className="mt-1 text-sm text-muted">Mỗi sáng một bản tin các job remote nhận người Việt mới nhất, chia theo lĩnh vực.</p>
          {config?.telegramChannel
            ? <a href={config.telegramChannel} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-brand">Tham gia channel ↗</a>
            : <p className="mt-3 text-sm text-muted">Channel sắp ra mắt.</p>}
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Telegram riêng của bạn</h2>
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">Pro</span>
          </div>
          <p className="mt-1 text-sm text-muted">Bot báo ngay khi có job mới hợp với hồ sơ của bạn.</p>
          {!data ? <div className="py-6 text-center text-brand"><Spinner /></div> : !pro ? (
            <div className="mt-4"><Button variant="primary" onClick={() => navigate('/pricing')}>Nâng cấp để dùng</Button></div>
          ) : data.linked ? (
            <div className="mt-4 space-y-5">
              <Alert kind="success">Đã liên kết từ {date(data.linkedAt)}.</Alert>
              <Toggle checked={s!.quietEnabled} onChange={(v) => set({ quietEnabled: v })} label="Không gửi tin trong giờ nghỉ" hint="Job tìm được trong giờ nghỉ được gửi thành một danh sách khi hết giờ nghỉ." />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label>Từ <input type="time" value={s!.quietStart} disabled={!s!.quietEnabled} onChange={(e) => set({ quietStart: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
                <label>đến <input type="time" value={s!.quietEnd} disabled={!s!.quietEnabled} onChange={(e) => set({ quietEnd: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Báo những job</div>
                <Pills options={[{ value: '35', label: 'Rất hợp' }, { value: '20', label: 'Hợp' }, { value: '5', label: 'Có thể hợp' }]}
                  value={String(s!.minScore >= 35 ? 35 : s!.minScore >= 20 ? 20 : 5)} onChange={(v: string) => set({ minScore: Number(v) })} label="Mức phù hợp tối thiểu" />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" busy={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    await api('/api/me/telegram/settings', { body: { ...s, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh' } });
                    setMsg({ kind: 'success', text: 'Đã lưu.' });
                  } catch (e) {
                    setMsg({ kind: 'error', text: (e as Error).message });
                  } finally {
                    setBusy(false);
                  }
                }}>Lưu</Button>
                <Button variant="danger" onClick={async () => { await api('/api/me/telegram/unlink', { body: {} }); setLink(null); load(); }}>Huỷ liên kết</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {!data.botReady && <Alert kind="error">Bot Telegram chưa được cấu hình trên server.</Alert>}
              {link ? (
                <>
                  <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Mở Telegram và bấm Start ↗</a>
                  <p className="text-sm text-muted">Liên kết có hiệu lực 15 phút. Sau khi bấm Start trong Telegram, <button className="font-semibold text-brand hover:underline" onClick={load}>tải lại trang này</button>.</p>
                </>
              ) : (
                <Button variant="primary" disabled={!data.botReady} busy={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    setLink((await api<{ url: string }>('/api/me/telegram/link', { body: {} })).url);
                  } catch (e) {
                    setMsg({ kind: 'error', text: (e as Error).message });
                  } finally {
                    setBusy(false);
                  }
                }}>Liên kết Telegram</Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
