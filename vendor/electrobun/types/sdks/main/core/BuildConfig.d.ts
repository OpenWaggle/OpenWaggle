import type { WindowsWebView2Permission } from "../../../config/windowsPermissions";
export type BuildConfigType = {
    mainProcess?: "bun" | "cottontail" | "zig" | "rust" | "go" | "odin";
    defaultRenderer: "native" | "cef";
    availableRenderers: ("native" | "cef")[];
    buildEnvironment?: RuntimeBuildChannel;
    chromiumFlags?: Record<string, string | boolean>;
    autoGrantPermissions?: WindowsWebView2Permission[];
    /** Runtime channel read from the packaged Resources/version.json metadata. */
    channel: RuntimeBuildChannel;
    /** False for dev builds; true for stable and canary builds. */
    isPackaged: boolean;
    runtime?: {
        exitOnLastWindowClosed?: boolean;
        [key: string]: import("../../../json").ElectrobunJsonValue;
    };
};
export type RuntimeBuildChannel = "dev" | "canary" | "stable";
export declare function isPackagedBuildChannel(channel: unknown): boolean;
declare const BuildConfig: {
    /**
     * Get the build configuration. Loads from build.json on first call, then returns cached value.
     */
    get: () => Promise<BuildConfigType>;
    /**
     * Get the build configuration synchronously.
     * Useful for modules that cannot use top-level await.
     */
    getSync: () => BuildConfigType;
    /**
     * Get the cached build configuration synchronously.
     * Returns null if config hasn't been loaded yet.
     */
    getCached: () => BuildConfigType | null;
};
export { BuildConfig };
