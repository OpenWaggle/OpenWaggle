import {
  CANONICAL_EXECUTABLE_NAME,
  resolveBuildIdentity,
  resolveIconBasePath,
  resolveMacIconPath,
} from './scripts/build-identity'
import { resolveMacSigning } from './scripts/mac-signing'

/**
 * electron-builder configuration as a function (see docs/adr/0032). The Build
 * identity — name, appId, icon — is resolved once here from the build context;
 * userData follows productName automatically at runtime. electron-builder loads
 * `.ts` config via jiti and consumes this default export; it validates the shape
 * at runtime. Left untyped: electron-builder re-exports its `Configuration` type
 * from the transitive `app-builder-lib`, which does not resolve under this repo's
 * module resolution. Replaces the former static electron-builder.yml.
 */
const identity = resolveBuildIdentity()
const buildResourcesDir = 'build'

const stableIcons = {
  win: 'build/icon.ico',
  linux: 'build/icon.png',
}
const channelIcon = resolveIconBasePath(identity.channel, buildResourcesDir)
const icons = {
  // Every channel has its own generated rounded-square macOS icon (scripts/generate-macos-icons.ts).
  mac: resolveMacIconPath(identity.channel, buildResourcesDir),
  ...(identity.channel === 'stable' ? stableIcons : { win: channelIcon, linux: channelIcon }),
}

const config = {
  appId: identity.appId,
  productName: identity.productName,
  // Canonical across every channel so the packaged bundle/executable names never
  // change (release verification, packaged-app smoke, install.sh, the NSIS shim
  // and the Homebrew cask all reference "OpenWaggle"). Channels differ by display
  // name (productName → CFBundleName) and icon, not by executable name. (ADR 0032)
  executableName: CANONICAL_EXECUTABLE_NAME,
  // Packaging rebuilds native dependencies once per target architecture. Always
  // compile patched node-pty sources instead of accepting its upstream prebuilds.
  buildDependenciesFromSource: true,
  directories: {
    buildResources: buildResourcesDir,
  },
  publish: {
    provider: 'github',
    owner: 'OpenWaggle',
    repo: 'OpenWaggle',
    // GitHub does not infer this from the package prerelease identifier.
    channel: identity.channel === 'stable' ? 'latest' : identity.channel,
  },
  // sharp dlopens libvips (libvips-cpp.so on Linux) from its native package; a
  // dlopen cannot read a shared library trapped inside app.asar, so unpack them.
  asarUnpack: ['**/node_modules/sharp/**', '**/node_modules/@img/**'],
  files: [
    'out/main/**/*',
    'out/preload/**/*',
    'out/renderer/**/*',
    'node_modules/**/*',
    'package.json',
    // Declarations are never needed at runtime; this also guarantees stray tsc
    // output (e.g. test fixtures) can never be packaged into the app.
    '!out/**/*.d.ts',
    '!**/.vscode/*',
    '!src/*',
    '!tests/**/*',
    '!fixtures/**/*',
    '!packages/**/*',
    '!scripts/**/*',
    '!electron.vite.config.*',
    '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    // Exclude non-runtime files from node_modules to reduce asar size
    '!node_modules/**/@types',
    '!node_modules/**/*.d.ts',
    '!node_modules/**/*.d.mts',
    '!node_modules/**/*.map',
    '!node_modules/**/README*',
    '!node_modules/**/CHANGELOG*',
    '!node_modules/**/LICENSE*',
    '!node_modules/**/.github',
    '!node_modules/**/docs',
    '!node_modules/**/test',
    '!node_modules/**/tests',
    '!node_modules/**/__tests__',
    '!node_modules/**/examples',
    '!node_modules/**/.eslintrc*',
    '!node_modules/**/.prettierrc*',
    '!node_modules/**/tsconfig.json',
    // Workspace packages are followed through node_modules; ship their built/runtime surface only.
    '!node_modules/@openwaggle/*/src/**/*',
    '!node_modules/@openwaggle/*/tsconfig*.json',
    // Exclude unused ONNX training WASM files (only inference is needed)
    '!node_modules/onnxruntime-web/dist/ort-training*',
  ],
  extraResources: [
    // Ship the channel icon as the runtime icon resource so the Windows/Linux
    // window icon matches the channel, not just the packaged bundle icon
    // (docs/adr/0032). Packaged macOS builds take their Dock icon from the bundle.
    { from: channelIcon, to: 'icon.png' },
    { from: 'build/openwaggle-docs', to: 'openwaggle-docs' },
    { from: 'build/session-embedding-model', to: 'session-embedding-model' },
    { from: 'scripts/install.sh', to: 'openwaggle-install.sh' },
    // MIT notices for code adapted from other projects (generated Session titles, ADR 0043).
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ],
  mac: {
    // Release builds sign with the Developer ID certificate in CSC_LINK and notarize with the
    // APPLE_* credentials; dev builds stay unsigned. RC and Stable fail closed without both.
    ...resolveMacSigning(identity.channel),
    icon: icons.mac,
    // Keep artifact filenames keyed to the lowercase package name (not the
    // channel-specific productName) so install.sh and release verification match.
    artifactName: '${name}-${version}-${arch}.${ext}',
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: ['dmg', 'zip'],
  },
  win: {
    icon: icons.win,
    artifactName: '${name}-${version}-${arch}.${ext}',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    include: 'build/installer.nsh',
  },
  linux: {
    icon: icons.linux,
    artifactName: '${name}-${version}-${arch}.${ext}',
    // Keep the Linux executable lowercase (the pre-existing default from the
    // package name). The top-level executableName "OpenWaggle" pins the macOS
    // bundle/binary and the Windows exe, but on Linux the packaged binary,
    // install.sh, and packaged-app smoke all expect lowercase `openwaggle`.
    executableName: 'openwaggle',
    target: [{ target: 'AppImage', arch: ['x64'] }],
  },
}

export default config
