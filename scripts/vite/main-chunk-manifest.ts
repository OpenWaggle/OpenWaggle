import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

import { MAIN_CHUNK_MANIFEST_PATH, type MainChunkManifestEntry } from '../main-bundle-graph'

function sourceModule(root: string, id: string) {
  const withoutQuery = id.replace(/\?.*$/u, '')
  return path.isAbsolute(withoutQuery)
    ? path.relative(root, withoutQuery).split(path.sep).join('/')
    : withoutQuery
}

/**
 * Records which chunk holds which source modules, so the main bundle's per-process budgets
 * (scripts/check-main-bundle.ts) can name the chunks the GUI, the Session Host and a CLI command
 * load at startup by their source entry rather than by a content-hashed file name.
 */
export function mainChunkManifestPlugin() {
  let root = ''
  let outDir = ''
  const entries: MainChunkManifestEntry[] = []
  return {
    name: 'openwaggle:main-chunk-manifest',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    generateBundle(_options, bundle) {
      entries.length = 0
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        entries.push({
          file: output.fileName,
          isEntry: output.isEntry,
          modules: Object.keys(output.modules).map((id) => sourceModule(root, id)),
          imports: output.imports,
          dynamicImports: output.dynamicImports,
        })
      }
    },
    async writeBundle() {
      const file = path.join(outDir, MAIN_CHUNK_MANIFEST_PATH)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, `${JSON.stringify(entries)}\n`)
    },
  } satisfies Plugin
}
