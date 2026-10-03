import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { build, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FUNCTIONS_DIRECTORY = path.join(ROOT, 'functions')
const ENTRY = 'functions/api/v1/[[path]].ts'
const BUILTINS: ReadonlySet<string> = new Set(builtinModules)
/** Wrangler turns every `onRequest*` export of any file under functions/ into a route. */
const ROUTE_EXPORT =
  /\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+(?<name>onRequest\w*)|\bexport\s*\{[^}]*\bonRequest\w*/u

/** Fails the bundle on any Node built-in, which the Workers runtime does not provide. */
function forbidNodeBuiltins(): Plugin {
  return {
    name: 'forbid-node-builtins',
    enforce: 'pre',
    resolveId(source) {
      if (source.startsWith('node:') || BUILTINS.has(source)) {
        throw new Error(`The Pages Function imports the Node built-in ${source}`)
      }
      return null
    },
  }
}

function typeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return typeScriptFiles(entryPath)
    return entry.name.endsWith('.ts') ? [entryPath] : []
  })
}

async function bundleEntry() {
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    publicDir: false,
    plugins: [forbidNodeBuiltins()],
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      lib: { entry: path.join(ROOT, ENTRY), formats: ['es'], fileName: 'functions-worker' },
      rolldownOptions: { platform: 'neutral' },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  return outputs.flatMap((output) => ('output' in output ? output.output : []))
}

describe('Pages Functions bundle', () => {
  it('bundles the endpoint for the Workers runtime without Node built-ins or externals', async () => {
    const chunks = (await bundleEntry()).filter((output) => output.type === 'chunk')

    expect(chunks).toHaveLength(1)
    const [chunk] = chunks
    expect(chunk?.type === 'chunk' && chunk.exports).toEqual(['onRequest'])
    expect(chunk?.type === 'chunk' && [...chunk.imports, ...chunk.dynamicImports]).toEqual([])
  })

  it('declares a route only in the catch-all entry', () => {
    const routeFiles = typeScriptFiles(FUNCTIONS_DIRECTORY)
      .filter((file) => ROUTE_EXPORT.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))

    expect(routeFiles).toEqual([ENTRY])
  })
})
