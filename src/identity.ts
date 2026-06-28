/**
 * InvestX agent identity.
 *
 * This agent registers its OWN ERC-8004 agentId, fully separate from
 * the upstream AA repo's 55560. The decision log is tied to this id and to the
 * `investx_daily` store key — never to AA's identity or store.
 *
 * Resolution:
 *   - INVESTX_AGENT_ID set  → real registered id (provisional:false).
 *   - INVESTX_AGENT_ID unset → a provisional placeholder id is used so logging
 *     can start immediately. Records are stamped agentIdProvisional:true.
 *
 * TODO(identity): run the one-time ERC-8004 registration
 *   (`node dist/scripts/erc8004-register.js`), then set INVESTX_AGENT_ID to the
 *   minted id and redeploy. After that, provisional records can be re-keyed to
 *   the registered id. There is intentionally NO fallback to 55560.
 */
import { AGENT_REGISTRY_ID } from "./erc8004/contract";

const PROVISIONAL_AGENT_ID = "investx-provisional-001";

export interface AgentIdentity {
  agentId: string;
  provisional: boolean;
  agentRegistry: string;
}

export function resolveIdentity(): AgentIdentity {
  const registered = process.env.INVESTX_AGENT_ID;
  if (registered && registered.trim() !== "") {
    // Guard against accidentally reusing AA's identity.
    if (registered.trim() === "55560") {
      throw new Error(
        "[IDENTITY] INVESTX_AGENT_ID=55560 is the upstream AA repo's id. " +
          "InvestX must register and use its OWN agentId."
      );
    }
    return { agentId: registered.trim(), provisional: false, agentRegistry: AGENT_REGISTRY_ID };
  }
  return { agentId: PROVISIONAL_AGENT_ID, provisional: true, agentRegistry: AGENT_REGISTRY_ID };
}
