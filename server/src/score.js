// Scores a job against the skills in config.json. Higher = better fit.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = new Map();
function re(term) {
  if (!termRe.has(term)) termRe.set(term, new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}($|[^\\p{L}\\p{N}])`, 'iu'));
  return termRe.get(term);
}

// A plain substring search on lower-cased text is far cheaper than a Unicode
// regex, so it decides which words could be there; only those get the
// whole-word regex check. Results are the same as testing every word.
function hits(terms, text, lower) {
  if (!text || !terms.length) return [];
  return terms.filter((t) => lower.includes(t.toLowerCase()) && re(t).test(text));
}

export function regionOk(location, config) {
  const loc = (location || '').toLowerCase().trim();
  if (!loc) return true;
  if (config.regionOkTerms.some((t) => re(t).test(loc))) return true;
  // "Remote" with nothing else attached means no restriction.
  return loc.replace(/remote|[^a-z]/g, '') === '';
}

export function scoreJob(job, config) {
  const title = job.title || '';
  const tags = (job.tags || []).join(' | ');
  const desc = (job.description || '').slice(0, 6000);
  const lowTitle = title.toLowerCase();
  const lowTags = tags.toLowerCase();
  const lowDesc = desc.toLowerCase();
  let score = 0;
  const matched = [];

  for (const skill of config.skills) {
    if (skill.requireAny && !hits(skill.requireAny, title, lowTitle).length && !hits(skill.requireAny, tags, lowTags).length && !hits(skill.requireAny, desc, lowDesc).length) continue;
    const inTitle = hits(skill.terms, title, lowTitle);
    const inTags = hits(skill.terms, tags, lowTags);
    const inDesc = hits(skill.terms, desc, lowDesc);
    // Long descriptions mention everything, so they count least and need two hits.
    if (inTitle.length) score += skill.weight * 2;
    else if (inTags.length) score += skill.weight;
    else if (inDesc.length >= 2) score += Math.round(skill.weight / 2);
    else continue;
    score += Math.min(new Set([...inTitle, ...inTags, ...inDesc]).size - 1, 3);
    matched.push(skill.label);
  }

  if (!matched.length) score -= 20;
  // Vietnamese clients: same language, same time zone, far fewer bidders.
  if (job.language === 'vi') {
    score += 10;
    matched.push('Khách Việt');
  }
  if (config.excludeTitleTerms.some((t) => re(t.trim()).test(title))) score -= 40;

  const ok = regionOk(job.location, config);
  if (!ok) score -= 30;

  if (job.kind?.startsWith('Freelance')) score += 5;
  if (job.bidCount != null && job.bidCount < 10) score += 5;
  const top = job.budgetMaxUsd || job.budgetMinUsd;
  if (top && top < config.minBudgetUsd) score -= 15;

  const ageH = job.postedAt ? (Date.now() - Date.parse(job.postedAt)) / 3.6e6 : null;
  if (ageH != null && ageH < 24) score += 5;

  return { score, matched, regionOk: ok };
}
