// Gemini (Google AI Studio, free tier) for two things:
//  1. scoreJobs: reads the best keyword matches and judges real fit + scam risk
//  2. applyKit: writes everything you need to fill in to apply for one job
// The key is read from .env (GEMINI_API_KEY) and only ever sent in a header.
// AI output is data: the page shows it as plain text, nothing here executes it.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from './util.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// profile.md is not in git. On Render, upload it as a Secret File named
// profile.md: it is then readable at /etc/secrets/profile.md.
const PROFILE_PATHS = () => [process.env.PROFILE_PATH, join(ROOT, 'profile.md'), '/etc/secrets/profile.md'].filter(Boolean);

export function readProfile() {
  const file = PROFILE_PATHS().find((p) => existsSync(p));
  if (!file) return '(no profile.md yet)';
  // A field still in [brackets] is the template's example, not a fact about
  // the user. Hide the example so the model cannot present it as real.
  // Markdown links "[text](url)" are left alone.
  return readFileSync(file, 'utf8').replace(/\[[^\]\n]*\](?!\()/g, '[NOT FILLED IN]');
}

/**
 * Calls Gemini with a JSON schema. Tries each model once; a model that is
 * overloaded (503), rate-limited (429) or too slow is skipped at once rather
 * than retried, because the next model usually answers in seconds. If every
 * model fails, it pauses and goes round again, up to `rounds` times.
 */
async function generateJson({ system, prompt, schema, temperature = 0.4, models, timeoutSeconds, rounds = 2 }) {
  const { ai } = loadConfig();
  let last = 'no model configured';
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await wait(ai.retryPauseMs);
    for (const model of models) {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      }).catch((err) => ({ ok: false, status: 0, json: async () => ({ error: { message: err.name === 'TimeoutError' ? `no answer within ${timeoutSeconds}s` : err.message } }) }));
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        try {
          return { data: JSON.parse(text), model };
        } catch {
          last = `${model} returned text that is not JSON`;
          continue;
        }
      }
      // Google's own message only; it never contains the key.
      const message = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /api key/i.test(message) || res.status === 401 || res.status === 403) {
        throw new Error(`Google từ chối GEMINI_API_KEY (${res.status}): ${message}`);
      }
      last = `${model}: ${res.status} ${message}`;
      console.error(`Gemini ${last.slice(0, 200)} — trying the next model`);
    }
  }
  throw new Error(`Gemini không trả lời được: ${last}`);
}

// Scoring and the 10 points are short, frequent tasks: fast model first.
// The apply kit is one long piece of writing: best model first.
const fast = () => { const { ai } = loadConfig(); return { models: ai.fastModels, timeoutSeconds: ai.fastTimeoutSeconds }; };
const best = () => { const { ai } = loadConfig(); return { models: ai.models, timeoutSeconds: ai.kitTimeoutSeconds }; };

function jobBrief(job, maxDesc) {
  return [
    `ID: ${job.id}`,
    `Title: ${job.title}`,
    `Source: ${job.source}${job.company ? ` | Company: ${job.company}` : ''}`,
    `Type: ${job.kind || 'unknown'} | Location rule: ${job.location || 'none stated'}`,
    `Budget/salary: ${job.budget_text || 'not stated'}${job.bid_count != null ? ` | Bids so far: ${job.bid_count}` : ''}`,
    `Posted: ${job.posted_at || job.first_seen}`,
    `Description:\n${(job.description || '').slice(0, maxDesc)}`,
  ].join('\n');
}

const SCORE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      fit: { type: 'INTEGER', description: '0-100' },
      reason_vi: { type: 'STRING' },
      red_flags_vi: { type: 'ARRAY', items: { type: 'STRING' } },
      scam_risk: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    },
    required: ['id', 'fit', 'reason_vi', 'red_flags_vi', 'scam_risk'],
  },
};

const SCORE_SYSTEM = `You screen job postings for one freelancer whose profile is given.
For each job decide how worth applying it is for THIS person, 0-100:
- 80-100: strong skill match, they can realistically win it from Vietnam, pay is reasonable, client looks serious.
- 50-79: decent match with some gap (skill, seniority, pay, competition).
- 20-49: weak match or poor odds.
- 0-19: does not fit, not open to someone in Vietnam, or likely scam.
Consider: required skills vs profile, seniority, whether the location rule allows Vietnam, pay vs the profile's rates, competition (bids), how clear the brief is.
Scam signs: asks the freelancer to pay or buy something, moves the chat to Telegram/WhatsApp before hiring, unrealistic pay for trivial work, crypto/"recovery" schemes, account renting, fake check payments, homework/exam cheating.
reason_vi: one or two short sentences in Vietnamese saying why. red_flags_vi: short Vietnamese phrases, empty if none.
Return one item per job, with the exact ID given.`;

/** Scores up to ~10 jobs in one request. Returns [{ id, fit, reason_vi, red_flags_vi, scam_risk }]. */
export async function scoreJobs(jobs) {
  const prompt = `PROFILE:\n${readProfile()}\n\nJOBS:\n\n${jobs.map((j) => jobBrief(j, 1800)).join('\n\n---\n\n')}`;
  const { data } = await generateJson({ system: SCORE_SYSTEM, prompt, schema: SCORE_SCHEMA, temperature: 0.2, ...fast() });
  const ids = new Set(jobs.map((j) => j.id));
  return (Array.isArray(data) ? data : [])
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...r, fit: Math.max(0, Math.min(100, Math.round(Number(r.fit) || 0))) }));
}

const HIGHLIGHTS_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { id: { type: 'STRING' }, points: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['id', 'points'],
  },
};

const HIGHLIGHTS_SYSTEM = `You turn long job postings into skimmable highlights for a Vietnamese freelancer.
For each job write up to 10 highlight points in Vietnamese, most important first. Each point is short (at most ~15 words), concrete and starts with a fitting emoji.
Cover what matters when deciding to apply, when the posting says it: what must be built or done; key tech/skills required; pay (budget, rate or salary, keep the original currency and numbers); contract type and duration/hours; seniority/experience asked; location or time-zone rules; deliverables and deadline; how to apply or what to send; anything unusual or a red flag.
Use only facts in the posting. Never invent numbers, names or requirements. If the posting is short, write fewer points; do not pad with generic statements.
Keep technology names, product names and numbers in their original form. Return one item per job with the exact ID given.`;

/** Up to 10 Vietnamese highlight points per job, several jobs per request. */
export async function summarizeJobs(jobs) {
  const prompt = `JOBS:\n\n${jobs.map((j) => jobBrief(j, 5000)).join('\n\n---\n\n')}`;
  const { data } = await generateJson({ system: HIGHLIGHTS_SYSTEM, prompt, schema: HIGHLIGHTS_SCHEMA, temperature: 0.2, ...fast(), rounds: 1 });
  const ids = new Set(jobs.map((j) => j.id));
  return (Array.isArray(data) ? data : [])
    .filter((r) => ids.has(r.id) && Array.isArray(r.points))
    .map((r) => ({ id: r.id, points: r.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 10) }));
}

const KIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    language: { type: 'STRING', description: 'language used for the texts the client will read: "vi" or "en" etc.' },
    job_summary_vi: { type: 'STRING' },
    subject_line: { type: 'STRING' },
    proposal: { type: 'STRING' },
    bid: {
      type: 'OBJECT',
      properties: {
        amount: { type: 'NUMBER' },
        currency: { type: 'STRING' },
        unit: { type: 'STRING', enum: ['fixed', 'hourly', 'monthly_salary', 'yearly_salary'] },
        delivery_days: { type: 'INTEGER' },
        rationale_vi: { type: 'STRING' },
      },
      required: ['amount', 'currency', 'unit', 'rationale_vi'],
    },
    milestones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, amount: { type: 'NUMBER' }, days: { type: 'INTEGER' } },
        required: ['title', 'amount'],
      },
    },
    screening_answers: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { question: { type: 'STRING' }, answer: { type: 'STRING' } }, required: ['question', 'answer'] },
    },
    questions_for_client: { type: 'ARRAY', items: { type: 'STRING' } },
    profile_highlights: { type: 'ARRAY', items: { type: 'STRING' } },
    missing_info_vi: { type: 'ARRAY', items: { type: 'STRING' } },
    tips_vi: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['language', 'job_summary_vi', 'subject_line', 'proposal', 'bid', 'milestones', 'screening_answers', 'questions_for_client', 'profile_highlights', 'missing_info_vi', 'tips_vi'],
};

const KIT_SYSTEM = `You prepare a complete application for one job on behalf of the freelancer whose profile is given.
Write everything the person must fill in to apply, ready to paste.

Language: texts the client reads (subject_line, proposal, screening answers, questions_for_client, profile_highlights, milestone titles) use the language the job is written in (Vietnamese job -> Vietnamese, otherwise English). Fields ending in _vi are always Vietnamese, for the freelancer.

Honesty (most important): use ONLY facts from the profile. Never invent years of experience, past clients, projects, numbers or links. Where a fact is needed but missing, write a placeholder in square brackets, e.g. [link portfolio], [số năm kinh nghiệm React], and list it in missing_info_vi.

proposal:
- Freelance gig: 120-200 words. First line speaks to the client's actual problem (no "Dear Sir", no "I am writing to apply"). Then how you would do it (2-4 concrete steps), the relevant experience from the profile, a timeline, and one smart question. Plain text, short paragraphs, no markdown headings.
- Full-time/contract role: a cover letter of 180-280 words, specific to the company and role.
bid: a realistic number. Freelance: within or slightly under the client's budget, consistent with the profile's rates, and aware of competition (bids so far); delivery_days realistic. Full-time: unit monthly_salary or yearly_salary per the posting, inside the posted range when there is one. rationale_vi explains the number in Vietnamese.
milestones: 2-4 for fixed-price gigs over ~$150 summing to the bid; otherwise an empty list.
screening_answers: the questions this application form is likely to ask (anything the posting itself asks first; then e.g. relevant experience, availability/start date, time zone overlap, rate/salary expectation, why this role), each answered for this person.
questions_for_client: 2-4 clarifying questions worth asking.
profile_highlights: 3-5 bullet lines from the profile most relevant to this job (to paste into a CV summary or profile headline).
missing_info_vi: everything the freelancer must fill in or verify before sending.
tips_vi: 2-4 short, practical tips for winning this specific job (and any red flags to check).`;

/** Writes the application kit for one job. */
export async function applyKit(job) {
  const prompt = `PROFILE:\n${readProfile()}\n\nJOB:\n${jobBrief(job, 8000)}\nURL: ${job.url}`;
  const { data, model } = await generateJson({ system: KIT_SYSTEM, prompt, schema: KIT_SCHEMA, temperature: 0.6, ...best() });
  return { ...data, model, created_at: new Date().toISOString() };
}
