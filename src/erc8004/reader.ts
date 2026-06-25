/**
 * ERC-8004 IdentityRegistry read-only helpers via viem public client (Base mainnet).
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI } from "./contract";

const publicClient = createPublicClient({ chain: base, transport: http() });

export async function readTokenURI(agentId: bigint): Promise<string> {
  return publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "tokenURI",
    args: [agentId],
  });
}

export async function readAgentWallet(agentId: bigint): Promise<string> {
  return publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getAgentWallet",
    args: [agentId],
  });
}

/** Verify contract exists on chain (non-empty bytecode). */
export async function verifyContractExists(): Promise<boolean> {
  const code = await publicClient.getCode({ address: IDENTITY_REGISTRY });
  return !!code && code !== "0x";
}
