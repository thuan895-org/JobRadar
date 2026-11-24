import { useEffect, useState } from 'react';
import { Card, Logo, ServerStatus, serverHealthy } from '@jobradar/shared';

// Placeholder until the real user app is built (job feed, onboarding, settings).
export default function App() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { serverHealthy().then(setOk); }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          <ServerStatus ok={ok} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Việc remote cho người Việt</h1>
        <p className="mt-3 max-w-2xl text-muted">
          JobRadar gom job remote nhận người ở Việt Nam, tóm tắt bằng tiếng Việt và giúp bạn chuẩn bị hồ sơ ứng tuyển.
        </p>
        <Card className="mt-8">
          <p className="font-medium">Giao diện mới đang được xây dựng.</p>
          <p className="mt-1 text-sm text-muted">Trong lúc chờ, trang hiện tại vẫn chạy ở địa chỉ của server.</p>
        </Card>
      </main>
    </div>
  );
}
