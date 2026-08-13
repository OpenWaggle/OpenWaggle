import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
export type MountStatus = {
    readonly kind: 'idle';
} | {
    readonly kind: 'loading';
} | {
    readonly kind: 'mounted';
} | {
    readonly kind: 'error';
    readonly message: string;
};
export interface ReportedMountStatus {
    readonly mountKey: string;
    readonly status: MountStatus;
}
interface MountExtensionFrameInput {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly frame: HTMLIFrameElement | null;
    readonly frameId: string;
    readonly frameRuntimeSupported: boolean;
    readonly getCurrentFrameWindow: () => Window | null | undefined;
    readonly moduleUrl: string | null;
    readonly mountKey: string;
    readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void;
    readonly reportHeight?: (height: number) => void;
    readonly reportStatus: (status: ReportedMountStatus) => void;
    readonly surfacePayloadJson?: string;
}
export declare function missingEntryPathStatus(): MountStatus;
export declare function supportsExtensionExecutionPlacement(entry: ExtensionContributionRegistryEntry): boolean;
export declare function supportsExtensionFrameRuntimeKind(entry: ExtensionContributionRegistryEntry): boolean;
export declare function supportsExtensionFrameRuntime(entry: ExtensionContributionRegistryEntry): boolean;
export declare function federatedModuleMountKey(entry: ExtensionContributionRegistryEntry, moduleUrl: string | null, surfacePayloadJson: string | undefined): string;
export declare function federatedModuleSurfacePayloadJson(surfacePayload: JsonValue | undefined): string | undefined;
export declare function initialMountStatus(input: {
    readonly frameRuntimeSupported: boolean;
    readonly moduleUrl: string | null;
}): MountStatus;
export declare function mountExtensionFrame(input: MountExtensionFrameInput): (() => void) | undefined;
export {};
