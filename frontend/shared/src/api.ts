/** Small helpers both apps use to talk to the JobRadar server. */
export async function serverHealthy(): Promise<boolean> {
  try {
    const res = await fetch('/healthz');
    return res.ok;
  } catch {
    return false;
  }
}
