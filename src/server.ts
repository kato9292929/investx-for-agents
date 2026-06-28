/**
 * Minimal HTTP server.
 *
 * Adapted from the upstream AA repo's server (the World ID / Mode C approval
 * flow is out of scope for InvestX and was removed). It exposes:
 *   - GET /health                       — liveness
 *   - GET /.well-known/agent-card.json  — ERC-8004 agent card (this agent's id)
 *   - GET /api/decisions/latest         — the most recent recorded decision
 *
 * The decision log is the deliverable, so the latest decision is served read-only
 * for inspection. Records are written by the rebalance run; this never mutates.
 */
import * as http from "http";
import { IDENTITY_REGISTRY, AGENT_REGISTRY_ID } from "./erc8004/contract";
import { resolveIdentity } from "./identity";
import { readLocalDecisions } from "./store/decision-store";

function buildAgentCard(): Record<string, unknown> {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT ?? "3000"}`;

  const identity = resolveIdentity();

  const card: Record<string, unknown> = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "InvestX for Agents",
    description:
      "Non-custodial R&D agent that follows smart-money flows to rebalance self-funded DeFi yield, " +
      "and publishes a tamper-evident, move-by-move decision log tied to its own ERC-8004 agentId.",
    services: [{ name: "web", endpoint: baseUrl }],
    active: true,
    supportedTrust: ["crypto-economic"],
  };

  if (!identity.provisional) {
    card.registrations = [{ agentRegistry: identity.agentRegistry, agentId: identity.agentId }];
  } else {
    // TODO(identity): replace once ERC-8004 registration is done and INVESTX_AGENT_ID is set.
    card.registrations = [];
    card.provisionalAgentId = identity.agentId;
  }

  return card;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.writeHead(status);
  res.end(JSON.stringify(data, null, 2));
}

export function startHttpServer(): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);

  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";

    if (urlPath === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", ts: new Date().toISOString() });
      return;
    }

    if (urlPath === "/.well-known/agent-card.json" && req.method === "GET") {
      sendJson(res, 200, buildAgentCard());
      return;
    }

    if (urlPath === "/api/decisions/latest" && req.method === "GET") {
      const all = readLocalDecisions();
      sendJson(res, 200, all.length > 0 ? all[all.length - 1] : { message: "no decisions yet" });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(port, () => {
    console.log(`[SERVER] HTTP server listening on port ${port}`);
    console.log(`[SERVER] GET /health`);
    console.log(`[SERVER] GET /.well-known/agent-card.json`);
    console.log(`[SERVER] GET /api/decisions/latest`);
    console.log(`[SERVER] IdentityRegistry: ${IDENTITY_REGISTRY} (${AGENT_REGISTRY_ID})`);
  });

  server.on("error", (err) => console.error(`[SERVER] Error: ${err.message}`));
}
