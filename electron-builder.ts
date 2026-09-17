import { CANONICAL_EXECUTABLE_NAME, resolveBuildIdentity, resolveIconBasePath } from './scripts/build-identity'

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
  mac: 'build/icon.icns',
  win: 'build/icon.ico',
  linux: 'build/icon.png',
}
const channelIcon = resolveIconBasePath(identity.channel, buildResourcesDir)
const icons =
  identity.channel === 'stable'
    ? stableIcons
    : { mac: channelIcon, win: channelIcon, linux: channelIcon }

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
    // Ship the channel icon as the runtime icon resource so the dock icon set at
    // runtime (app.dock.setIcon on macOS) and the Windows/Linux window icon match
    // the channel, not just the packaged bundle icon (docs/adr/0032).
    { from: channelIcon, to: 'icon.png' },
    { from: 'build/openwaggle-docs', to: 'openwaggle-docs' },
  ],
  mac: {
    // Local builds: skip codesigning (no Apple Developer ID).
    // Distribution: remove this, configure CSC_LINK/CSC_KEY_PASSWORD.
    identity: null,
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
