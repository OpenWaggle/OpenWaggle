import type { SupportedOS, SupportedArch } from "./platform";
/**
 * Build environment/channel types.
 * "stable" is special - it produces artifacts without a channel suffix.
 */
export type BuildEnvironment = "stable" | "canary" | "dev";
export declare function isBuildEnvironment(value: string): value is BuildEnvironment;
/**
 * Sanitizes an app name by removing spaces.
 * Used as the base for all artifact naming.
 */
export declare function sanitizeAppName(appName: string): string;
/**
 * Generates the app file name based on build environment.
 * Format: "AppName" (stable) or "AppName-channel" (non-stable)
 *
 * @example
 * getAppFileName("My App", "stable") // "MyApp"
 * getAppFileName("My App", "canary") // "MyApp-canary"
 */
export declare function getAppFileName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Generates the macOS bundle display name (with spaces preserved).
 * Used for the actual .app folder name on macOS.
 * Format: "App Name" (stable) or "App Name-channel" (non-stable)
 *
 * @example
 * getMacOSBundleDisplayName("My App", "stable") // "My App"
 * getMacOSBundleDisplayName("My App", "canary") // "My App-canary"
 */
export declare function getMacOSBundleDisplayName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Generates the bundle file name (with platform-specific extension).
 * macOS: "AppName.app" or "AppName-channel.app"
 * Others: "AppName" or "AppName-channel"
 */
export declare function getBundleFileName(appName: string, buildEnvironment: BuildEnvironment, os: SupportedOS): string;
/**
 * Generates the platform prefix for artifacts.
 * Format: "channel-os-arch" (e.g., "stable-macos-arm64", "canary-win-x64")
 * Used for flat file naming in artifact folders and bucket URLs.
 */
export declare function getPlatformPrefix(buildEnvironment: BuildEnvironment, os: SupportedOS, arch: SupportedArch): string;
/**
 * Generates the tarball file name for update distribution.
 * macOS: "AppFileName.app.tar.zst"
 * Others: "AppFileName.tar.zst"
 */
export declare function getTarballFileName(appFileName: string, os: SupportedOS): string;
/**
 * Generates the Windows installer setup file name.
 * Preserves spaces in app name for user-friendly display.
 * Format: "App Name-Setup.exe" (stable) or "App Name-Setup-channel.exe" (non-stable)
 */
export declare function getWindowsSetupFileName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Generates the Linux AppImage wrapper name (without extension).
 * Preserves spaces in app name for user-friendly display.
 * Format: "App Name-Setup" (stable) or "App Name-Setup-channel" (non-stable)
 */
export declare function getLinuxAppImageBaseName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Generates the full Linux AppImage file name.
 */
export declare function getLinuxAppImageFileName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Sanitizes a volume name for hdiutil (macOS DMG creation).
 * Removes all non-alphanumeric characters except spaces.
 */
export declare function sanitizeVolumeNameForHdiutil(name: string): string;
/**
 * Generates the DMG volume name for macOS.
 * Takes the original app name (with spaces) and preserves them for display.
 * Format: "App Name" (stable) or "App Name-channel" (non-stable)
 */
export declare function getDmgVolumeName(appName: string, buildEnvironment: BuildEnvironment): string;
/**
 * Constructs the full URL for the update.json file.
 * Uses flat prefix-based naming for compatibility with GitHub Releases and other hosts.
 */
export declare function getUpdateInfoUrl(baseUrl: string, platformPrefix: string): string;
/**
 * Constructs the full URL for a patch file.
 * Uses flat prefix-based naming for compatibility with GitHub Releases and other hosts.
 */
export declare function getPatchFileUrl(baseUrl: string, platformPrefix: string, hash: string): string;
/**
 * Constructs the full URL for a tarball.
 * Uses flat prefix-based naming for compatibility with GitHub Releases and other hosts.
 */
export declare function getTarballUrl(baseUrl: string, platformPrefix: string, tarballFileName: string): string;
