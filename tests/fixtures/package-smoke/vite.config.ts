import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const NODE_BUILT_INS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    {
      name: 'reject-node-built-ins',
      enforce: 'pre',
      resolveId(source) {
        if (NODE_BUILT_INS.has(source)) {
          throw new Error(`Browser package smoke cannot import Node built-in ${source}.`)
        }
      },
    },
  ],
  build: {
    lib: {
      cssFileName: 'browser-smoke',
      entry: 'browser-smoke.ts',
      formats: ['es'],
      name: 'OpenWagglePackageSmoke',
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
})
