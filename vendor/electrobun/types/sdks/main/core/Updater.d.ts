import { type SupportedArch, type SupportedOS } from "../../../shared/platform";
export type UpdateStatusType = "idle" | "checking" | "check-complete" | "no-update" | "update-available" | "downloading" | "download-starting" | "checking-local-tar" | "local-tar-found" | "local-tar-missing" | "fetching-patch" | "patch-found" | "patch-not-found" | "downloading-patch" | "applying-patch" | "patch-applied" | "patch-failed" | "extracting-version" | "patch-chain-complete" | "downloading-full-bundle" | "download-progress" | "decompressing" | "download-complete" | "applying" | "extracting" | "replacing-app" | "launching-new-version" | "complete" | "error";
export interface UpdateStatusDetails {
    fromHash?: string;
    toHash?: string;
    currentHash?: string;
    latestHash?: string;
    patchNumber?: number;
    totalPatchesApplied?: number;
    progress?: number;
    bytesDownloaded?: number;
    totalBytes?: number;
    usedPatchPath?: boolean;
    errorMessage?: string;
    url?: string;
    zstdPath?: string;
    exitCode?: number | null;
}
export interface UpdateStatusEntry {
    status: UpdateStatusType;
    message: string;
    timestamp: number;
    details?: UpdateStatusDetails;
}
export interface LocalUpdateInfo {
    version: string;
    hash: string;
    baseUrl: string;
    channel: string;
    name: string;
    displayName?: string;
    identifier: string;
}
export interface UpdateInfo {
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
}
export interface UpdateArtifactV1 {
    file: string;
    /** Digest and size of the exact, uncompressed release tar. */
    tarSha256?: string;
    tarSize?: number;
}
export interface UpdateManifestV1 {
    schemaVersion: 1;
    identifier: string;
    channel: string;
    version: string;
    hash: string;
    platform: SupportedOS;
    arch: SupportedArch;
    artifact: UpdateArtifactV1;
}
export interface PreparedUpdateV1 {
    schema_version: 1;
    identifier: string;
    channel: string;
    version: string;
    hash: string;
    platform: SupportedOS;
    arch: SupportedArch;
    retained_tar_path: string;
    artifact_file: string;
}
export interface PreparedUpdateV2 extends Omit<PreparedUpdateV1, "schema_version" | "retained_tar_path"> {
    schema_version: 2;
    staging_path: string;
    recipe_path: string;
    recipe_sha256: string;
}
export type PreparedUpdate = PreparedUpdateV1 | PreparedUpdateV2;
export interface NativeUpdatePlanV1 {
    schema_version: 1;
    transaction_id: string;
    identifier: string;
    channel: string;
    platform: SupportedOS;
    arch: SupportedArch;
    version: string;
    hash: string;
    channel_root: string;
    app_bundle_path: string;
    retained_tar_path: string;
    parent_pid: number;
    result_path: string;
}
export interface NativeUpdatePlanV2 extends Omit<NativeUpdatePlanV1, "schema_version" | "retained_tar_path"> {
    schema_version: 2;
    retained_tar_path: "";
    staging_path: string;
    recipe_path: string;
    recipe_sha256: string;
}
export type NativeUpdatePlan = NativeUpdatePlanV1 | NativeUpdatePlanV2;
export interface NativeUpdateResultV1 {
    schema_version: 1;
    transaction_id: string;
    success: boolean;
    phase: "validating" | "waiting_for_parent" | "extracting" | "validating_payload" | "swapping" | "integrating" | "launching" | "complete";
    message: string;
    identifier: string;
    channel: string;
    version: string;
    hash: string;
}
export interface NativeUpdateResultCandidate {
    path: string;
    modifiedAt: number;
    result: NativeUpdateResultV1;
}
export interface NativeUpdateResultScan {
    candidates: NativeUpdateResultCandidate[];
    selected?: NativeUpdateResultCandidate;
    truncated: boolean;
}
export interface ReconciledNativeUpdateResult {
    updateInfo: UpdateInfo;
    status: "complete" | "error";
    message: string;
    details: UpdateStatusDetails;
}
interface ManifestExpectation {
    identifier: string;
    channel: string;
    platform: SupportedOS;
    arch: SupportedArch;
}
export interface DownloadProgressThrottleState {
    lastBytes: number;
    lastPercent: number;
    lastTimestamp: number;
}
export declare function createDownloadProgressThrottleState(): DownloadProgressThrottleState;
/**
 * Return the next bounded progress percentage, or null when this chunk should
 * not produce a status entry. Non-final progress is capped at 99 so a corrupt
 * response never reports 100%; the caller forces 100 only after the complete
 * response has been durably written.
 */
export declare function nextDownloadProgressPercent(state: DownloadProgressThrottleState, bytesDownloaded: number, totalBytes: number, now: number, complete?: boolean): number | null;
/** Encode the manifest's single filename as one URL path segment. */
export declare function buildUpdateArtifactUrl(baseUrl: string, artifactFile: string): string;
export declare function addUpdateArtifactCacheBuster(artifactUrl: string, transactionId: string): string;
/** Validate the v2 update metadata before any artifact is fetched. */
export declare function validateUpdateManifest(document: unknown, expected: ManifestExpectation): UpdateManifestV1;
/**
 * Resolve the installed channel root rather than reconstructing it from the v2
 * channel name. Early v1 releases used app-name roots and later v1 releases
 * used stable/canary roots; a delivered v2 app must retain the physical root
 * that already contains its updater state.
 */
export declare function resolveInstalledChannelRoot(info: LocalUpdateInfo, executablePath?: any, appDataRoot?: string): string;
export declare function resolveInstalledChannelRootForPlatform(info: LocalUpdateInfo, platform: SupportedOS, executablePath: string, appDataRoot: string, regularFileProbe?: (path: string) => boolean): string;
export declare function publishFileReplacingRegular(sourcePath: string, destinationPath: string): void;
export declare function atomicWriteFile(path: string, contents: Uint8Array): void;
export declare function syncFile(path: string): void;
export declare function validatePreparedUpdate(document: unknown, info: LocalUpdateInfo, channelRoot: string, appBundlePath?: string): PreparedUpdate;
/** Validate the native manager's durable result without trusting its filename. */
export declare function validateNativeUpdateResult(document: unknown, expectedTransactionId: string, info: LocalUpdateInfo): NativeUpdateResultV1;
export declare function reconcileNativeUpdateResultState(result: NativeUpdateResultV1, info: LocalUpdateInfo): ReconciledNativeUpdateResult;
/**
 * Inspect only a bounded number of plain, transaction-named files in the
 * resolved channel root. Structurally valid older results are returned so the
 * next handoff can prune them, while `selected` is relevant to this launch.
 */
export declare function scanNativeUpdateResults(info: LocalUpdateInfo, channelRoot: string): NativeUpdateResultScan;
/** Keep the newest launch-relevant result and prune older validated results. */
export declare function cleanupOlderNativeUpdateResults(info: LocalUpdateInfo, channelRoot: string): string[];
export declare function downloadResponseToFile(response: Response, partialPath: string, description: string, onProgress?: (bytesDownloaded: number) => void): Promise<number>;
type DeltaPatchExecutor = (executable: string, args: readonly string[]) => void;
export declare function applyDeltaPatch(options: {
    bspatchPath: string;
    currentTarPath: string;
    patchPath: string;
    outputPath: string;
}, execute?: DeltaPatchExecutor): void;
/** Read only the small version metadata entry while streaming over the TAR. */
export declare function readUpdateHashFromTar(path: string): Promise<string>;
/** Standalone v2 manager first, bundled manager second for v1-to-v2 bootstrap. */
export declare function getUpdateHelperSourceCandidates(channelRoot: string, appBundlePath: string, platform?: SupportedOS): string[];
export declare function resolveUpdateHelperSource(channelRoot: string, appBundlePath: string, platform?: SupportedOS, preferBundled?: boolean): string;
export declare function createNativeUpdatePlan<T extends NativeUpdatePlan>(plan: T): T;
/** Prefer the outer launcher PID so the native helper waits for the complete
 * installed process tree, not only the main runtime child. */
export declare function resolveUpdateParentPid(launcherPid?: any, runtimePid?: any): number;
declare function checkForUpdate(): Promise<UpdateInfo>;
export interface PatchChainPreparationResult {
    completed: boolean;
    patchesApplied: number;
}
interface PatchChainDependencies {
    fetchResponse?: (url: string, init: RequestInit) => Promise<Response>;
    applyPatch?: typeof applyDeltaPatch;
    readNextHash?: typeof readUpdateHashFromTar;
    bspatchPath?: string;
}
export declare function isUpdateDiskFullError(error: unknown): boolean;
export declare function preparePatchChainForUpdate(options: {
    info: LocalUpdateInfo;
    manifest: UpdateManifestV1;
    extractionFolder: string;
    transactionId: string;
    retainedTarPath: string;
}, dependencies?: PatchChainDependencies): Promise<PatchChainPreparationResult>;
export interface NativePrepareUpdateRequest {
    schema_version: 1;
    transaction_id: string;
    identifier: string;
    channel: string;
    platform: SupportedOS;
    arch: SupportedArch;
    version: string;
    hash: string;
    base_hash: string;
    base_url: string;
    artifact_file: string;
    channel_root: string;
    app_bundle_path: string;
    tar_sha256?: string;
    tar_size?: number;
}
type NativePrepareExecutor = (helper: string, args: readonly string[]) => Promise<void>;
/** Windows process lookup requires an executable suffix on the bundled manager. */
export declare function withNativePreparationHelper(platform: SupportedOS, source: string, copy: () => string, execute: (helper: string) => Promise<void>, remove?: (helper: string) => void): Promise<void>;
export declare function executeNativePreparation(helper: string, args: readonly string[]): Promise<void>;
/** Stage the release without ever persisting a complete uncompressed tar. */
export declare function prepareNativeUpdate(options: {
    info: LocalUpdateInfo;
    manifest: UpdateManifestV1;
    channelRoot: string;
    appBundlePath: string;
    transactionId: string;
    execute?: NativePrepareExecutor;
}): Promise<PreparedUpdateV2>;
declare function downloadUpdate(): Promise<void>;
declare function applyUpdate(): Promise<void>;
declare const Updater: {
    updateInfo: () => UpdateInfo;
    getStatusHistory: () => UpdateStatusEntry[];
    clearStatusHistory: () => void;
    onStatusChange: (callback: ((entry: UpdateStatusEntry) => void) | null) => void;
    checkForUpdate: typeof checkForUpdate;
    downloadUpdate: typeof downloadUpdate;
    applyUpdate: typeof applyUpdate;
    channelBucketUrl: () => Promise<string>;
    appDataFolder: () => Promise<string>;
    localInfo: {
        version: () => Promise<string>;
        hash: () => Promise<string>;
        channel: () => Promise<string>;
        baseUrl: () => Promise<string>;
    };
    getLocalInfo: () => Promise<LocalUpdateInfo>;
    getLocallocalInfo: () => Promise<LocalUpdateInfo>;
};
export { Updater };
