/**
 * ERC-8004 IdentityRegistry — Base mainnet constants and ABI fragments.
 * Source: https://github.com/erc-8004/erc-8004-contracts
 *
 * Verified address: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (Base mainnet, chainId 8453)
 * Same vanity address pattern as other chains (0x8004A1...).
 */

export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const BASE_CHAIN_ID = 8453;

// ERC-721 Transfer event topic0
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

// Minimal ABI fragments (derived from official abis/IdentityRegistry.json)
export const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "string", name: "newURI", type: "string" },
    ],
    name: "setAgentURI",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getAgentWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// agentRegistry identifier per ERC-8004 spec
export const AGENT_REGISTRY_ID =
  `eip155:${BASE_CHAIN_ID}:${IDENTITY_REGISTRY}` as const;
