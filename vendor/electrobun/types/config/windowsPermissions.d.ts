export declare const WINDOWS_WEBVIEW2_AUTO_GRANT_PERMISSIONS: readonly ["camera", "microphone", "geolocation", "notifications"];
export type WindowsWebView2Permission = (typeof WINDOWS_WEBVIEW2_AUTO_GRANT_PERMISSIONS)[number];
/**
 * Return the Windows-only permission fragment written to Resources/build.json.
 * Empty lists are omitted so existing applications keep the native prompt path.
 */
export declare function getWindowsPermissionBuildConfig(targetOS: "macos" | "win" | "linux", permissions: readonly WindowsWebView2Permission[] | undefined): {
    autoGrantPermissions?: WindowsWebView2Permission[];
};
