import type { ElectrobunConfig } from 'electrobun'

// Build-time variants, read when `hutch electrobun build` runs:
// - PROBE_CDP_PORT: loopback port of CEF's DevTools endpoint (default 9339).
// - PROBE_LINUX_RENDERER: `cef` (default) bundles CEF and renders the whole Linux app with it,
//   because a Linux process cannot mix CEF and WebKitGTK views; `native` ships WebKitGTK only.
const cdpPort = process.env.PROBE_CDP_PORT ?? '9339'
const linuxRenderer = process.env.PROBE_LINUX_RENDERER === 'native' ? 'native' : 'cef'
const chromiumFlags = { 'remote-debugging-port': cdpPort }

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
    win: { bundleCEF: true, defaultRenderer: 'native', chromiumFlags },
    linux: { bundleCEF: linuxRenderer === 'cef', defaultRenderer: linuxRenderer, chromiumFlags },
  },
  scripts: {
    postBuild: '../hooks/macos-launch-version.ts',
    postWrap: '../hooks/macos-launch-version.ts',
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
