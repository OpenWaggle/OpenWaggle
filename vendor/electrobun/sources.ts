/**
 * Pinned sources of OpenWaggle's Electrobun native layer (see README.md). vendor/electrobun/build.ts
 * fetches exactly these commits, refuses anything else, and applies patches/*.patch on top.
 *
 * Bumping Electrobun: change `electrobun` (tag and commit), the dependency versions to the ones that
 * release's package/src/shared/build-dependencies.ts names, VERSION, and the probe's
 * hutch.config.ts pin; then rebase the patches (`git am` them on the new tag, fix, `git
 * format-patch`).
 */
export interface PinnedSource {
  readonly repository: string
  readonly tag: string
  readonly commit: string
}

export const ELECTROBUN_SOURCE = {
  repository: 'https://github.com/blackboardsh/electrobun',
  tag: 'v2.0.6',
  commit: 'c9e637c4e8acc8d53fc4a1703346196b004a00d8',
} as const satisfies PinnedSource

/**
 * Electrobun downloads these as prebuilt binaries that target macOS 14 and the glibc of Zig's
 * default Linux target. build.ts rebuilds them from source for the floors instead; the version is
 * the one Electrobun's build-dependencies.ts expects, so its own vendor step reuses ours.
 */
export const OWNED_DEPENDENCY_SOURCES = {
  'zig-bsdiff': {
    repository: 'https://github.com/blackboardsh/zig-bsdiff',
    tag: 'v0.1.26',
    commit: 'f8b30fa6a696da7a1886a3a23d38df2ee9323f76',
  },
  'zig-zstd': {
    repository: 'https://github.com/blackboardsh/zig-zstd',
    tag: 'v0.1.9',
    commit: 'bc11c276480737d7d9d6be328c78af9a78d7f06a',
  },
  'zig-asar': {
    repository: 'https://github.com/blackboardsh/zig-asar',
    tag: 'v0.2.8',
    commit: '3b80a870c4353b8b69fb574f4a58038b5a7f304c',
  },
} as const satisfies Record<string, PinnedSource>

export type OwnedDependency = keyof typeof OWNED_DEPENDENCY_SOURCES

/**
 * electrobun-dawn (WebGPU), whose release Electrobun downloads into package/vendors/wgpu. Its
 * macOS build targets 14.0 and its Linux build Ubuntu 24.04, so build.ts rebuilds it with the same
 * CMake configuration as its scripts/build-dawn.js. `dawn` is the google/dawn submodule commit.
 */
export const DAWN_SOURCE = {
  repository: 'https://github.com/blackboardsh/electrobun-dawn',
  tag: 'v0.2.7',
  commit: 'cb8c13e247fad14b4d472fd3a8cd029892cb67f8',
  dawn: '75beadd1f3ab1c541ae743ef943480f434983a4e',
} as const satisfies PinnedSource & { readonly dawn: string }

/** Zig 0.17.0, as Electrobun 2.0.6 pins it; sha256 from ziglang.org/download/index.json. */
export const ZIG = {
  version: '0.17.0',
  archives: {
    'darwin-arm64': {
      url: 'https://ziglang.org/download/0.17.0/zig-aarch64-macos-0.17.0.tar.xz',
      sha256: 'b607e9b9234790a008116ae5bdb71c6243b84b9fb42a53a9e70fde41c06c536a',
    },
    'darwin-x64': {
      url: 'https://ziglang.org/download/0.17.0/zig-x86_64-macos-0.17.0.tar.xz',
      sha256: '4f9a1c5269aa17ebda5e6d3c2b89d6cbf36f7d2b22a0306e9ab98f25f95529c6',
    },
    'linux-x64': {
      url: 'https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz',
      sha256: '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026',
    },
  },
} as const

/** The Hutch CLI that builds Electrobun 2.0.6 (its package/hutch.config.ts pragma). */
export const HUTCH_VERSION = '0.29.0'

/**
 * The macOS 13.3 SDK's text stubs, which cover macOS 13.3 and 13.4 (13.4 shipped no SDK). The
 * symbol check (scripts/check-macos-sdk-symbols.ts) reads only its .tbd files.
 */
export const MACOS_13_SDK = {
  url: 'https://github.com/joseluisq/macosx-sdks/releases/download/13.3/MacOSX13.3.sdk.tar.xz',
  sha256: '518e35eae6039b3f64e8025f4525c1c43786cc5cf39459d609852faf091e34be',
  directory: 'MacOSX13.3.sdk',
} as const

/**
 * Microsoft's WebView2 Evergreen bootstrapper. Microsoft updates the file in place, so build.ts
 * pins its publisher instead of a digest: the Authenticode signature must be valid and issued to
 * Microsoft Corporation.
 */
export const WEBVIEW2_BOOTSTRAPPER = {
  url: 'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
  fileName: 'MicrosoftEdgeWebview2Setup.exe',
  signer: 'O=Microsoft Corporation',
} as const
