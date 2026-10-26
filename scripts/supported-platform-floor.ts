/**
 * The v1 supported-platform minimums (docs/release-and-versioning.md, "v1 compatibility promise").
 *
 * This is the one place the native release guard (scripts/check-native-platform-floor.ts), the
 * macOS `LSMinimumSystemVersion` written by electron-builder.ts, and the docs agree on. Raising a
 * value is a breaking change to the "Supported platforms" Covered surface unless it meets the
 * exception in the release policy.
 */
export const SUPPORTED_PLATFORM_FLOOR = {
  macos: {
    /** Every feature works from here, including the onnxruntime-backed semantic search and voice input. */
    supportedVersion: '13.4',
    /**
     * The app still launches from here (`LSMinimumSystemVersion`). Kept below the supported version
     * so an auto-updating macOS 12 install is never left with an app that will not open.
     */
    launchVersion: '12.0',
  },
  windows: {
    /** Electron's floor. The guard rejects a PE whose OS or subsystem version is newer. */
    supportedVersion: '10.0',
  },
  linux: {
    /** Ubuntu 22.04, the release build's base, ships glibc 2.35 and GCC 12's libstdc++. */
    glibc: '2.35',
    glibcxx: '3.4.30',
    cxxabi: '1.3.13',
  },
} as const
