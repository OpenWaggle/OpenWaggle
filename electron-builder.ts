import type { Configuration } from 'electron-builder'
import { resolveBuildIdentity, resolveIconBasePath } from './scripts/build-identity'

/**
 * electron-builder configuration as a function (see docs/adr/0032). The Build
 * identity — name, appId, icon — is resolved once here from the build context;
 * userData follows productName automatically at runtime. electron-builder loads
 * `.ts` config via jiti and calls this default export, so nothing else invokes
 * it. Replaces the former static electron-builder.yml.
 */
const identity = resolveBuildIdentity()
const buildResourcesDir = 'build'

const stableIcons = {
  mac: 'build/icon.icns',
  win: 'build/icon.ico',
  linux: 'build/icon.png',
}
const channelIcon = resolveIconBasePath(identity.iconVariant, buildResourcesDir)
const icons =
  identity.iconVariant === 'stable'
    ? stableIcons
    : { mac: channelIcon, win: channelIcon, linux: channelIcon }

const config: Configuration = {
  appId: identity.appId,
  productName: identity.productName,
  // Packaging rebuilds native dependencies once per target architecture. Always
  // compile patched node-pty sources instead of accepting its upstream prebuilds.
  buildDependenciesFromSource: true,
  // Publish a channel-matched update feed (latest.yml plus e.g. alpha.yml) so a
  // build on a given Build channel can detect updates on its own track (ADR 0032).
  generateUpdatesFilesForAllChannels: true,
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
    { from: 'build/icon.png', to: 'icon.png' },
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
    target: [{ target: 'AppImage', arch: ['x64'] }],
  },
}

export default config
