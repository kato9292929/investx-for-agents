import { decodePaymentResponseHeader } from "@x402/fetch";
import { fetchWithPayment } from "./x402";
import { getRequestBody } from "./bodies";
import { detectDegraded } from "./stub-detector";
import type { EndpointConfig } from "./config";
import type { EndpointResult } from "./types";

const failureCounts = new Map<string, number>();

export async function callEndpoint(ep: EndpointConfig): Promise<EndpointResult> {
  const startMs = Date.now();

  try {
    const body = ep.method === "POST" ? getRequestBody(ep.id) : undefined;
    const options: RequestInit =
      body !== undefined
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {};

    console.log(`[CALLER:${ep.chain}] ${ep.method} ${ep.url}`);
    const res = await fetchWithPayment(ep.url, options);

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Extract tx hash from payment response header
    const paymentResponseHeader =
      res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    let txHash: string | undefined;
    if (paymentResponseHeader) {
      try {
        const decoded = decodePaymentResponseHeader(paymentResponseHeader);
        txHash = decoded.transaction;
      } catch {
        // header present but unparseable — non-fatal
      }
    }

    failureCounts.set(ep.id, 0);

    const detection = detectDegraded(data);
    if (detection.degraded) {
      console.warn(`[CALLER:${ep.chain}] ~ ${ep.name} — degraded: ${detection.reason}`);
      return {
        endpoint: ep.url,
        product: ep.name,
        status: "degraded",
        costUsdc: ep.cost,
        responsePeek: JSON.stringify(data).slice(0, 120),
        txHash,
        degradedReason: detection.reason,
        durationMs: Date.now() - startMs,
        ...(ep.captureFullData ? { fullData: data } : {}),
      };
    }

    return {
      endpoint: ep.url,
      product: ep.name,
      status: "success",
      costUsdc: ep.cost,
      responsePeek: JSON.stringify(data).slice(0, 120),
      txHash,
      durationMs: Date.now() - startMs,
      ...(ep.captureFullData ? { fullData: data } : {}),
    };
  } catch (err) {
    const prev = failureCounts.get(ep.id) ?? 0;
    failureCounts.set(ep.id, prev + 1);

    const error = err instanceof Error ? err.message : String(err);
    console.error(`[CALLER:${ep.chain}] ✗ ${ep.name} — ${error}`);
    return {
      endpoint: ep.url,
      product: ep.name,
      status: "error",
      costUsdc: 0,
      responsePeek: "",
      error,
      durationMs: Date.now() - startMs,
    };
  }
}

export function getConsecutiveFailures(ep: EndpointConfig): number {
  return failureCounts.get(ep.id) ?? 0;
}
