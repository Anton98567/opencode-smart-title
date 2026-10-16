import { Logger } from "./logger.js";
/**
 * Updates the cmux workspace sidebar title via cmux RPC.
 *
 * cmux exposes the current workspace UUID through CMUX_WORKSPACE_ID and the
 * bundled CLI path through CMUX_BUNDLED_CLI_PATH when it spawns the agent
 * process. We don't need any state-file parsing or workspace lookup: each
 * opencode process maps 1:1 to a cmux workspace, so every session.status
 * event we observe (subagents filtered out upstream) belongs here.
 *
 * No-ops when CMUX_WORKSPACE_ID is absent (opencode running outside cmux).
 */
export declare function syncCmuxSidebar(title: string, logger: Logger): Promise<void>;
//# sourceMappingURL=cmux-sync.d.ts.map