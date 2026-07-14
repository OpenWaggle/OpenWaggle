# @openwaggle/waggle-core

Package path: `packages/waggle-core`

## Export `.`

Types: `dist/index.d.ts`

### Declarations from `dist/index.d.ts`

```ts
export * from './config.js';
export * from './consensus.js';
export * from './events.js';
export * from './presets.js';
export * from './prompts.js';
export * from './state.js';
export * from './turn-policy.js';
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

### Declarations from `dist/consensus.d.ts`

```ts
export interface WaggleConsensusSignal {
    readonly type: 'explicit-agreement' | 'no-new-information' | 'action-convergence' | 'turn-limit';
    readonly confidence: number;
    readonly reason: string;
}
export interface WaggleConsensusCheckResult {
    readonly reached: boolean;
    readonly confidence: number;
    readonly reason: string;
    readonly signals: readonly WaggleConsensusSignal[];
}
export declare function evaluateConsensus(signals: readonly WaggleConsensusSignal[]): WaggleConsensusCheckResult;
export declare function checkConsensus(lastTwoMessages: readonly [string, string], totalTurns: number, maxTurns: number): WaggleConsensusCheckResult;
```

### Declarations from `dist/events.d.ts`

```ts
import type { WaggleAgentColor, WaggleCollaborationMode } from './config.js';
import type { WaggleStopReason, WaggleTurn } from './turn-policy.js';
export interface WaggleTurnMetadata {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentColor: WaggleAgentColor;
    readonly agentModel: string;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}
export type WaggleEngineEvent = {
    readonly type: 'turn-start';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'turn-end';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'collaboration-complete';
    readonly reason: WaggleStopReason;
};
export declare function metadataForWaggleTurn(input: {
    readonly turn: WaggleTurn;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}): WaggleTurnMetadata;
```

### Declarations from `dist/turn-policy.d.ts`

```ts
import type { WaggleAgentSlot, WaggleConfig } from './config.js';
export interface WaggleTurn {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agent: WaggleAgentSlot;
}
export type WaggleStopReason = 'turn-limit' | 'consensus' | 'user-stop' | 'terminal-error';
export interface WaggleTurnCompletion {
    readonly turnNumber: number;
    readonly consensusReached?: boolean;
    readonly terminalError?: string;
}
export interface WaggleTurnDecision {
    readonly continue: boolean;
    readonly reason?: WaggleStopReason;
    readonly nextTurn?: WaggleTurn;
}
export declare function getWaggleTurnAgentIndex(turnNumber: number): 0 | 1;
export declare function getWaggleTurn(config: WaggleConfig, turnNumber: number): WaggleTurn;
export declare function decideNextWaggleTurn(config: WaggleConfig, completion: WaggleTurnCompletion): WaggleTurnDecision;
```

### Declarations from `dist/presets.d.ts`

```ts
import { type WagglePreset } from './config.js';
export declare const BUILT_IN_WAGGLE_PRESETS: readonly WagglePreset[];
export declare function mergeWagglePresets(input: {
    readonly builtIns?: readonly WagglePreset[];
    readonly globalPresets?: readonly WagglePreset[];
    readonly projectPresets?: readonly WagglePreset[];
}): readonly WagglePreset[];
```

### Declarations from `dist/prompts.d.ts`

```ts
import type { WaggleConfig } from './config.js';
export interface BuildWaggleTurnPromptInput {
    readonly config: WaggleConfig;
    readonly turnNumber: number;
    readonly userPrompt: string;
}
export declare function buildWaggleTurnPrompt(input: BuildWaggleTurnPromptInput): string;
```

### Declarations from `dist/state.d.ts`

```ts
import type { WaggleConfig } from './config.js';
import type { WaggleTurnMetadata } from './events.js';
import { type WaggleStopReason, type WaggleTurnCompletion } from './turn-policy.js';
export type WaggleRunStatus = 'running' | 'complete';
export interface WaggleRunState {
    readonly config: WaggleConfig;
    readonly sessionId?: string;
    readonly status: WaggleRunStatus;
    readonly currentTurn: WaggleTurnMetadata | null;
    readonly completedTurns: readonly WaggleTurnMetadata[];
    readonly stopReason?: WaggleStopReason;
}
export declare function startWaggleRun(input: {
    readonly config: WaggleConfig;
    readonly sessionId?: string;
}): WaggleRunState;
export declare function completeWaggleTurn(state: WaggleRunState, completion: WaggleTurnCompletion): WaggleRunState;
```

## Export `./config`

Types: `dist/config.d.ts`

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

## Export `./consensus`

Types: `dist/consensus.d.ts`

### Declarations from `dist/consensus.d.ts`

```ts
export interface WaggleConsensusSignal {
    readonly type: 'explicit-agreement' | 'no-new-information' | 'action-convergence' | 'turn-limit';
    readonly confidence: number;
    readonly reason: string;
}
export interface WaggleConsensusCheckResult {
    readonly reached: boolean;
    readonly confidence: number;
    readonly reason: string;
    readonly signals: readonly WaggleConsensusSignal[];
}
export declare function evaluateConsensus(signals: readonly WaggleConsensusSignal[]): WaggleConsensusCheckResult;
export declare function checkConsensus(lastTwoMessages: readonly [string, string], totalTurns: number, maxTurns: number): WaggleConsensusCheckResult;
```

## Export `./events`

Types: `dist/events.d.ts`

### Declarations from `dist/events.d.ts`

```ts
import type { WaggleAgentColor, WaggleCollaborationMode } from './config.js';
import type { WaggleStopReason, WaggleTurn } from './turn-policy.js';
export interface WaggleTurnMetadata {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentColor: WaggleAgentColor;
    readonly agentModel: string;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}
export type WaggleEngineEvent = {
    readonly type: 'turn-start';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'turn-end';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'collaboration-complete';
    readonly reason: WaggleStopReason;
};
export declare function metadataForWaggleTurn(input: {
    readonly turn: WaggleTurn;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}): WaggleTurnMetadata;
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

### Declarations from `dist/turn-policy.d.ts`

```ts
import type { WaggleAgentSlot, WaggleConfig } from './config.js';
export interface WaggleTurn {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agent: WaggleAgentSlot;
}
export type WaggleStopReason = 'turn-limit' | 'consensus' | 'user-stop' | 'terminal-error';
export interface WaggleTurnCompletion {
    readonly turnNumber: number;
    readonly consensusReached?: boolean;
    readonly terminalError?: string;
}
export interface WaggleTurnDecision {
    readonly continue: boolean;
    readonly reason?: WaggleStopReason;
    readonly nextTurn?: WaggleTurn;
}
export declare function getWaggleTurnAgentIndex(turnNumber: number): 0 | 1;
export declare function getWaggleTurn(config: WaggleConfig, turnNumber: number): WaggleTurn;
export declare function decideNextWaggleTurn(config: WaggleConfig, completion: WaggleTurnCompletion): WaggleTurnDecision;
```

## Export `./presets`

Types: `dist/presets.d.ts`

### Declarations from `dist/presets.d.ts`

```ts
import { type WagglePreset } from './config.js';
export declare const BUILT_IN_WAGGLE_PRESETS: readonly WagglePreset[];
export declare function mergeWagglePresets(input: {
    readonly builtIns?: readonly WagglePreset[];
    readonly globalPresets?: readonly WagglePreset[];
    readonly projectPresets?: readonly WagglePreset[];
}): readonly WagglePreset[];
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

## Export `./prompts`

Types: `dist/prompts.d.ts`

### Declarations from `dist/prompts.d.ts`

```ts
import type { WaggleConfig } from './config.js';
export interface BuildWaggleTurnPromptInput {
    readonly config: WaggleConfig;
    readonly turnNumber: number;
    readonly userPrompt: string;
}
export declare function buildWaggleTurnPrompt(input: BuildWaggleTurnPromptInput): string;
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

## Export `./state`

Types: `dist/state.d.ts`

### Declarations from `dist/state.d.ts`

```ts
import type { WaggleConfig } from './config.js';
import type { WaggleTurnMetadata } from './events.js';
import { type WaggleStopReason, type WaggleTurnCompletion } from './turn-policy.js';
export type WaggleRunStatus = 'running' | 'complete';
export interface WaggleRunState {
    readonly config: WaggleConfig;
    readonly sessionId?: string;
    readonly status: WaggleRunStatus;
    readonly currentTurn: WaggleTurnMetadata | null;
    readonly completedTurns: readonly WaggleTurnMetadata[];
    readonly stopReason?: WaggleStopReason;
}
export declare function startWaggleRun(input: {
    readonly config: WaggleConfig;
    readonly sessionId?: string;
}): WaggleRunState;
export declare function completeWaggleTurn(state: WaggleRunState, completion: WaggleTurnCompletion): WaggleRunState;
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```

### Declarations from `dist/events.d.ts`

```ts
import type { WaggleAgentColor, WaggleCollaborationMode } from './config.js';
import type { WaggleStopReason, WaggleTurn } from './turn-policy.js';
export interface WaggleTurnMetadata {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agentLabel: string;
    readonly agentColor: WaggleAgentColor;
    readonly agentModel: string;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}
export type WaggleEngineEvent = {
    readonly type: 'turn-start';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'turn-end';
    readonly meta: WaggleTurnMetadata;
} | {
    readonly type: 'collaboration-complete';
    readonly reason: WaggleStopReason;
};
export declare function metadataForWaggleTurn(input: {
    readonly turn: WaggleTurn;
    readonly collaborationMode: WaggleCollaborationMode;
    readonly sessionId?: string;
}): WaggleTurnMetadata;
```

### Declarations from `dist/turn-policy.d.ts`

```ts
import type { WaggleAgentSlot, WaggleConfig } from './config.js';
export interface WaggleTurn {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agent: WaggleAgentSlot;
}
export type WaggleStopReason = 'turn-limit' | 'consensus' | 'user-stop' | 'terminal-error';
export interface WaggleTurnCompletion {
    readonly turnNumber: number;
    readonly consensusReached?: boolean;
    readonly terminalError?: string;
}
export interface WaggleTurnDecision {
    readonly continue: boolean;
    readonly reason?: WaggleStopReason;
    readonly nextTurn?: WaggleTurn;
}
export declare function getWaggleTurnAgentIndex(turnNumber: number): 0 | 1;
export declare function getWaggleTurn(config: WaggleConfig, turnNumber: number): WaggleTurn;
export declare function decideNextWaggleTurn(config: WaggleConfig, completion: WaggleTurnCompletion): WaggleTurnDecision;
```

## Export `./turn-policy`

Types: `dist/turn-policy.d.ts`

### Declarations from `dist/turn-policy.d.ts`

```ts
import type { WaggleAgentSlot, WaggleConfig } from './config.js';
export interface WaggleTurn {
    readonly turnNumber: number;
    readonly agentIndex: number;
    readonly agent: WaggleAgentSlot;
}
export type WaggleStopReason = 'turn-limit' | 'consensus' | 'user-stop' | 'terminal-error';
export interface WaggleTurnCompletion {
    readonly turnNumber: number;
    readonly consensusReached?: boolean;
    readonly terminalError?: string;
}
export interface WaggleTurnDecision {
    readonly continue: boolean;
    readonly reason?: WaggleStopReason;
    readonly nextTurn?: WaggleTurn;
}
export declare function getWaggleTurnAgentIndex(turnNumber: number): 0 | 1;
export declare function getWaggleTurn(config: WaggleConfig, turnNumber: number): WaggleTurn;
export declare function decideNextWaggleTurn(config: WaggleConfig, completion: WaggleTurnCompletion): WaggleTurnDecision;
```

### Declarations from `dist/config.d.ts`

```ts
export declare const MIN_WAGGLE_MAX_TURNS_SAFETY = 1;
export declare const MAX_WAGGLE_MAX_TURNS_SAFETY = 100;
export declare const WAGGLE_INHERIT_MODEL = "$inherit";
export declare const WAGGLE_COLLABORATION_MODES: readonly ["sequential"];
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number];
export declare const WAGGLE_AGENT_COLORS: readonly ["blue", "amber", "emerald", "violet"];
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number];
export declare const WAGGLE_STOP_CONDITIONS: readonly ["consensus", "user-stop"];
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number];
export interface WaggleAgentSlot {
    readonly label: string;
    readonly model: string;
    readonly roleDescription: string;
    readonly color: WaggleAgentColor;
}
export interface WaggleStopConfig {
    readonly primary: WaggleStopCondition;
    readonly maxTurnsSafety: number;
}
export interface WaggleConfig {
    readonly mode: WaggleCollaborationMode;
    readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot];
    readonly stop: WaggleStopConfig;
}
export interface WagglePreset {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly config: WaggleConfig;
    readonly isBuiltIn: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export type WaggleValidationResult<T> = {
    readonly success: true;
    readonly value: T;
} | {
    readonly success: false;
    readonly issues: readonly string[];
};
export declare function isWaggleInheritedModel(model: string): model is "$inherit";
export declare function isProviderQualifiedWaggleModel(model: string): boolean;
export declare function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig>;
export declare function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset>;
```
