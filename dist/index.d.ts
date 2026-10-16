/**
 * Smart Title Plugin for OpenCode
 *
 * Automatically generates meaningful session titles based on conversation content.
 * Uses OpenCode auth provider for unified authentication across all AI providers.
 *
 * Configuration: ~/.config/opencode/smart-title.jsonc
 * Logs: ~/.config/opencode/logs/smart-title/YYYY-MM-DD.log
 *
 * NOTE: ai package is lazily imported to avoid loading the 2.8MB package during
 * plugin initialization. The package is only loaded when title generation is needed.
 */
import type { Plugin } from "@opencode-ai/plugin";
/**
 * Smart Title Plugin
 * Automatically updates session titles using AI and smart context selection
 */
declare const SmartTitlePlugin: Plugin;
export default SmartTitlePlugin;
//# sourceMappingURL=index.d.ts.map