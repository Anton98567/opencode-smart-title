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
import { getConfig } from "./lib/config.js";
import { Logger } from "./lib/logger.js";
import { syncCmuxSidebar } from "./lib/cmux-sync.js";
import { TITLE_PROMPT } from "./prompt.js";
import { join } from "path";
import { homedir } from "os";
/**
 * Checks if a session is a subagent (child session)
 * Subagent sessions should skip title generation
 */
async function isSubagentSession(client, sessionID, logger) {
    try {
        const result = await client.session.get({ path: { id: sessionID } });
        if (result.data?.parentID) {
            logger.debug("subagent-check", "Detected subagent session, skipping title generation", {
                sessionID,
                parentID: result.data.parentID
            });
            return true;
        }
        return false;
    }
    catch (error) {
        logger.error("subagent-check", "Failed to check if session is subagent", {
            sessionID,
            error: error.message
        });
        return false;
    }
}
// Track idle event count per session for threshold-based updates
const sessionIdleCount = new Map();
// LOCAL PATCH: only one title update per session at a time
// (duplicate idle events used to spawn parallel "smart-title" child sessions)
const titleUpdatesInFlight = new Set();
/**
 * Extract only text content from message parts, excluding synthetic content
 */
function extractTextOnly(parts) {
    // Only extract text parts, exclude synthetic content
    const textParts = parts.filter(part => part.type === "text" && !part.synthetic);
    return textParts
        .map(part => part.text || '')
        .join("\n")
        .trim();
}
/**
 * Extract smart context from conversation
 * Returns first and last assistant messages per turn to minimize token usage
 */
async function extractSmartContext(client, sessionId, logger) {
    logger.debug('context-extraction', 'Fetching session messages', { sessionId });
    // Get all messages
    const { data: messages } = await client.session.messages({
        path: { id: sessionId }
    });
    logger.debug('context-extraction', 'Messages fetched', {
        sessionId,
        totalMessages: messages.length
    });
    // Filter out system messages
    const conversationMessages = messages.filter((msg) => msg.info.role === "user" || msg.info.role === "assistant");
    logger.debug('context-extraction', 'Filtered conversation messages', {
        sessionId,
        conversationMessages: conversationMessages.length
    });
    // Group into turns
    const turns = [];
    let currentTurn = null;
    let assistantMessagesInTurn = [];
    for (const msg of conversationMessages) {
        if (msg.info.role === "user") {
            // Save previous turn if exists
            if (currentTurn && assistantMessagesInTurn.length > 0) {
                currentTurn.assistant = {
                    first: assistantMessagesInTurn[0].text,
                    last: assistantMessagesInTurn[assistantMessagesInTurn.length - 1].text,
                    time: assistantMessagesInTurn[0].time
                };
                turns.push(currentTurn);
            }
            // Start new turn
            const userText = extractTextOnly(msg.parts);
            currentTurn = {
                user: {
                    text: userText,
                    time: msg.info.time.created
                }
            };
            assistantMessagesInTurn = [];
        }
        else if (msg.info.role === "assistant") {
            // Collect assistant messages for this turn
            const assistantText = extractTextOnly(msg.parts);
            if (assistantText.length > 0) {
                assistantMessagesInTurn.push({
                    text: assistantText,
                    time: msg.info.time.created
                });
            }
        }
    }
    // Don't forget the last turn (might not have assistant response yet)
    if (currentTurn) {
        if (assistantMessagesInTurn.length > 0) {
            currentTurn.assistant = {
                first: assistantMessagesInTurn[0].text,
                last: assistantMessagesInTurn[assistantMessagesInTurn.length - 1].text,
                time: assistantMessagesInTurn[0].time
            };
        }
        // Include the turn even if it doesn't have an assistant response yet
        // This ensures the triggering user message is included in the context
        turns.push(currentTurn);
    }
    logger.debug('context-extraction', 'Extracted conversation turns', {
        sessionId,
        turnCount: turns.length
    });
    return turns;
}
/**
 * Truncate text to specified length with ellipsis
 */
function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return text.substring(0, maxLength) + "...";
}
/**
 * Format conversation context for title generation
 */
function formatContextForTitle(turns) {
    const formatted = [];
    for (const turn of turns) {
        // Add user message
        formatted.push(`User: ${turn.user.text}`);
        formatted.push(""); // Empty line for readability
        // Add assistant messages if they exist
        if (turn.assistant) {
            if (turn.assistant.first === turn.assistant.last) {
                // Only one message - don't duplicate
                formatted.push(`Assistant: ${turn.assistant.first}`);
            }
            else {
                // Multiple messages - show first and last
                formatted.push(`Assistant (initial): ${turn.assistant.first}`);
                formatted.push(`Assistant (final): ${turn.assistant.last}`);
            }
            formatted.push(""); // Empty line between turns
        }
    }
    return formatted.join("\n");
}
/**
 * Clean AI-generated title
 */
function cleanTitle(raw) {
    // Remove thinking tags
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
    // Get first non-empty line
    const lines = cleaned.split("\n").map(line => line.trim());
    cleaned = lines.find(line => line.length > 0) || "Untitled";
    // Truncate if too long
    if (cleaned.length > 100) {
        cleaned = cleaned.substring(0, 97) + "...";
    }
    return cleaned;
}
/**
 * Parse model string "provider/model" into providerID and modelID
 * LOCAL PATCH: split on the FIRST slash only, so model IDs that themselves
 * contain slashes (e.g. "openrouter/anthropic/claude-sonnet-4") keep working.
 */
function parseModel(configModel) {
    if (!configModel || typeof configModel !== 'string')
        return null;
    const trimmed = configModel.trim();
    const idx = trimmed.indexOf('/');
    if (idx <= 0 || idx === trimmed.length - 1)
        return null;
    return { providerID: trimmed.slice(0, idx), modelID: trimmed.slice(idx + 1) };
}
/**
 * Resolve ordered list of models to try for title generation:
 * 1. Explicit config "model" (if set) - kept as first choice for pinning
 * 2. The model of the parent session (whatever the user is currently chatting with)
 * 3. null -> let opencode pick its default model
 * LOCAL PATCH: titles now follow "current model or any model", not just one pinned model.
 */
async function resolveModelCandidates(client, parentSessionId, configModel, logger) {
    const candidates = [];
    const seen = new Set();
    const push = (m) => {
        const key = m ? `${m.providerID}/${m.modelID}` : "default";
        if (seen.has(key))
            return;
        seen.add(key);
        candidates.push(m);
    };
    const fromConfig = parseModel(configModel);
    if (fromConfig) {
        push(fromConfig);
    }
    try {
        const result = await client.session.get({ path: { id: parentSessionId } });
        const sessionModel = result.data?.model;
        const modelID = sessionModel?.id ?? sessionModel?.modelID;
        if (sessionModel?.providerID && modelID) {
            push({ providerID: sessionModel.providerID, modelID });
        }
    }
    catch (error) {
        logger.warn('title-generation', 'Failed to read parent session model', {
            parentSessionId,
            error: error.message
        });
    }
    push(null);
    return candidates;
}
/**
 * Race a promise against a timeout. On timeout the promise is abandoned
 * (the caller must abort/cleanup the underlying session itself).
 * LOCAL PATCH: big-pickle hung forever on rate-limit, leaking child sessions.
 */
function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
/**
 * Extract assistant response text from session messages
 */
async function extractAssistantResponse(client, sessionId, logger) {
    const { data: messages } = await client.session.messages({ path: { id: sessionId } });
    const assistantMessages = messages?.filter((msg) => msg.info.role === "assistant");
    if (!assistantMessages || assistantMessages.length === 0)
        return null;
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    return extractTextOnly(lastMessage.parts) || null;
}
/**
 * Generate title from conversation context using AI via opencode subagent session
 */
async function generateTitleFromContext(context, configModel, logger, client, parentSessionId, directory, customPrompt) {
    const candidates = await resolveModelCandidates(client, parentSessionId, configModel, logger);
    logger.info('title-generation', 'Model candidates resolved', {
        candidates: candidates.map(m => m ? `${m.providerID}/${m.modelID}` : 'default'),
        configModel: configModel || null
    });
    for (const modelInfo of candidates) {
        const label = modelInfo ? `${modelInfo.providerID}/${modelInfo.modelID}` : 'default';
        const title = await attemptTitleGeneration(context, modelInfo, label, logger, client, parentSessionId, directory, customPrompt);
        if (title) {
            return title;
        }
        logger.warn('title-generation', 'Candidate failed, trying next', { model: label });
    }
    return null;
}
/**
 * Single title-generation attempt with a given model.
 * LOCAL PATCH: prompt is wrapped in a timeout and the child session is aborted
 * on hang, so a stuck model can no longer leak "smart-title" sessions forever.
 */
const PROMPT_TIMEOUT_MS = 45000;
async function attemptTitleGeneration(context, modelInfo, modelLabel, logger, client, parentSessionId, directory, customPrompt) {
    let childSessionId = null;
    try {
        logger.info('title-generation', 'Creating subagent session for title generation', {
            model: modelLabel,
            parentSessionId
        });
        // Create child session
        const createResponse = await client.session.create({
            body: { parentID: parentSessionId, title: "smart-title" },
            query: directory ? { directory } : undefined
        });
        const createdSession = createResponse?.data ?? createResponse;
        childSessionId = typeof createdSession?.id === "string" ? createdSession.id : null;
        if (!childSessionId) {
            logger.error('title-generation', 'Failed to create child session');
            return null;
        }
        logger.debug('title-generation', 'Child session created', {
            childSessionId,
            model: modelLabel
        });
        const prompt = customPrompt || TITLE_PROMPT;
        logger.debug('title-generation', 'Generating title via subagent', {
            contextLength: context.length,
            promptSource: customPrompt ? 'custom' : 'built-in'
        });
        // LOCAL PATCH: language of the conversation is detected locally and passed
        // explicitly — the model does not always follow the language instruction
        // on its own (it kept answering in Russian for English conversations).
        const detectedLanguage = /[\u0400-\u04FF]/.test(context) ? 'ru' : 'en';
        logger.debug('title-generation', 'Detected conversation language', {
            detectedLanguage
        });
        // Send prompt to child session (with timeout guard)
        try {
            await withTimeout(client.session.prompt({
                path: { id: childSessionId },
                query: directory ? { directory } : undefined,
                body: {
                    ...(modelInfo ? { model: modelInfo } : {}),
                    parts: [{
                            type: "text",
                            text: `${prompt}\n\n<detected_language>${detectedLanguage}</detected_language>\n\n<conversation>\n${context}\n</conversation>\n\nOutput the title now:`
                        }]
                }
            }), PROMPT_TIMEOUT_MS, `session.prompt(${modelLabel})`);
        }
        catch (promptError) {
            logger.warn('title-generation', 'Prompt failed or timed out, aborting child session', {
                model: modelLabel,
                error: promptError.message
            });
            try {
                await client.session.abort({ path: { id: childSessionId } });
            }
            catch { /* best effort */ }
            return null;
        }
        // Extract response
        const responseText = await extractAssistantResponse(client, childSessionId, logger);
        if (!responseText) {
            logger.warn('title-generation', 'No response from subagent', { model: modelLabel });
            return null;
        }
        const title = cleanTitle(responseText);
        logger.info('title-generation', 'Title generated successfully', {
            model: modelLabel,
            title,
            titleLength: title.length,
            rawLength: responseText.length
        });
        return title;
    }
    catch (error) {
        logger.error('title-generation', 'Failed to generate title', {
            model: modelLabel,
            error: error.message,
            stack: error.stack
        });
        return null;
    }
    finally {
        // Cleanup child session
        if (childSessionId) {
            try {
                await client.session.delete({ path: { id: childSessionId } });
                logger.debug('title-generation', 'Child session cleaned up', { childSessionId });
            }
            catch (cleanupError) {
                logger.debug('title-generation', 'Failed to clean up child session', {
                    childSessionId,
                    error: cleanupError.message
                });
            }
        }
    }
}
/**
 * Update session title with smart context
 */
async function updateSessionTitle(client, sessionId, logger, config, directory) {
    try {
        logger.info('update-title', 'Title update triggered', { sessionId });
        // Extract smart context
        const turns = await extractSmartContext(client, sessionId, logger);
        // Need at least one turn to generate title
        if (turns.length === 0) {
            logger.warn('update-title', 'No conversation turns found', { sessionId });
            return;
        }
        logger.info('update-title', 'Context extracted', {
            sessionId,
            turnCount: turns.length
        });
        // Log truncated context for debugging
        for (const turn of turns) {
            logger.debug('update-title', 'Turn context', {
                user: truncate(turn.user.text, 100),
                hasAssistant: !!turn.assistant
            });
        }
        // Format context
        const context = formatContextForTitle(turns);
        // Generate title via subagent
        const newTitle = await generateTitleFromContext(context, config.model, logger, client, sessionId, directory, config.prompt);
        if (!newTitle) {
            logger.warn('update-title', 'Title generation returned null', { sessionId });
            return;
        }
        logger.info('update-title', 'Updating session with new title', {
            sessionId,
            title: newTitle
        });
        // Update session
        await client.session.update({
            path: { id: sessionId },
            body: { title: newTitle }
        });
        logger.info('update-title', 'Session title updated successfully', {
            sessionId,
            title: newTitle
        });
        if (config.cmuxSync) {
            await syncCmuxSidebar(newTitle, logger);
        }
    }
    catch (error) {
        logger.error('update-title', 'Failed to update session title', {
            sessionId,
            error: error.message,
            stack: error.stack
        });
    }
}
/**
 * Smart Title Plugin
 * Automatically updates session titles using AI and smart context selection
 */
const SmartTitlePlugin = async (ctx) => {
    const config = getConfig(ctx);
    // Exit early if plugin is disabled
    if (!config.enabled) {
        return {};
    }
    const logger = new Logger(config.debug);
    const { client } = ctx;
    logger.info('plugin', 'Smart Title plugin initialized', {
        enabled: config.enabled,
        debug: config.debug,
        model: config.model,
        updateThreshold: config.updateThreshold,
        globalConfigFile: join(homedir(), ".config", "opencode", "smart-title.jsonc"),
        projectConfigFile: ctx.directory ? join(ctx.directory, ".opencode", "smart-title.jsonc") : "N/A",
        logDirectory: join(homedir(), ".config", "opencode", "logs", "smart-title")
    });
    return {
        event: async ({ event }) => {
            // @ts-ignore - session.status is not yet in the SDK types
            if (event.type === "session.status" && event.properties.status.type === "idle") {
                // @ts-ignore
                const sessionId = event.properties.sessionID;
                logger.debug('event', 'Session became idle', { sessionId });
                // Skip if this is a subagent session
                if (await isSubagentSession(client, sessionId, logger)) {
                    return;
                }
                // Increment idle count for this session
                const currentCount = (sessionIdleCount.get(sessionId) || 0) + 1;
                sessionIdleCount.set(sessionId, currentCount);
                logger.debug('event', 'Idle count updated', {
                    sessionId,
                    currentCount,
                    threshold: config.updateThreshold
                });
                // Only update title if we've reached the threshold
                if (currentCount % config.updateThreshold !== 0) {
                    logger.debug('event', 'Threshold not reached, skipping title update', {
                        sessionId,
                        currentCount,
                        threshold: config.updateThreshold
                    });
                    return;
                }
                logger.info('event', 'Threshold reached, triggering title update for idle session', {
                    sessionId,
                    currentCount,
                    threshold: config.updateThreshold
                });
                // Fire and forget - don't block the event handler
                if (titleUpdatesInFlight.has(sessionId)) {
                    logger.debug('event', 'Title update already in flight, skipping', { sessionId });
                    return;
                }
                titleUpdatesInFlight.add(sessionId);
                updateSessionTitle(client, sessionId, logger, config, ctx.directory)
                    .catch((error) => {
                    logger.error('event', 'Title update failed', {
                        sessionId,
                        error: error.message,
                        stack: error.stack
                    });
                })
                    .finally(() => {
                    titleUpdatesInFlight.delete(sessionId);
                });
            }
        }
    };
};
export default SmartTitlePlugin;
//# sourceMappingURL=index.js.map