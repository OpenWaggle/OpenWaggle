# @openwaggle/pi-waggle

Package path: `packages/pi-waggle`

## Export `.`

Types: `dist/index.d.ts`

### Declarations from `dist/index.d.ts`

```ts
export * from './commands.js';
export * from './extension.js';
export * from './mode-state.js';
export * from './preset-storage.js';
export * from './presets.js';
export * from './protocol.js';
export * from './renderers.js';
export * from './stop-policy.js';
```

### Declarations from `dist/commands.d.ts`

```ts
export type PiWaggleCommandIntent = {
    readonly type: 'menu';
} | {
    readonly type: 'activate-preset';
    readonly presetId: string;
    readonly prompt?: string;
} | {
    readonly type: 'create-preset';
} | {
    readonly type: 'edit-preset';
    readonly presetId?: string;
} | {
    readonly type: 'edit-config';
} | {
    readonly type: 'edit-turns';
    readonly maxTurns?: string;
} | {
    readonly type: 'disable';
};
export declare function parsePiWaggleCommandArgs(args: string): PiWaggleCommandIntent;
```

### Declarations from `dist/extension.d.ts`

```ts
import defaultPiWaggleExtension from './default-extension.js';
export * from './loop.js';
export default defaultPiWaggleExtension;
```

### Declarations from `dist/default-extension.d.ts`

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function defaultPiWaggleExtension(pi: ExtensionAPI): void;
```

### Declarations from `dist/loop.d.ts`

```ts
import type { AgentEndEvent, ExtensionAPI, ExtensionContext, ExtensionFactory, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig, WaggleTurn } from '@openwaggle/waggle-core';
export type PiWaggleModel = NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>;
export type PiWaggleCustomMessage = Parameters<ExtensionAPI['sendMessage']>[0];
export type PiWaggleSendMessageOptions = NonNullable<Parameters<ExtensionAPI['sendMessage']>[1]>;
export interface PiWaggleTurnMetadataInput {
    readonly turnNumber: number;
    readonly agentIndex: number;
}
export interface PiWaggleTurnCompleteInput<TMeta> {
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
    readonly messages: AgentEndEvent['messages'];
}
export interface PiWaggleTurnDecision {
    readonly continue: boolean;
}
export interface PiWaggleTurnMessageInput<TMeta> {
    readonly model: PiWaggleModel;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleStartNextTurnInput<TMeta> extends PiWaggleTurnMessageInput<TMeta> {
    readonly message: PiWaggleCustomMessage;
}
export interface PiWaggleResolveTurnModelInput<TMeta> {
    readonly ctx: PiWaggleExtensionContext;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleExtensionInput<TMeta> {
    readonly config: WaggleConfig;
    readonly createTurnMetadata: (input: PiWaggleTurnMetadataInput) => TMeta;
    readonly onTurnComplete: (input: PiWaggleTurnCompleteInput<TMeta>) => PiWaggleTurnDecision | Promise<PiWaggleTurnDecision>;
    readonly buildTurnMessage: (input: PiWaggleTurnMessageInput<TMeta>) => PiWaggleCustomMessage;
    readonly resolveTurnModel?: (input: PiWaggleResolveTurnModelInput<TMeta>) => PiWaggleModel | Promise<PiWaggleModel>;
    readonly startNextTurn?: (input: PiWaggleStartNextTurnInput<TMeta>) => void | Promise<void>;
    readonly canStartNextTurn?: () => boolean;
    readonly onActiveTurnChange?: (meta: TMeta) => void;
    readonly onTurnStart?: (meta: TMeta) => void;
}
export interface PiWaggleLoopInput<TMeta> extends PiWaggleExtensionInput<TMeta> {
    readonly onComplete: () => void;
    readonly onError: (error: unknown) => void;
}
export type PiWaggleAgentEndHandler = (event: AgentEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export type PiWaggleTurnEndHandler = (event: TurnEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export interface PiWaggleExtensionContext {
    readonly modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'>;
}
export interface PiWaggleLoopApi {
    readonly sendMessage: ExtensionAPI['sendMessage'];
    readonly setModel: ExtensionAPI['setModel'];
}
export interface PiWaggleExtensionApi extends PiWaggleLoopApi {
    readonly onAgentEnd: (handler: PiWaggleAgentEndHandler) => void;
}
export interface PiWaggleExtensionController {
    readonly factory: ExtensionFactory;
    readonly done: Promise<void>;
}
export declare function createPiWaggleLoopHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleAgentEndHandler;
export interface PiWaggleTurnCompletionHandlers {
    readonly onTurnEnd: PiWaggleTurnEndHandler;
    readonly onAgentEnd: PiWaggleAgentEndHandler;
}
export declare function createPiWaggleTurnCompletionHandlers<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnCompletionHandlers;
export declare function createPiWaggleTurnEndHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnEndHandler;
export declare function registerPiWaggleLoop<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleExtensionApi): void;
export declare function createPiWaggleExtension<TMeta>(input: PiWaggleExtensionInput<TMeta>): PiWaggleExtensionController;
```

### Declarations from `dist/mode-state.d.ts`

```ts
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig } from '@openwaggle/waggle-core';
import { type PiWaggleModeState } from './protocol.js';
export interface PiWaggleModeStateWriter {
    readonly appendCustomEntry: (customType: string, data?: unknown) => string | undefined;
}
export interface PiWaggleModeStateReader {
    readonly getBranch: () => readonly SessionEntry[];
}
export declare function enabledPiWaggleModeState(input: {
    readonly config: WaggleConfig;
    readonly presetId?: string;
    readonly updatedAt?: number;
}): PiWaggleModeState;
export declare function disabledPiWaggleModeState(input?: {
    readonly updatedAt?: number;
}): PiWaggleModeState;
export declare function appendPiWaggleModeState(writer: PiWaggleModeStateWriter, state: PiWaggleModeState): string | undefined;
export declare function latestPiWaggleModeStateFromEntries(entries: readonly SessionEntry[]): PiWaggleModeState | null;
export declare function latestPiWaggleModeStateFromBranch(sessionManager: PiWaggleModeStateReader): PiWaggleModeState | null;
```

### Declarations from `dist/protocol.d.ts`

```ts
import { type WaggleAgentColor, type WaggleConfig } from '@openwaggle/waggle-core';
export declare const PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE = "pi-waggle.user-request";
export declare const PI_WAGGLE_TURN_CUSTOM_TYPE = "pi-waggle.turn";
export declare const PI_WAGGLE_MODE_STATE_CUSTOM_TYPE = "pi-waggle.mode-state";
export interface PiWaggleTurnDetails {
    readonly runId: string;
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentModel: string;
    readonly agentColor: WaggleAgentColor;
}
export interface PiWaggleModeState {
    readonly enabled: boolean;
    readonly presetId?: string;
    readonly config?: WaggleConfig;
    readonly updatedAt: number;
}
export declare function createPiWaggleTurnDetails(input: PiWaggleTurnDetails): PiWaggleTurnDetails;
export declare function parsePiWaggleTurnDetails(value: unknown): PiWaggleTurnDetails | null;
export declare function createPiWaggleModeState(input: PiWaggleModeState): PiWaggleModeState;
export declare function parsePiWaggleModeState(value: unknown): PiWaggleModeState | null;
```

### Declarations from `dist/preset-storage.d.ts`

```ts
import { type WagglePreset } from '@openwaggle/waggle-core';
export interface PiWagglePresetsFileData {
    readonly wagglePresets: readonly WagglePreset[];
    readonly hiddenBuiltInPresetIds: readonly string[];
}
export declare function getPiWaggleUserPresetsPath(agentDir?: string): string;
export declare function getPiWaggleProjectPresetsPath(projectPath: string): string;
export declare function readPiWagglePresetsFileData(filePath: string): Promise<PiWagglePresetsFileData>;
export declare function readPiWagglePresetsFile(filePath: string): Promise<readonly WagglePreset[]>;
export declare function writePiWagglePresetsFileData(filePath: string, data: PiWagglePresetsFileData): Promise<void>;
export declare function writePiWagglePresetsFile(filePath: string, presets: readonly WagglePreset[]): Promise<void>;
```

### Declarations from `dist/presets.d.ts`

```ts
import { type WagglePreset } from '@openwaggle/waggle-core';
export type PiWagglePresetScope = 'built-in' | 'user' | 'project';
export type PiWaggleEditablePresetScope = Exclude<PiWagglePresetScope, 'built-in'>;
export interface PiWagglePresetLayers {
    readonly builtIns: readonly WagglePreset[];
    readonly userPresets: readonly WagglePreset[];
    readonly projectPresets: readonly WagglePreset[];
    readonly userHiddenBuiltInPresetIds: readonly string[];
    readonly projectHiddenBuiltInPresetIds: readonly string[];
}
export interface PiWaggleResolvedPreset {
    readonly preset: WagglePreset;
    readonly scope: PiWagglePresetScope;
}
export interface PiWaggleHiddenBuiltInPreset {
    readonly preset: WagglePreset;
    readonly scope: PiWaggleEditablePresetScope;
}
export declare function loadPiWagglePresetLayers(cwd?: string): Promise<PiWagglePresetLayers>;
export declare function mergePiWagglePresetLayers(layers: PiWagglePresetLayers): readonly PiWaggleResolvedPreset[];
export declare function resolvedPresetsForUi(layers: PiWagglePresetLayers): PiWaggleResolvedPreset[];
export declare function hiddenBuiltInPresetsForUi(layers: PiWagglePresetLayers): PiWaggleHiddenBuiltInPreset[];
export declare function presetScopeLabel(scope: PiWaggleEditablePresetScope): "Project (.pi/waggle-presets.json)" | "User (~/.pi/agent/waggle-presets.json)";
export declare function savePiWagglePreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly preset: WagglePreset;
}): Promise<void>;
export declare function deletePiWaggleCustomPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function suppressPiWaggleBuiltInPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function restorePiWaggleBuiltInPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function buildEditablePreset(input: {
    readonly base: Omit<WagglePreset, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>;
    readonly existingId?: string;
    readonly existingIds: ReadonlySet<string>;
    readonly existingCreatedAt?: number;
}): {
    id: string;
    name: string;
    description: string;
    config: import("@openwaggle/waggle-core").WaggleConfig;
    isBuiltIn: false;
    createdAt: number;
    updatedAt: number;
};
```

### Declarations from `dist/renderers.d.ts`

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
type MessageRendererRegistrar = Pick<ExtensionAPI, 'registerMessageRenderer'>;
export declare function registerPiWaggleRenderers(pi: MessageRendererRegistrar): void;
export {};
```

### Declarations from `dist/stop-policy.d.ts`

```ts
import type { AgentEndEvent } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig, WaggleConsensusCheckResult } from '@openwaggle/waggle-core';
interface UnresolvedToolCall {
    readonly id: string;
    readonly name: string;
}
export interface PiWaggleTurnSummary {
    readonly responseText: string;
    readonly hasToolCalls: boolean;
    readonly unresolvedToolCalls: readonly UnresolvedToolCall[];
    readonly aborted: boolean;
    readonly terminalError?: string;
}
export interface PiWaggleStopPolicyState {
    readonly consecutiveErrorTurns: number;
    readonly successfulTurnCount: number;
    readonly lastAssistantTexts: readonly [string, string];
}
export interface PiWaggleStopPolicyDecision {
    readonly continue: boolean;
    readonly state: PiWaggleStopPolicyState;
    readonly turnSucceeded: boolean;
    readonly consensus?: WaggleConsensusCheckResult;
    readonly stop?: {
        readonly classification: 'complete' | 'stopped';
        readonly reason: string;
    };
}
export declare function createPiWaggleStopPolicyState(): PiWaggleStopPolicyState;
export declare function summarizePiWaggleTurnMessages(messages: readonly AgentEndEvent['messages'][number][]): PiWaggleTurnSummary;
export declare function evaluatePiWaggleStopPolicy(input: {
    readonly config: WaggleConfig;
    readonly turnNumber: number;
    readonly summary: PiWaggleTurnSummary;
    readonly state: PiWaggleStopPolicyState;
    readonly agentLabel: string;
}): PiWaggleStopPolicyDecision;
export {};
```

## Export `./commands`

Types: `dist/commands.d.ts`

### Declarations from `dist/commands.d.ts`

```ts
export type PiWaggleCommandIntent = {
    readonly type: 'menu';
} | {
    readonly type: 'activate-preset';
    readonly presetId: string;
    readonly prompt?: string;
} | {
    readonly type: 'create-preset';
} | {
    readonly type: 'edit-preset';
    readonly presetId?: string;
} | {
    readonly type: 'edit-config';
} | {
    readonly type: 'edit-turns';
    readonly maxTurns?: string;
} | {
    readonly type: 'disable';
};
export declare function parsePiWaggleCommandArgs(args: string): PiWaggleCommandIntent;
```

## Export `./extension`

Types: `dist/extension.d.ts`

### Declarations from `dist/extension.d.ts`

```ts
import defaultPiWaggleExtension from './default-extension.js';
export * from './loop.js';
export default defaultPiWaggleExtension;
```

### Declarations from `dist/default-extension.d.ts`

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function defaultPiWaggleExtension(pi: ExtensionAPI): void;
```

### Declarations from `dist/loop.d.ts`

```ts
import type { AgentEndEvent, ExtensionAPI, ExtensionContext, ExtensionFactory, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig, WaggleTurn } from '@openwaggle/waggle-core';
export type PiWaggleModel = NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>;
export type PiWaggleCustomMessage = Parameters<ExtensionAPI['sendMessage']>[0];
export type PiWaggleSendMessageOptions = NonNullable<Parameters<ExtensionAPI['sendMessage']>[1]>;
export interface PiWaggleTurnMetadataInput {
    readonly turnNumber: number;
    readonly agentIndex: number;
}
export interface PiWaggleTurnCompleteInput<TMeta> {
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
    readonly messages: AgentEndEvent['messages'];
}
export interface PiWaggleTurnDecision {
    readonly continue: boolean;
}
export interface PiWaggleTurnMessageInput<TMeta> {
    readonly model: PiWaggleModel;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleStartNextTurnInput<TMeta> extends PiWaggleTurnMessageInput<TMeta> {
    readonly message: PiWaggleCustomMessage;
}
export interface PiWaggleResolveTurnModelInput<TMeta> {
    readonly ctx: PiWaggleExtensionContext;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleExtensionInput<TMeta> {
    readonly config: WaggleConfig;
    readonly createTurnMetadata: (input: PiWaggleTurnMetadataInput) => TMeta;
    readonly onTurnComplete: (input: PiWaggleTurnCompleteInput<TMeta>) => PiWaggleTurnDecision | Promise<PiWaggleTurnDecision>;
    readonly buildTurnMessage: (input: PiWaggleTurnMessageInput<TMeta>) => PiWaggleCustomMessage;
    readonly resolveTurnModel?: (input: PiWaggleResolveTurnModelInput<TMeta>) => PiWaggleModel | Promise<PiWaggleModel>;
    readonly startNextTurn?: (input: PiWaggleStartNextTurnInput<TMeta>) => void | Promise<void>;
    readonly canStartNextTurn?: () => boolean;
    readonly onActiveTurnChange?: (meta: TMeta) => void;
    readonly onTurnStart?: (meta: TMeta) => void;
}
export interface PiWaggleLoopInput<TMeta> extends PiWaggleExtensionInput<TMeta> {
    readonly onComplete: () => void;
    readonly onError: (error: unknown) => void;
}
export type PiWaggleAgentEndHandler = (event: AgentEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export type PiWaggleTurnEndHandler = (event: TurnEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export interface PiWaggleExtensionContext {
    readonly modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'>;
}
export interface PiWaggleLoopApi {
    readonly sendMessage: ExtensionAPI['sendMessage'];
    readonly setModel: ExtensionAPI['setModel'];
}
export interface PiWaggleExtensionApi extends PiWaggleLoopApi {
    readonly onAgentEnd: (handler: PiWaggleAgentEndHandler) => void;
}
export interface PiWaggleExtensionController {
    readonly factory: ExtensionFactory;
    readonly done: Promise<void>;
}
export declare function createPiWaggleLoopHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleAgentEndHandler;
export interface PiWaggleTurnCompletionHandlers {
    readonly onTurnEnd: PiWaggleTurnEndHandler;
    readonly onAgentEnd: PiWaggleAgentEndHandler;
}
export declare function createPiWaggleTurnCompletionHandlers<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnCompletionHandlers;
export declare function createPiWaggleTurnEndHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnEndHandler;
export declare function registerPiWaggleLoop<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleExtensionApi): void;
export declare function createPiWaggleExtension<TMeta>(input: PiWaggleExtensionInput<TMeta>): PiWaggleExtensionController;
```

## Export `./loop`

Types: `dist/loop.d.ts`

### Declarations from `dist/loop.d.ts`

```ts
import type { AgentEndEvent, ExtensionAPI, ExtensionContext, ExtensionFactory, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig, WaggleTurn } from '@openwaggle/waggle-core';
export type PiWaggleModel = NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>;
export type PiWaggleCustomMessage = Parameters<ExtensionAPI['sendMessage']>[0];
export type PiWaggleSendMessageOptions = NonNullable<Parameters<ExtensionAPI['sendMessage']>[1]>;
export interface PiWaggleTurnMetadataInput {
    readonly turnNumber: number;
    readonly agentIndex: number;
}
export interface PiWaggleTurnCompleteInput<TMeta> {
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
    readonly messages: AgentEndEvent['messages'];
}
export interface PiWaggleTurnDecision {
    readonly continue: boolean;
}
export interface PiWaggleTurnMessageInput<TMeta> {
    readonly model: PiWaggleModel;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleStartNextTurnInput<TMeta> extends PiWaggleTurnMessageInput<TMeta> {
    readonly message: PiWaggleCustomMessage;
}
export interface PiWaggleResolveTurnModelInput<TMeta> {
    readonly ctx: PiWaggleExtensionContext;
    readonly turn: WaggleTurn;
    readonly meta: TMeta;
}
export interface PiWaggleExtensionInput<TMeta> {
    readonly config: WaggleConfig;
    readonly createTurnMetadata: (input: PiWaggleTurnMetadataInput) => TMeta;
    readonly onTurnComplete: (input: PiWaggleTurnCompleteInput<TMeta>) => PiWaggleTurnDecision | Promise<PiWaggleTurnDecision>;
    readonly buildTurnMessage: (input: PiWaggleTurnMessageInput<TMeta>) => PiWaggleCustomMessage;
    readonly resolveTurnModel?: (input: PiWaggleResolveTurnModelInput<TMeta>) => PiWaggleModel | Promise<PiWaggleModel>;
    readonly startNextTurn?: (input: PiWaggleStartNextTurnInput<TMeta>) => void | Promise<void>;
    readonly canStartNextTurn?: () => boolean;
    readonly onActiveTurnChange?: (meta: TMeta) => void;
    readonly onTurnStart?: (meta: TMeta) => void;
}
export interface PiWaggleLoopInput<TMeta> extends PiWaggleExtensionInput<TMeta> {
    readonly onComplete: () => void;
    readonly onError: (error: unknown) => void;
}
export type PiWaggleAgentEndHandler = (event: AgentEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export type PiWaggleTurnEndHandler = (event: TurnEndEvent, ctx: PiWaggleExtensionContext) => Promise<void> | void;
export interface PiWaggleExtensionContext {
    readonly modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'>;
}
export interface PiWaggleLoopApi {
    readonly sendMessage: ExtensionAPI['sendMessage'];
    readonly setModel: ExtensionAPI['setModel'];
}
export interface PiWaggleExtensionApi extends PiWaggleLoopApi {
    readonly onAgentEnd: (handler: PiWaggleAgentEndHandler) => void;
}
export interface PiWaggleExtensionController {
    readonly factory: ExtensionFactory;
    readonly done: Promise<void>;
}
export declare function createPiWaggleLoopHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleAgentEndHandler;
export interface PiWaggleTurnCompletionHandlers {
    readonly onTurnEnd: PiWaggleTurnEndHandler;
    readonly onAgentEnd: PiWaggleAgentEndHandler;
}
export declare function createPiWaggleTurnCompletionHandlers<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnCompletionHandlers;
export declare function createPiWaggleTurnEndHandler<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleLoopApi): PiWaggleTurnEndHandler;
export declare function registerPiWaggleLoop<TMeta>(input: PiWaggleLoopInput<TMeta>, api: PiWaggleExtensionApi): void;
export declare function createPiWaggleExtension<TMeta>(input: PiWaggleExtensionInput<TMeta>): PiWaggleExtensionController;
```

## Export `./mode-state`

Types: `dist/mode-state.d.ts`

### Declarations from `dist/mode-state.d.ts`

```ts
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig } from '@openwaggle/waggle-core';
import { type PiWaggleModeState } from './protocol.js';
export interface PiWaggleModeStateWriter {
    readonly appendCustomEntry: (customType: string, data?: unknown) => string | undefined;
}
export interface PiWaggleModeStateReader {
    readonly getBranch: () => readonly SessionEntry[];
}
export declare function enabledPiWaggleModeState(input: {
    readonly config: WaggleConfig;
    readonly presetId?: string;
    readonly updatedAt?: number;
}): PiWaggleModeState;
export declare function disabledPiWaggleModeState(input?: {
    readonly updatedAt?: number;
}): PiWaggleModeState;
export declare function appendPiWaggleModeState(writer: PiWaggleModeStateWriter, state: PiWaggleModeState): string | undefined;
export declare function latestPiWaggleModeStateFromEntries(entries: readonly SessionEntry[]): PiWaggleModeState | null;
export declare function latestPiWaggleModeStateFromBranch(sessionManager: PiWaggleModeStateReader): PiWaggleModeState | null;
```

### Declarations from `dist/protocol.d.ts`

```ts
import { type WaggleAgentColor, type WaggleConfig } from '@openwaggle/waggle-core';
export declare const PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE = "pi-waggle.user-request";
export declare const PI_WAGGLE_TURN_CUSTOM_TYPE = "pi-waggle.turn";
export declare const PI_WAGGLE_MODE_STATE_CUSTOM_TYPE = "pi-waggle.mode-state";
export interface PiWaggleTurnDetails {
    readonly runId: string;
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentModel: string;
    readonly agentColor: WaggleAgentColor;
}
export interface PiWaggleModeState {
    readonly enabled: boolean;
    readonly presetId?: string;
    readonly config?: WaggleConfig;
    readonly updatedAt: number;
}
export declare function createPiWaggleTurnDetails(input: PiWaggleTurnDetails): PiWaggleTurnDetails;
export declare function parsePiWaggleTurnDetails(value: unknown): PiWaggleTurnDetails | null;
export declare function createPiWaggleModeState(input: PiWaggleModeState): PiWaggleModeState;
export declare function parsePiWaggleModeState(value: unknown): PiWaggleModeState | null;
```

## Export `./preset-storage`

Types: `dist/preset-storage.d.ts`

### Declarations from `dist/preset-storage.d.ts`

```ts
import { type WagglePreset } from '@openwaggle/waggle-core';
export interface PiWagglePresetsFileData {
    readonly wagglePresets: readonly WagglePreset[];
    readonly hiddenBuiltInPresetIds: readonly string[];
}
export declare function getPiWaggleUserPresetsPath(agentDir?: string): string;
export declare function getPiWaggleProjectPresetsPath(projectPath: string): string;
export declare function readPiWagglePresetsFileData(filePath: string): Promise<PiWagglePresetsFileData>;
export declare function readPiWagglePresetsFile(filePath: string): Promise<readonly WagglePreset[]>;
export declare function writePiWagglePresetsFileData(filePath: string, data: PiWagglePresetsFileData): Promise<void>;
export declare function writePiWagglePresetsFile(filePath: string, presets: readonly WagglePreset[]): Promise<void>;
```

## Export `./presets`

Types: `dist/presets.d.ts`

### Declarations from `dist/presets.d.ts`

```ts
import { type WagglePreset } from '@openwaggle/waggle-core';
export type PiWagglePresetScope = 'built-in' | 'user' | 'project';
export type PiWaggleEditablePresetScope = Exclude<PiWagglePresetScope, 'built-in'>;
export interface PiWagglePresetLayers {
    readonly builtIns: readonly WagglePreset[];
    readonly userPresets: readonly WagglePreset[];
    readonly projectPresets: readonly WagglePreset[];
    readonly userHiddenBuiltInPresetIds: readonly string[];
    readonly projectHiddenBuiltInPresetIds: readonly string[];
}
export interface PiWaggleResolvedPreset {
    readonly preset: WagglePreset;
    readonly scope: PiWagglePresetScope;
}
export interface PiWaggleHiddenBuiltInPreset {
    readonly preset: WagglePreset;
    readonly scope: PiWaggleEditablePresetScope;
}
export declare function loadPiWagglePresetLayers(cwd?: string): Promise<PiWagglePresetLayers>;
export declare function mergePiWagglePresetLayers(layers: PiWagglePresetLayers): readonly PiWaggleResolvedPreset[];
export declare function resolvedPresetsForUi(layers: PiWagglePresetLayers): PiWaggleResolvedPreset[];
export declare function hiddenBuiltInPresetsForUi(layers: PiWagglePresetLayers): PiWaggleHiddenBuiltInPreset[];
export declare function presetScopeLabel(scope: PiWaggleEditablePresetScope): "Project (.pi/waggle-presets.json)" | "User (~/.pi/agent/waggle-presets.json)";
export declare function savePiWagglePreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly preset: WagglePreset;
}): Promise<void>;
export declare function deletePiWaggleCustomPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function suppressPiWaggleBuiltInPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function restorePiWaggleBuiltInPreset(input: {
    readonly cwd?: string;
    readonly scope: PiWaggleEditablePresetScope;
    readonly presetId: string;
}): Promise<void>;
export declare function buildEditablePreset(input: {
    readonly base: Omit<WagglePreset, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>;
    readonly existingId?: string;
    readonly existingIds: ReadonlySet<string>;
    readonly existingCreatedAt?: number;
}): {
    id: string;
    name: string;
    description: string;
    config: import("@openwaggle/waggle-core").WaggleConfig;
    isBuiltIn: false;
    createdAt: number;
    updatedAt: number;
};
```

## Export `./protocol`

Types: `dist/protocol.d.ts`

### Declarations from `dist/protocol.d.ts`

```ts
import { type WaggleAgentColor, type WaggleConfig } from '@openwaggle/waggle-core';
export declare const PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE = "pi-waggle.user-request";
export declare const PI_WAGGLE_TURN_CUSTOM_TYPE = "pi-waggle.turn";
export declare const PI_WAGGLE_MODE_STATE_CUSTOM_TYPE = "pi-waggle.mode-state";
export interface PiWaggleTurnDetails {
    readonly runId: string;
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentModel: string;
    readonly agentColor: WaggleAgentColor;
}
export interface PiWaggleModeState {
    readonly enabled: boolean;
    readonly presetId?: string;
    readonly config?: WaggleConfig;
    readonly updatedAt: number;
}
export declare function createPiWaggleTurnDetails(input: PiWaggleTurnDetails): PiWaggleTurnDetails;
export declare function parsePiWaggleTurnDetails(value: unknown): PiWaggleTurnDetails | null;
export declare function createPiWaggleModeState(input: PiWaggleModeState): PiWaggleModeState;
export declare function parsePiWaggleModeState(value: unknown): PiWaggleModeState | null;
```

## Export `./renderers`

Types: `dist/renderers.d.ts`

### Declarations from `dist/renderers.d.ts`

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
type MessageRendererRegistrar = Pick<ExtensionAPI, 'registerMessageRenderer'>;
export declare function registerPiWaggleRenderers(pi: MessageRendererRegistrar): void;
export {};
```

## Export `./stop-policy`

Types: `dist/stop-policy.d.ts`

### Declarations from `dist/stop-policy.d.ts`

```ts
import type { AgentEndEvent } from '@earendil-works/pi-coding-agent';
import type { WaggleConfig, WaggleConsensusCheckResult } from '@openwaggle/waggle-core';
interface UnresolvedToolCall {
    readonly id: string;
    readonly name: string;
}
export interface PiWaggleTurnSummary {
    readonly responseText: string;
    readonly hasToolCalls: boolean;
    readonly unresolvedToolCalls: readonly UnresolvedToolCall[];
    readonly aborted: boolean;
    readonly terminalError?: string;
}
export interface PiWaggleStopPolicyState {
    readonly consecutiveErrorTurns: number;
    readonly successfulTurnCount: number;
    readonly lastAssistantTexts: readonly [string, string];
}
export interface PiWaggleStopPolicyDecision {
    readonly continue: boolean;
    readonly state: PiWaggleStopPolicyState;
    readonly turnSucceeded: boolean;
    readonly consensus?: WaggleConsensusCheckResult;
    readonly stop?: {
        readonly classification: 'complete' | 'stopped';
        readonly reason: string;
    };
}
export declare function createPiWaggleStopPolicyState(): PiWaggleStopPolicyState;
export declare function summarizePiWaggleTurnMessages(messages: readonly AgentEndEvent['messages'][number][]): PiWaggleTurnSummary;
export declare function evaluatePiWaggleStopPolicy(input: {
    readonly config: WaggleConfig;
    readonly turnNumber: number;
    readonly summary: PiWaggleTurnSummary;
    readonly state: PiWaggleStopPolicyState;
    readonly agentLabel: string;
}): PiWaggleStopPolicyDecision;
export {};
```
