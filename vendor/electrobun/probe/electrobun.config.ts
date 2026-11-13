import type { ElectrobunConfig } from 'electrobun'

// Build-time variants, read when `hutch electrobun build` runs:
// - PROBE_CDP_PORT: CEF's DevTools port. The default, `launch`, has the launcher pick a free
//   loopback port on every launch (vendor/electrobun patch 0007), as OpenWaggle does.
// - PROBE_LINUX_RENDERER: `cef` (default) bundles CEF and renders the whole Linux app with it,
//   because a Linux process cannot mix CEF and WebKitGTK views; `native` ships WebKitGTK only.
// Windows bundles no CEF, as OpenWaggle: the preview opens in WebView2's Chromium environment
// (vendor/electrobun patch 0013).
const cdpPort = process.env.PROBE_CDP_PORT ?? 'launch'
const linuxRenderer = process.env.PROBE_LINUX_RENDERER === 'native' ? 'native' : 'cef'
// As OpenWaggle's app (scripts/electrobun/app-config.ts, CEF_CHROMIUM_FLAGS): `false` drops
// Electrobun's weakening defaults, so the probe proves CDP works without them.
const chromiumFlags = {
  'remote-debugging-port': cdpPort,
  'remote-allow-origins': false,
  'allow-insecure-localhost': false,
  'disable-web-security': false,
}

export default {
  app: {
    name: 'OpenWaggleNativeProbe',
    identifier: 'dev.openwaggle.native-probe',
    version: '0.0.1',
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'src/bun/index.ts' },
    copy: { 'src/mainview/index.html': 'views/mainview/index.html' },
    mac: { bundleCEF: true, defaultRenderer: 'native', chromiumFlags },
    win: { bundleCEF: false, defaultRenderer: 'native', chromiumFlags },
    linux: { bundleCEF: linuxRenderer === 'cef', defaultRenderer: linuxRenderer, chromiumFlags },
  },
  scripts: {
    postBuild: '../hooks/macos-launch-version.ts',
    postWrap: '../hooks/macos-launch-version.ts',
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
