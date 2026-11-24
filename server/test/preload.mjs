import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
Object.assign(process.env, { DATABASE_URL: 'pglite://memory', GEMINI_API_KEY: 'mock-key', TELEGRAM_BOT_TOKEN: 'mock-token', TELEGRAM_CHAT_ID: '1', PUBLIC_URL: 'http://test' });
globalThis.tg = { sent: [], full: [], failAt: null, calls: 0 };
globalThis.gemini = { scored: [] };
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('api.telegram.org')) {
    if (url.endsWith('/getMe')) return new Response('{"ok":true,"result":{"username":"JobRadarTestBot"}}', { status: 200 });
    tg.calls++;
    (tg.chats ??= []).push(String(JSON.parse(init.body).chat_id));
    if (tg.failAt === tg.calls) return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests: retry after 5' }), { status: 429 });
    const text = JSON.parse(init.body).text;
    tg.full.push(text);
    tg.sent.push(text.split('\n')[0].replace(/<[^>]+>/g, ''));
    return new Response('{"ok":true}', { status: 200 });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    const ids = [...prompt.matchAll(/^ID: (.+)$/gm)].map((m) => m[1]);
    gemini.scored.push(...ids);
    const out = ids.map((id) => ({ id, fit: id.includes('bad') ? 30 : 90, reason_vi: 'mock', red_flags_vi: [], scam_risk: 'low' }));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200 });
  }
  throw new Error('offline in test'); // every job source fails: only seeded jobs exist
};
