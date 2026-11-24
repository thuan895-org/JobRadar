// Per-user profiles: which skills they have (from a catalogue, or their own
// keyword groups), what to leave out, and the text the AI reads. Job scores
// are computed from the profile when a user asks for their feed, so nothing
// per-user is stored for jobs they never touched.
import { q } from './db.js';
import { scoreJob } from './score.js';
import { readProfile } from './ai.js';

/** Skill groups users pick from in onboarding. Terms match whole words, case-insensitive. */
export const CATALOG = [
  { id: 'backend', label: 'Backend', terms: ['backend', 'back-end', 'node.js', 'nodejs', 'nestjs', 'express', 'java', 'spring boot', 'spring', 'python', 'django', 'fastapi', 'flask', 'golang', 'php', 'laravel', 'ruby on rails', '.net', 'c#', 'rest api', 'graphql', 'microservices', 'postgresql', 'mysql', 'mongodb', 'redis', 'kafka', 'api integration', 'webhook', 'lập trình backend'] },
  { id: 'web', label: 'Frontend / Web', terms: ['frontend', 'front-end', 'react', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte', 'javascript', 'typescript', 'html', 'css', 'tailwind', 'full stack', 'fullstack', 'web app', 'lập trình web'] },
  { id: 'mobile', label: 'Mobile', terms: ['mobile app', 'react native', 'flutter', 'android', 'ios', 'swift', 'kotlin', 'expo', 'ứng dụng di động', 'app di động'] },
  { id: 'cms', label: 'WordPress / Shopify', terms: ['wordpress', 'woocommerce', 'shopify', 'wix', 'webflow', 'elementor', 'squarespace'] },
  { id: 'ai', label: 'AI / LLM / MCP', terms: ['ai', 'llm', 'mcp', 'model context protocol', 'openai', 'gpt', 'chatgpt', 'claude', 'anthropic', 'gemini', 'ai agent', 'ai agents', 'rag', 'langchain', 'chatbot', 'ai integration', 'machine learning', 'trí tuệ nhân tạo'] },
  { id: 'automation', label: 'Tool / Automation', terms: ['automation', 'scraper', 'scraping', 'web scraping', 'zapier', 'n8n', 'make.com', 'telegram bot', 'discord bot', 'chrome extension', 'google apps script', 'tự động hóa', 'tự động hoá'] },
  { id: 'devops', label: 'Cloud / DevOps', terms: ['devops', 'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'k8s', 'terraform', 'ci/cd', 'linux', 'server setup'] },
  { id: 'data', label: 'Data / Analytics', terms: ['data analyst', 'data analysis', 'data engineer', 'sql', 'power bi', 'tableau', 'excel', 'etl', 'pandas', 'dashboard', 'phân tích dữ liệu'] },
  { id: 'qa', label: 'QA / Testing', terms: ['qa', 'tester', 'testing', 'test automation', 'selenium', 'cypress', 'playwright', 'manual testing', 'kiểm thử'] },
  { id: 'telephony', label: 'Tổng đài / CPaaS', terms: ['cpaas', 'twilio', 'vonage', 'plivo', 'voip', 'sip', 'ivr', 'call center', 'contact center', 'auto dialer', 'autodialer', 'dialer', 'asterisk', 'freeswitch', 'sms', 'tổng đài'] },
  { id: 'uiux', label: 'UI/UX design', terms: ['ui/ux', 'ux', 'ui design', 'ux design', 'figma', 'product design', 'wireframe', 'prototype', 'thiết kế giao diện'] },
  { id: 'graphic', label: 'Thiết kế đồ hoạ', terms: ['graphic design', 'graphic designer', 'photoshop', 'illustrator', 'logo design', 'canva', 'banner', 'branding', 'thiết kế đồ họa', 'thiết kế đồ hoạ'] },
  { id: 'video', label: 'Dựng video', terms: ['video editing', 'video editor', 'premiere', 'after effects', 'capcut', 'davinci resolve', 'motion graphics', 'youtube', 'dựng video'] },
  { id: 'writing', label: 'Viết nội dung', terms: ['content writing', 'content writer', 'copywriting', 'copywriter', 'blog', 'article', 'seo writing', 'ghostwriting', 'technical writing', 'viết bài', 'viết content'] },
  { id: 'marketing', label: 'Marketing / SEO', terms: ['digital marketing', 'marketing', 'seo', 'social media', 'facebook ads', 'google ads', 'tiktok', 'email marketing', 'growth'] },
  { id: 'translation', label: 'Dịch sang tiếng Việt', terms: ['vietnamese', 'tiếng việt', 'localization', 'localisation', 'translation', 'translator', 'translate', 'subtitle', 'proofreading', 'dịch thuật', 'biên dịch', 'phiên dịch', 'phụ đề'],
    requireAny: ['vietnamese', 'tiếng việt', 'vietnam', 'dịch thuật', 'biên dịch', 'phiên dịch'] },
  { id: 'support', label: 'Trợ lý ảo / CSKH', terms: ['virtual assistant', 'customer support', 'customer service', 'data entry', 'admin assistant', 'chat support', 'trợ lý ảo', 'chăm sóc khách hàng'] },
];
const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));
export const LEVELS = { main: 12, good: 8, some: 4 };

/** Senior-management titles nobody in the target audience is hiring for. Everything else is per user. */
const GLOBAL_EXCLUDE = ['director', 'vp ', 'vice president', 'head of', 'chief'];

const now = () => new Date().toISOString();
const json = (v) => JSON.stringify(v);

const EMPTY = { skills: [], exclude_terms: [], answers: {}, summary: '', region_only: true, min_budget_usd: 30, cv_name: null, cv_uploaded_at: null };

/** The profile without the CV bytes. */
export async function getProfile(userId) {
  const { rows } = await q(`SELECT user_id, skills, exclude_terms, answers, summary, region_only, min_budget_usd, cv_name, cv_mime, cv_text, cv_uploaded_at, updated_at
    FROM user_profiles WHERE user_id = $1`, [userId]);
  return rows[0] ?? { ...EMPTY, user_id: userId };
}

/** Checks what the app sent and saves it. Throws an Error with a Vietnamese message on bad input. */
export async function saveProfile(userId, input) {
  const skills = cleanSkills(input.skills);
  const exclude = cleanTerms(input.excludeTerms ?? [], 50);
  const summary = String(input.summary ?? '').slice(0, 8000);
  const answers = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : {};
  if (JSON.stringify(answers).length > 20000) throw new Error('Câu trả lời quá dài.');
  const minBudget = Math.max(0, Math.min(100000, Math.round(Number(input.minBudgetUsd ?? 30)) || 0));
  await q(`
    INSERT INTO user_profiles (user_id, skills, exclude_terms, answers, summary, region_only, min_budget_usd, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id) DO UPDATE SET skills = excluded.skills, exclude_terms = excluded.exclude_terms, answers = excluded.answers,
      summary = excluded.summary, region_only = excluded.region_only, min_budget_usd = excluded.min_budget_usd, updated_at = excluded.updated_at
  `, [userId, json(skills), json(exclude), json(answers), summary, input.regionOnly !== false, minBudget, now()]);
  return getProfile(userId);
}

function cleanTerms(list, max) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => t && t.length <= 60))].slice(0, max);
}

/** Skills are either {id, level} from the catalogue or {label, level|weight, terms} written by the user. */
function cleanSkills(list) {
  if (!Array.isArray(list)) throw new Error('Danh sách kỹ năng không hợp lệ.');
  const out = [];
  for (const s of list.slice(0, 40)) {
    if (s && BY_ID.has(s.id)) {
      out.push({ id: s.id, level: LEVELS[s.level] ? s.level : 'good' });
    } else if (s && typeof s.label === 'string' && Array.isArray(s.terms)) {
      const terms = cleanTerms(s.terms, 60);
      if (!terms.length) continue;
      const weight = LEVELS[s.level] ?? Math.max(1, Math.min(20, Math.round(Number(s.weight) || LEVELS.good)));
      out.push({ label: s.label.trim().slice(0, 40) || 'Kỹ năng riêng', weight, terms, ...(Array.isArray(s.requireAny) ? { requireAny: cleanTerms(s.requireAny, 20) } : {}) });
    }
  }
  return out;
}

/** The skill groups scoreJob understands, from a stored profile. */
export function resolveSkills(profile) {
  return (profile.skills ?? []).map((s) => {
    if (s.id) {
      const c = BY_ID.get(s.id);
      return c && { label: c.label, weight: LEVELS[s.level] ?? LEVELS.good, terms: c.terms, ...(c.requireAny ? { requireAny: c.requireAny } : {}) };
    }
    return { label: s.label, weight: s.weight, terms: s.terms, ...(s.requireAny ? { requireAny: s.requireAny } : {}) };
  }).filter(Boolean);
}

/** A config for scoreJob with this user's skills, exclusions and budget floor. */
export function scoringConfig(profile, config) {
  return {
    ...config,
    skills: resolveSkills(profile),
    excludeTitleTerms: [...GLOBAL_EXCLUDE, ...(profile.exclude_terms ?? [])],
    minBudgetUsd: profile.min_budget_usd ?? config.minBudgetUsd,
  };
}

/** scoreJob works on freshly fetched jobs (camelCase); this feeds it a database row. */
export function scoreRow(row, scoring) {
  return scoreJob({
    title: row.title,
    tags: row.tags,
    description: row.description,
    location: row.location,
    kind: row.kind,
    language: row.language || ((row.matched ?? []).includes('Khách Việt') ? 'vi' : ''),
    bidCount: row.bid_count,
    budgetMinUsd: row.budget_min_usd,
    budgetMaxUsd: row.budget_max_usd,
    postedAt: row.posted_at,
  }, scoring);
}

/** The text the AI reads about a user: what they wrote, plus their skills and CV text. */
export function profileText(profile, user) {
  const skills = resolveSkills(profile).map((s) => `${s.label} (${s.weight >= LEVELS.main ? 'main skill' : s.weight >= LEVELS.good ? 'good' : 'some experience'})`);
  return [
    `Name: ${user.name || '(not given)'}`,
    skills.length ? `Skills: ${skills.join(', ')}` : '',
    profile.summary ? `About me:\n${profile.summary}` : '',
    profile.cv_text ? `CV:\n${profile.cv_text.slice(0, 12000)}` : '',
  ].filter(Boolean).join('\n\n');
}

// ---- Moving the single-user data to the owner's account, once ----

/**
 * The tool started single-user: job statuses, AI scores and apply kits are on
 * the jobs table, skills in config.json, the profile in profile.md. The first
 * admin to open the new app gets all of it, so nothing is lost.
 */
export async function claimLegacyData(user, config, getMeta, setMeta) {
  if (await getMeta('legacyOwner')) return false;
  await setMeta('legacyOwner', { userId: user.id, at: now() });
  const { rowCount } = await q(`
    INSERT INTO user_jobs (user_id, job_id, status, ai_score, ai_reason, ai_flags, ai_scam, ai_checked_at, apply_kit, notified, updated_at)
    SELECT $1, id, status, ai_score, ai_reason, ai_flags, ai_scam, ai_checked_at, apply_kit, TRUE, $2 FROM jobs
    WHERE status <> 'new' OR ai_checked_at IS NOT NULL OR apply_kit IS NOT NULL
    ON CONFLICT (user_id, job_id) DO NOTHING
  `, [user.id, now()]);
  const existing = await getProfile(user.id);
  if (!existing.updated_at) {
    const legacy = readProfile();
    await saveProfile(user.id, {
      skills: config.skills.map((s) => ({ label: s.label, weight: s.weight, terms: s.terms, ...(s.requireAny ? { requireAny: s.requireAny } : {}) })),
      excludeTerms: config.excludeTitleTerms.map((t) => t.trim()).filter((t) => !GLOBAL_EXCLUDE.includes(t)),
      summary: legacy.startsWith('(no profile') ? '' : legacy,
      minBudgetUsd: config.minBudgetUsd,
      regionOnly: true,
    });
  }
  console.log(`[accounts] legacy data moved to the first admin account (${rowCount} jobs with a status or AI result)`);
  return true;
}
