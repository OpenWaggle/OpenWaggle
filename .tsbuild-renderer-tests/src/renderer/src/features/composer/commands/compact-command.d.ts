export interface CompactCommand {
    readonly customInstructions?: string;
}
export declare function parseCompactCommand(text: string): CompactCommand | null;
export declare function compactCommandText(customInstructions?: string): string;
