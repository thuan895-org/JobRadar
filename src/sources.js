// Every fetcher returns jobs in one shape:
// { id, source, title, company, url, description, tags[], kind, location,
//   budgetText, budgetMinUsd, budgetMaxUsd, postedAt, bidCount }
// All sources below are public APIs/feeds meant for re-use, with the
// condition that we link back to the original posting (we always do).
import { getJson, getText, htmlToText, decodeEntities, toIso, money } from './util.js';

async function freelancer(cfg, config) {
  const seen = new Map();
  const base = { full_description: 'true', job_details: 'true', sort_field: 'time_updated' };
  const searches = [
    ...config.freelancerQueries.map((q) => ({ ...base, query: q, limit: '30' })),
    // Every project written in Vietnamese, i.e. posted by Vietnamese clients.
    { ...base, 'languages[]': 'vi', limit: '100' },
  ];
  for (const params of searches) {
    const data = await getJson('https://www.freelancer.com/api/projects/0.1/projects/active/?' + new URLSearchParams(params));
    for (const p of data?.result?.projects ?? []) {
      if (seen.has(p.id)) continue;
      const rate = p.currency?.exchange_rate || 1;
      const min = (p.budget?.minimum || 0) * rate;
      const max = (p.budget?.maximum || 0) * rate;
      const hourly = p.type === 'hourly';
      seen.set(p.id, {
        id: `freelancer:${p.id}`,
        source: 'Freelancer.com',
        title: p.title,
        company: '',
        url: `https://www.freelancer.com/projects/${p.seo_url}`,
        description: htmlToText(p.description || p.preview_description),
        tags: (p.jobs ?? []).map((j) => j.name),
        kind: hourly ? 'Freelance (theo giờ)' : 'Freelance (trọn gói)',
        location: '',
        budgetText: money(min, max, hourly ? '/giờ' : ''),
        budgetMinUsd: hourly ? min * 20 : min, // compare hourly jobs as ~20h of work
        budgetMaxUsd: hourly ? max * 20 : max,
        postedAt: toIso(p.time_submitted),
        bidCount: p.bid_stats?.bid_count ?? null,
        language: p.language || '',
      });
    }
    await new Promise((r) => setTimeout(r, 400)); // be gentle
  }
  return [...seen.values()];
}

async function remotive() {
  const data = await getJson('https://remotive.com/api/remote-jobs');
  return (data.jobs ?? []).map((j) => ({
    id: `remotive:${j.id}`,
    source: 'Remotive',
    title: j.title,
    company: j.company_name,
    url: j.url,
    description: htmlToText(j.description),
    tags: [j.category, ...(j.tags ?? [])].filter(Boolean),
    kind: j.job_type?.replace('_', ' ') || '',
    location: j.candidate_required_location || '',
    budgetText: j.salary || '',
    budgetMinUsd: null,
    budgetMaxUsd: null,
    postedAt: toIso(j.publication_date + 'Z'),
    bidCount: null,
  }));
}

async function remoteok() {
  const data = await getJson('https://remoteok.com/api');
  return data.filter((j) => j.id && j.position).map((j) => ({
    id: `remoteok:${j.id}`,
    source: 'Remote OK',
    title: decodeEntities(j.position),
    company: decodeEntities(j.company),
    url: j.url,
    description: htmlToText(j.description),
    tags: j.tags ?? [],
    kind: '',
    location: j.location || '',
    budgetText: money(j.salary_min, j.salary_max, '/năm'),
    budgetMinUsd: j.salary_min || null,
    budgetMaxUsd: j.salary_max || null,
    postedAt: toIso(j.date),
    bidCount: null,
  }));
}

function himalayasJob(j) {
  const unit = j.salaryPeriod === 'annual' ? '/năm' : j.salaryPeriod ? `/${j.salaryPeriod}` : '';
  const countries = j.locationRestrictions ?? [];
  return {
    id: `himalayas:${j.guid}`,
    source: 'Himalayas',
    title: j.title,
    company: j.companyName,
    url: j.applicationLink || j.guid,
    description: htmlToText(j.description || j.excerpt),
    tags: [...(j.categories ?? []), ...(j.parentCategories ?? [])].map((t) => t.replace(/-/g, ' ')),
    kind: j.employmentType || '',
    // Long country lists are unreadable; Vietnam is what matters here.
    location: countries.length > 6 ? (countries.includes('Vietnam') ? `Vietnam + ${countries.length - 1} nước khác` : `${countries.length} nước, trừ VN`) : countries.join(', '),
    budgetText: money(Number(j.minSalary), Number(j.maxSalary), unit),
    budgetMinUsd: Number(j.minSalary) || null,
    budgetMaxUsd: Number(j.maxSalary) || null,
    postedAt: toIso(j.pubDate),
    bidCount: null,
  };
}

async function himalayas(cfg) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < (cfg.pages ?? 5); page++) {
    const qs = new URLSearchParams({ limit: '20' });
    if (cursor) qs.set('cursor', cursor);
    const data = await getJson(`https://himalayas.app/jobs/api?${qs}`);
    out.push(...(data.jobs ?? []).map(himalayasJob));
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** Himalayas' own search, limited to jobs that accept people living in Vietnam. */
async function himalayasVietnam(cfg, config) {
  const seen = new Map();
  for (const q of config.himalayasVietnamQueries) {
    const qs = new URLSearchParams({ country: 'Vietnam', sort: 'recent', q });
    const data = await getJson(`https://himalayas.app/jobs/api/search?${qs}`);
    for (const j of data.jobs ?? []) seen.set(j.guid, himalayasJob(j));
    await new Promise((r) => setTimeout(r, 400));
  }
  return [...seen.values()];
}

async function jobicy() {
  const all = await getJson('https://jobicy.com/api/v2/remote-jobs?count=50');
  const apac = await getJson('https://jobicy.com/api/v2/remote-jobs?count=50&geo=apac');
  const jobs = new Map([...(all.jobs ?? []), ...(apac.jobs ?? [])].map((j) => [j.id, j]));
  return [...jobs.values()].map((j) => ({
    id: `jobicy:${j.id}`,
    source: 'Jobicy',
    title: decodeEntities(j.jobTitle),
    company: decodeEntities(j.companyName),
    url: j.url,
    description: htmlToText(j.jobDescription || j.jobExcerpt),
    tags: [...[].concat(j.jobIndustry ?? []), ...[].concat(j.jobType ?? [])].map(decodeEntities),
    kind: [].concat(j.jobType ?? []).join(', '),
    location: j.jobGeo || '',
    budgetText: money(j.salaryMin, j.salaryMax, j.salaryPeriod === 'yearly' ? '/năm' : ''),
    budgetMinUsd: j.salaryMin || null,
    budgetMaxUsd: j.salaryMax || null,
    postedAt: toIso(j.pubDate),
    bidCount: null,
  }));
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
}

async function weworkremotely() {
  const xml = await getText('https://weworkremotely.com/remote-jobs.rss');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const full = decodeEntities(tag(item, 'title'));
    const [company, ...rest] = full.split(': ');
    const link = tag(item, 'link');
    return {
      id: `wwr:${tag(item, 'guid') || link}`,
      source: 'We Work Remotely',
      title: rest.length ? rest.join(': ') : full,
      company: rest.length ? company : '',
      url: link,
      description: htmlToText(decodeEntities(tag(item, 'description'))),
      tags: [decodeEntities(tag(item, 'category'))].filter(Boolean),
      kind: decodeEntities(tag(item, 'type')),
      location: decodeEntities(tag(item, 'region')),
      budgetText: '',
      budgetMinUsd: null,
      budgetMaxUsd: null,
      postedAt: toIso(tag(item, 'pubDate')),
      bidCount: null,
    };
  });
}

export const SOURCES = { freelancer, remotive, remoteok, himalayas, himalayasVietnam, jobicy, weworkremotely };
