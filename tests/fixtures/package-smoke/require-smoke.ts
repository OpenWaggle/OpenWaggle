import { createRequire } from 'node:module'

const commonJsLoader = createRequire(import.meta.url)

for (const moduleId of [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-sdk/agent-loop',
  '@openwaggle/extension-sdk/broker',
  '@openwaggle/extension-sdk/constants',
  '@openwaggle/extension-sdk/context',
  '@openwaggle/extension-sdk/docs',
  '@openwaggle/extension-sdk/json',
  '@openwaggle/extension-sdk/manifest',
  '@openwaggle/extension-sdk/runtime',
  '@openwaggle/extension-sdk/theme',
  '@openwaggle/extension-sdk/types',
  '@openwaggle/extension-sdk/ui',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/waggle-core/config',
  '@openwaggle/waggle-core/consensus',
  '@openwaggle/waggle-core/events',
  '@openwaggle/waggle-core/presets',
  '@openwaggle/waggle-core/prompts',
  '@openwaggle/waggle-core/state',
  '@openwaggle/waggle-core/turn-policy',
  '@openwaggle/pi-waggle',
  '@openwaggle/pi-waggle/commands',
  '@openwaggle/pi-waggle/extension',
  '@openwaggle/pi-waggle/loop',
  '@openwaggle/pi-waggle/mode-state',
  '@openwaggle/pi-waggle/preset-storage',
  '@openwaggle/pi-waggle/presets',
  '@openwaggle/pi-waggle/protocol',
  '@openwaggle/pi-waggle/renderers',
  '@openwaggle/pi-waggle/stop-policy',
]) {
  commonJsLoader(moduleId)
}

console.log('cjs export smoke passed')
