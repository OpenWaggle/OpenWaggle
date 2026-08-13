/**
 * Format a duration in ms to a human readable string.
 */
export declare function formatDuration(ms: number): string;
/**
 * Format a timestamp to a relative time string.
 */
export declare function formatRelativeTime(timestamp: number): string;
/**
 * Truncate a string to a max length.
 */
export declare function truncate(str: string, maxLength: number): string;
/**
 * Extract a short project name from a full path.
 */
export declare function projectName(path: string | null): string;
