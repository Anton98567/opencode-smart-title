// lib/cmux-sync.ts
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const CMUX_TITLE_PREFIX = "OC | ";
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
export async function syncCmuxSidebar(title, logger) {
    const workspaceId = process.env.CMUX_WORKSPACE_ID;
    if (!workspaceId) {
        logger.debug("cmux-sync", "CMUX_WORKSPACE_ID not set, skipping");
        return;
    }
    const cmuxBin = process.env.CMUX_BUNDLED_CLI_PATH || "cmux";
    const sidebarTitle = `${CMUX_TITLE_PREFIX}${title}`;
    try {
        await execFileAsync(cmuxBin, [
            "rpc",
            "workspace.rename",
            JSON.stringify({ workspace_id: workspaceId, title: sidebarTitle })
        ]);
        logger.info("cmux-sync", "cmux sidebar title updated", { workspaceId, title: sidebarTitle });
    }
    catch (error) {
        logger.debug("cmux-sync", "Failed to sync cmux sidebar (non-fatal)", {
            workspaceId,
            error: error?.message
        });
    }
}
//# sourceMappingURL=cmux-sync.js.map