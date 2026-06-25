import type { RunLog } from "./types";

export function logRun(log: RunLog): void {
  console.log(JSON.stringify(log, null, 2));
}
