import type { JsonValue } from '@shared/types/json';
export declare function stringArray(value: unknown): value is string[];
export declare function isJsonValue(value: unknown): value is JsonValue;
export declare function isOptionalJsonValue(value: unknown): value is JsonValue | undefined;
