import type { SupportedModelId } from '@shared/types/brand';
import { type WaggleAgentColor, type WaggleAgentSlot, type WaggleCollaborationMode, type WaggleConfig, type WagglePreset, type WaggleStopCondition } from '@shared/types/waggle';
export interface WaggleFormState {
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly mode: WaggleCollaborationMode;
    readonly stopCondition: WaggleStopCondition;
    readonly maxTurns: number;
}
export interface WagglePresetState {
    readonly activePresetId: string | null;
    readonly error: string | null;
}
export type WaggleFormAction = {
    readonly type: 'load-preset';
    readonly config: WaggleConfig;
} | {
    readonly type: 'set-agent-label';
    readonly index: 0 | 1;
    readonly label: string;
} | {
    readonly type: 'set-agent-model';
    readonly index: 0 | 1;
    readonly model: SupportedModelId;
} | {
    readonly type: 'set-agent-role';
    readonly index: 0 | 1;
    readonly roleDescription: string;
} | {
    readonly type: 'set-agent-color';
    readonly index: 0 | 1;
    readonly color: WaggleAgentColor;
} | {
    readonly type: 'set-stop-condition';
    readonly stopCondition: WaggleStopCondition;
} | {
    readonly type: 'set-max-turns';
    readonly maxTurns: number;
};
export type WagglePresetAction = {
    readonly type: 'select-preset';
    readonly activePresetId: string;
} | {
    readonly type: 'save-success';
    readonly activePresetId: string;
} | {
    readonly type: 'clear-active-preset';
} | {
    readonly type: 'clear-error';
} | {
    readonly type: 'set-error';
    readonly error: string;
};
export declare const INITIAL_WAGGLE_FORM_STATE: WaggleFormState;
export declare const INITIAL_WAGGLE_PRESET_STATE: WagglePresetState;
export declare function configMatchesPreset(config: WaggleConfig, preset: WagglePreset): boolean;
export declare function buildWaggleConfig(state: WaggleFormState): WaggleConfig;
export declare function waggleFormReducer(state: WaggleFormState, action: WaggleFormAction): WaggleFormState;
export declare function wagglePresetReducer(state: WagglePresetState, action: WagglePresetAction): WagglePresetState;
