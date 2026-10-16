import type { PluginInput } from '@opencode-ai/plugin';
export interface PluginConfig {
    enabled: boolean;
    debug: boolean;
    model?: string;
    prompt?: string;
    updateThreshold: number;
    cmuxSync: boolean;
}
/**
 * Loads configuration with support for both global and project-level configs
 *
 * Config resolution order:
 * 1. Start with default config
 * 2. Merge with global config (~/.config/opencode/smart-title.jsonc)
 * 3. Merge with project config (.opencode/smart-title.jsonc) if found
 *
 * Project config overrides global config, which overrides defaults.
 *
 * @param ctx - Plugin input context (optional). If provided, will search for project-level config.
 * @returns Merged configuration
 */
export declare function getConfig(ctx?: PluginInput): PluginConfig;
//# sourceMappingURL=config.d.ts.map