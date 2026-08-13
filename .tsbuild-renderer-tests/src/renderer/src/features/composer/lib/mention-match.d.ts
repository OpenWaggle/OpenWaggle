export interface MentionMatch {
    readonly query: string;
    readonly startOffset: number;
}
export declare function findMentionMatch(textContent: string, offset: number): {
    query: string;
    startOffset: number;
} | null;
