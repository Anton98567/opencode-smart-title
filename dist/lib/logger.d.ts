export declare class Logger {
    private logDir;
    private enabled;
    constructor(enabled: boolean);
    private ensureLogDir;
    private write;
    info(component: string, message: string, data?: any): Promise<void>;
    debug(component: string, message: string, data?: any): Promise<void>;
    warn(component: string, message: string, data?: any): Promise<void>;
    error(component: string, message: string, data?: any): Promise<void>;
}
//# sourceMappingURL=logger.d.ts.map