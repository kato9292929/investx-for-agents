/**
 * Circle Developer-Controlled Wallets — EVM signer for @x402/fetch v2.
 *
 * Implements ClientEvmSigner using Circle's sign/typedData API so that
 * Base x402 payments can be authorized by a Circle DCW wallet instead of
 * a local private key (SIGNER_BACKEND=circle).
 *
 * Circle API endpoint used:
 *   POST https://api.circle.com/v1/w3s/developer/sign/typedData
 *   body: { walletId, data, entitySecretCiphertext }
 *
 * Reference: https://developers.circle.com/w3s/reference/developersigntyped
 */
import type { ClientEvmSigner } from "@x402/evm";
import { CIRCLE_API, buildEntitySecretCiphertext, getRequiredApiKey } from "./client";

// Standard EIP-712 domain field types — used to build EIP712Domain for Circle
const EIP712_DOMAIN_FIELD_TYPES: Record<string, string> = {
  name: "string",
  version: "string",
  chainId: "uint256",
  verifyingContract: "address",
  salt: "bytes32",
};

export function createCircleEvmSigner(
  walletId: string,
  walletAddress: `0x${string}`
): ClientEvmSigner {
  return {
    address: walletAddress,

    async signTypedData({ domain, types, primaryType, message }) {
      const apiKey = getRequiredApiKey();
      const entitySecretCiphertext = await buildEntitySecretCiphertext(apiKey);

      // Circle requires EIP712Domain in types; viem/x402 omits it (uses domain object instead).
      // Derive EIP712Domain from the actual domain keys so it matches exactly.
      const eip712Domain = Object.keys(domain)
        .filter((k) => k in EIP712_DOMAIN_FIELD_TYPES)
        .map((k) => ({ name: k, type: EIP712_DOMAIN_FIELD_TYPES[k] }));

      const typesWithDomain = { EIP712Domain: eip712Domain, ...types };

      const dataStr = JSON.stringify(
        { domain, types: typesWithDomain, primaryType, message },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v)
      );

      // Temporary debug log — remove after Base signing is confirmed working
      console.log("[CIRCLE:EVM] data sent to sign/typedData:", dataStr);

      const res = await fetch(`${CIRCLE_API}/developer/sign/typedData`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          walletId,
          data: dataStr,
          entitySecretCiphertext,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        throw new Error(
          `[CIRCLE:EVM] signTypedData failed: HTTP ${res.status} — ${body.slice(0, 300)}`
        );
      }

      const json = (await res.json()) as { data: { signature: string } };
      const signature = json.data?.signature;
      if (!signature) {
        throw new Error("[CIRCLE:EVM] signTypedData: no signature in response");
      }

      return signature as `0x${string}`;
    },
  };
}

export function getCircleEvmSignerFromEnv(): ClientEvmSigner {
  const walletId = process.env.CIRCLE_EVM_WALLET_ID;
  const walletAddress = process.env.CIRCLE_EVM_WALLET_ADDRESS;
  if (!walletId || !walletAddress) {
    throw new Error(
      "CIRCLE_EVM_WALLET_ID and CIRCLE_EVM_WALLET_ADDRESS are required when SIGNER_BACKEND=circle"
    );
  }
  return createCircleEvmSigner(walletId, walletAddress as `0x${string}`);
}
