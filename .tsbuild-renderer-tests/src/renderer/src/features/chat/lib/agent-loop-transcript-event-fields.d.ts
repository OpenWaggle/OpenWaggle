import type { JsonValue } from '@shared/types/json';
export type UnknownObject = {
    readonly [key: string]: unknown;
};
export interface AgentLoopBaseEventFields {
    readonly timestamp: number;
    readonly model?: string;
    readonly rawEvent?: JsonValue;
}
export declare function isObject(value: unknown): value is UnknownObject;
export declare function stringField(value: UnknownObject, key: string): string | null;
export declare function numberField(value: UnknownObject, key: string): number | null;
export declare function optionalJsonValue(value: unknown): JsonValue | undefined;
export declare function parseJsonObject(raw: string): UnknownObject | null;
export declare function baseEventFields(event: UnknownObject): AgentLoopBaseEventFields | null;
