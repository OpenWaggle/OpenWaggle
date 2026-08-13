import type { JsonObject } from '@shared/types/json';
/**
 * Safely parse a JSON string of tool arguments into a record.
 * Returns an empty object if parsing fails.
 */
export declare function parseToolArgs(args: string): JsonObject;
