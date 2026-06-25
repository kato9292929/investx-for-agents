/**
 * Webhook notification for brake events (mandate section 4/5).
 *
 * Only the protective brakes notify: STOP (whole-account drawdown) and EVACUATE
 * (a held pool's TVL collapsed). Routine MOVE/HOLD decisions are recorded to the
 * store but do not page anyone.
 */
export async function sendBrakeNotification(
  action: "STOP" | "EVACUATE",
  reason: string
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = action === "STOP" ? "🛑" : "⚠️";
  const text = `${emoji} InvestX ブレーキ発動 — ${action}\n${reason}`;
  const isDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);
  const payload = isDiscord ? { content: text } : { text };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[notify] Webhook failed:", err);
  }
}
