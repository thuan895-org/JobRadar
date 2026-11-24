import { useState } from 'react';
import { Alert, Button, Card, api } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { useSession } from '../session';

export function VerifyBanner() {
  const { user, config } = useSession();
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'off'>('idle');
  if (!user || user.emailVerified) return null;
  return (
    <Alert>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Hãy xác minh email <b>{user.email}</b> để nhận thông báo và lấy lại mật khẩu khi cần.</span>
        {config?.emailEnabled && state !== 'sent' && (
          <Button busy={state === 'busy'} onClick={async () => {
            setState('busy');
            const r = await api<{ sent: boolean }>('/api/auth/resend-verification', { body: {} }).catch(() => ({ sent: false }));
            setState(r.sent ? 'sent' : 'off');
          }}>Gửi lại email</Button>
        )}
        {state === 'sent' && <span className="font-medium text-good">Đã gửi, kiểm tra hộp thư nhé.</span>}
      </div>
    </Alert>
  );
}

export function Home() {
  const { user } = useSession();
  const firstName = (user?.name || '').trim().split(/\s+/).pop();
  return (
    <AppLayout>
      <div className="space-y-6">
        <VerifyBanner />
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Chào {firstName || 'bạn'} 👋</h1>
          <p className="mt-2 text-muted">Tài khoản của bạn đã sẵn sàng.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['1', 'Tạo hồ sơ', 'Trả lời vài câu hỏi hoặc tải CV lên để JobRadar hiểu bạn làm được gì.', 'Sắp có'],
            ['2', 'Job dành riêng cho bạn', 'Danh sách job nhận người ở Việt Nam, xếp theo mức phù hợp với hồ sơ của bạn.', 'Sắp có'],
            ['3', 'Thông báo Telegram', 'Nhận job mới phù hợp ngay trên điện thoại, kèm bản tin đầu ngày.', 'Sắp có'],
          ].map(([n, title, text, tag]) => (
            <Card key={n}>
              <div className="flex items-center justify-between">
                <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{n}</span>
                <span className="rounded-full bg-bg px-2.5 py-1 text-xs text-muted">{tag}</span>
              </div>
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
