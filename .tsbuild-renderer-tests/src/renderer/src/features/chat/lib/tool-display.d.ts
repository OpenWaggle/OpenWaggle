import type { JsonObject } from '@shared/types/json';
interface ActionTextParams {
    readonly name: string;
    readonly args: JsonObject;
    readonly awaitingResult: boolean;
    readonly isError: boolean;
    readonly isRunning: boolean;
}
export declare function resolveActionText(params: ActionTextParams): string;
export {};
