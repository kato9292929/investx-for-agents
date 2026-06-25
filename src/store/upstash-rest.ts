/**
 * Minimal Upstash Redis REST helper.
 *
 * Reuses the same access pattern as the Mode A decision-store: env-gated by
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN and a raw `fetch` to the
 * Upstash REST API (no extra client dependency). Commands are sent in the
 * array body form, e.g. ["SET", key, value, "NX", "EX", "60"], and Upstash
 * replies with { result } or { error }.
 */

export function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Run one Redis command via the Upstash REST API and return its `result`. */
export async function upstashCommand<T = unknown>(
  command: (string | number)[]
): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash not configured (UPSTASH_REDIS_REST_URL/TOKEN missing)");
  }

  const res = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Upstash ${command[0]} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) {
    throw new Error(`Upstash ${command[0]} error: ${json.error}`);
  }
  return json.result as T;
}
