// "10 điểm chính": a short Vietnamese summary per job, shared by every user.
import { getJob, saveHighlights } from './db.js';
import { summarizeJobs } from './ai.js';

// ---- AI highlights: one Gemini call per job at most, even if the page asks twice while it runs ----
const inflight = new Map(); // id -> Promise<points[] | null>

export async function highlightsFor(ids) {
  const result = {};
  const missing = [];
  for (const id of ids) {
    const job = await getJob(id);
    if (!job) continue;
    if (job.ai_highlights) result[id] = job.ai_highlights;
    else if (!inflight.has(id)) missing.push(job);
  }
  if (missing.length) {
    const call = summarizeJobs(missing).then(async (rows) => {
      const byId = new Map(rows.map((r) => [r.id, r.points]));
      for (const job of missing) if (byId.get(job.id)?.length) await saveHighlights(job.id, byId.get(job.id));
      return byId;
    });
    for (const job of missing) {
      inflight.set(job.id, call.then((byId) => byId.get(job.id) ?? null).finally(() => inflight.delete(job.id)));
    }
  }
  const waiting = ids.filter((id) => !(id in result) && inflight.has(id));
  const settled = await Promise.allSettled(waiting.map((id) => inflight.get(id)));
  let error = null;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) result[waiting[i]] = s.value;
    else if (s.status === 'rejected') error = s.reason.message;
  });
  return { highlights: result, error };
}

