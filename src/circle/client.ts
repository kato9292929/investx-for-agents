/**
 * Circle Developer-Controlled Wallets — shared API client.
 * Handles entity secret RSA-OAEP encryption and Circle public key caching.
 * Used by both EVM signer and Solana transfer modules.
 *
 * Copied verbatim from x402-Autonomous-Agent (src/circle/client.ts) — decision
 * logic differs in InvestX, the payment plumbing does not.
 */
import * as crypto from "node:crypto";

export const CIRCLE_API = "https://api.circle.com/v1/w3s";

let _cachedPublicKey: string | null = null;

export function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const buf = Buffer.from(entitySecretHex, "hex");
  // RSA-OAEP includes random padding — each call produces a unique ciphertext (replay prevention)
  return crypto
    .publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      buf
    )
    .toString("base64");
}

export async function fetchCirclePublicKey(apiKey: string): Promise<string> {
  if (_cachedPublicKey) return _cachedPublicKey;
  const res = await fetch(`${CIRCLE_API}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[CIRCLE] publicKey fetch failed: HTTP ${res.status} — ${body.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data: { publicKey: string } };
  _cachedPublicKey = json.data.publicKey;
  return _cachedPublicKey;
}

export async function buildEntitySecretCiphertext(apiKey: string): Promise<string> {
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) throw new Error("CIRCLE_ENTITY_SECRET is required");
  const pubKey = await fetchCirclePublicKey(apiKey);
  return encryptEntitySecret(entitySecret, pubKey);
}

export function getRequiredApiKey(): string {
  const k = process.env.CIRCLE_API_KEY;
  if (!k) throw new Error("CIRCLE_API_KEY is required");
  return k;
}
