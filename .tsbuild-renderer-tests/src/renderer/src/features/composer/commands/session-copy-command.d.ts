export type SessionCopyCommand = {
    readonly type: 'fork';
} | {
    readonly type: 'clone';
};
export declare function parseSessionCopyCommand(input: string): SessionCopyCommand | null;
