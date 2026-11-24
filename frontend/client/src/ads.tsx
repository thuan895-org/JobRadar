// Ad cards in the Free feed. Pro users never see them. Google ads load only
// after the visitor accepts on the consent banner (the same choice as on the
// public pages: same site, same browser storage). Otherwise a house ad.
import { useEffect, useRef, useState } from 'react';
import { Link } from './router';
import { useSession } from './session';

const KEY = 'jr_ads_consent';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
let scriptAdded = false;

function loadScript(client: string) {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  document.head.append(s);
}

export function useAds() {
  const { user, config } = useSession();
  const [consent, setConsent] = useState(read);
  const show = Boolean(user && !user.proFeatures);
  const google = show && Boolean(config?.adsenseClient && config?.adsenseFeedSlot) && consent === 'yes';
  const decide = (v: 'yes' | 'no') => { try { localStorage.setItem(KEY, v); } catch { /* private mode: ask again next time */ } setConsent(v); };
  return { show, google, askConsent: show && Boolean(config?.adsenseClient) && !consent, decide };
}

export function AdCard({ google }: { google: boolean }) {
  const { config } = useSession();
  const ref = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!google || !config?.adsenseClient || !ref.current) return;
    loadScript(config.adsenseClient);
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch { /* blocked by an ad blocker */ }
  }, [google, config?.adsenseClient]);
  return (
    <aside aria-label="Quảng cáo" className="relative min-h-[120px] rounded-2xl border border-dashed border-line bg-surface p-4 sm:p-5">
      <span className="absolute top-2 right-3 text-[10px] font-semibold tracking-wide text-muted uppercase">{google ? 'Quảng cáo' : 'JobRadar'}</span>
      {google ? (
        <ins ref={ref} className="adsbygoogle block" data-ad-client={config!.adsenseClient} data-ad-slot={config!.adsenseFeedSlot} data-ad-format="auto" data-full-width-responsive="true" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 pr-10">
          <div>
            <div className="font-semibold">Nâng cấp Pro: AI soạn proposal, Telegram riêng, không quảng cáo</div>
            <div className="text-sm text-muted">Tóm tắt không giới hạn và cảnh báo job lừa đảo. 79.000đ/tháng.</div>
          </div>
          <Link to="/pricing" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Xem gói Pro</Link>
        </div>
      )}
    </aside>
  );
}

export function AdsConsent({ decide }: { decide: (v: 'yes' | 'no') => void }) {
  return (
    <div role="dialog" aria-label="Quảng cáo" className="fixed inset-x-4 bottom-4 z-20 mx-auto max-w-xl rounded-2xl border border-line bg-surface p-4 text-sm shadow-xl">
      <b>Quảng cáo trên JobRadar</b>
      <p className="mt-1 text-muted">Gói Free có quảng cáo của Google để giữ miễn phí. Google có thể dùng cookie để chọn quảng cáo. Bạn đồng ý chứ? <Link to="/privacy" className="text-brand underline">Chi tiết</Link></p>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => decide('no')} className="rounded-lg border border-line px-4 py-2 font-semibold">Không</button>
        <button onClick={() => decide('yes')} className="rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand">Đồng ý</button>
      </div>
    </div>
  );
}
