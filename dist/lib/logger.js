// lib/logger.ts
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
export class Logger {
    logDir;
    enabled;
    constructor(enabled) {
        this.enabled = enabled;
        // Always save logs to ~/.config/opencode/logs/smart-title/ regardless of installation method
        // This ensures users can find logs in a consistent location
        const opencodeConfigDir = join(homedir(), ".config", "opencode");
        this.logDir = join(opencodeConfigDir, "logs", "smart-title");
    }
    async ensureLogDir() {
        if (!existsSync(this.logDir)) {
            await mkdir(this.logDir, { recursive: true });
        }
    }
    async write(level, component, message, data) {
        if (!this.enabled)
            return;
        try {
            await this.ensureLogDir();
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                level,
                component,
                message,
                ...(data && { data })
            };
            const logFile = join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
            const logLine = JSON.stringify(logEntry) + "\n";
            await writeFile(logFile, logLine, { flag: "a" });
        }
        catch (error) {
            // Silently fail - don't break the plugin if logging fails
        }
    }
    info(component, message, data) {
        return this.write("INFO", component, message, data);
    }
    debug(component, message, data) {
        return this.write("DEBUG", component, message, data);
    }
    warn(component, message, data) {
        return this.write("WARN", component, message, data);
    }
    error(component, message, data) {
        return this.write("ERROR", component, message, data);
    }
}
//# sourceMappingURL=logger.js.map