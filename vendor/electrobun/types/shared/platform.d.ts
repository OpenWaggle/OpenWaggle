export type SupportedOS = "macos" | "win" | "linux";
export type SupportedArch = "arm64" | "x64";
export declare const OS: SupportedOS;
export declare const ARCH: SupportedArch;
export declare function getPlatformOS(): SupportedOS;
export declare function getPlatformArch(): SupportedArch;
