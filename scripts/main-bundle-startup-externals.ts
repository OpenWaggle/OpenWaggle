/**
 * Which external packages the built main bundle loads while it starts, measured by running it.
 *
 * `topLevelRequires` (main-bundle-requires.ts) only checks where an import sits in the file:
 * every function body counts as deferred. But a bundled module's initializer can still run at
 * startup and load a package whose `require()` sits in a function (MEMORY "What every process
 * pays"). This probe evaluates the bundle under Bun, the runtime that runs it, beside a
 * `node_modules` of stubs: one per external package (scripts/build-main.ts
 * `mainExternalPackages`, plus every subpath of it the bundle names), each recording that it was
 * loaded. It reports what loaded before the entry chunk finished evaluating, for the argument
 * vectors of the processes that start most often. Async work after startup (a Run, an opened
 * window) is not counted; it loads on use by design. A package that is neither stubbed nor a
 * runtime built-in fails to resolve, and the start reports that error.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Schema } from '@shared/schema'
import { scriptEnv } from './support/env'
import { unknownField } from './support/object-fields'

/** External packages the main bundle may load while it starts. Runtime built-ins always may. */
export const ALLOWED_STARTUP_EXTERNALS: readonly string[] = []

/**
 * The processes probed: a CLI answer, `openwaggle run`, `host start` and the Session Host itself.
 * The desktop app's own start needs the Electrobun launcher; its bundle initialization is the same.
 */
export const STARTUP_PROBE_ARGUMENTS: readonly (readonly string[])[] = [
  ['--version'],
  ['run', 'probe'],
  ['host', 'start'],
  ['session-host-internal'],
]

/** A stub package's module: it records its name and answers every access with a callable. */
function stubSource(name: string) {
  return String.raw`const loaded = (globalThis.__openwaggleStartupProbe ??= [])
if (!loaded.includes(${JSON.stringify(name)})) loaded.push(${JSON.stringify(name)})
const value = new Proxy(function () {}, {
  get(_target, key) {
    if (key === 'then') return undefined
    if (key === Symbol.toPrimitive) return () => ''
    if (key === Symbol.iterator) return function* () {}
    return value
  },
  apply: () => value,
  construct: () => value,
})
module.exports = new Proxy({}, {
  get: (_target, key) => (key === 'then' || key === '__esModule' ? undefined : value),
})
`
}

/** Runs as `bun -e PROBE_SOURCE <entry chunk> ...argv`, beside the stub `node_modules`. */
const PROBE_SOURCE = String.raw`
const [bundle, ...argv] = process.argv.slice(1)
process.argv = [process.argv[0], bundle, ...argv]
let error = null
try {
  await import(bundle)
} catch (thrown) {
  error = String((thrown && thrown.stack) || thrown).slice(0, 1000)
}
process.stdout.write(JSON.stringify({ loaded: globalThis.__openwaggleStartupProbe ?? [], error }) + '\n')
process.exit(0)
`

export interface StartupProbeResult {
  readonly argv: readonly string[]
  /** External packages, in the order the bundle first loaded them. */
  readonly loaded: readonly string[]
  /** Whatever the bundle threw while it started under the stubs, if anything. */
  readonly error: string | null
}

const PROBE_TIMEOUT_MS = 60_000
const PROBE_MAX_BUFFER_BYTES = 1024 * 1024

/** The probe's last line: the modules the bundle loaded, and its load error if any. */
const startupProbeOutputSchema = Schema.Struct({
  loaded: Schema.Array(Schema.Unknown),
  error: unknownField,
})

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

/** Each external package and every `<package>/<subpath>` string the bundle's files name. */
export function externalSpecifiers(sources: readonly string[], packages: Iterable<string>) {
  const specifiers = new Set<string>()
  for (const name of packages) {
    specifiers.add(name)
    const pattern = new RegExp(`["'\`](${escapeRegExp(name)}/[\\w./@-]+)["'\`]`, 'gu')
    for (const source of sources) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (specifier !== undefined) specifiers.add(specifier)
      }
    }
  }
  return [...specifiers].sort()
}

/** `@scope/name`: a scoped package's name is its first two path segments. */
const SCOPED_PACKAGE_SEGMENTS = 2

function packageOf(specifier: string) {
  const parts = specifier.split('/')
  return specifier.startsWith('@')
    ? parts.slice(0, SCOPED_PACKAGE_SEGMENTS).join('/')
    : (parts[0] ?? specifier)
}

const BARE_APP_MANIFEST = { name: 'openwaggle', version: '0.0.0' }

/** A copy of the bundle's directory beside a `node_modules` of recording stubs. */
function stagedBundle(root: string, bundleDirectory: string, packages: Iterable<string>) {
  const outDirectory = path.join(root, 'out', 'main')
  mkdirSync(outDirectory, { recursive: true })
  const sources: string[] = []
  for (const file of readdirSync(bundleDirectory)) {
    if (!file.endsWith('.js')) continue
    copyFileSync(path.join(bundleDirectory, file), path.join(outDirectory, file))
    sources.push(readFileSync(path.join(bundleDirectory, file), 'utf8'))
  }
  // The app's package.json, where the shell finds its root and version; a bare one beside a
  // bundle that is not the app's own (the probe's tests).
  const appManifest = path.join(bundleDirectory, '..', '..', 'package.json')
  const manifestCopy = path.join(root, 'package.json')
  if (existsSync(appManifest)) copyFileSync(appManifest, manifestCopy)
  else writeFileSync(manifestCopy, `${JSON.stringify(BARE_APP_MANIFEST)}\n`)
  for (const specifier of externalSpecifiers(sources, packages)) {
    const name = packageOf(specifier)
    const packageRoot = path.join(root, 'node_modules', name)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({ name })}\n`)
    const file =
      specifier === name
        ? path.join(packageRoot, 'index.js')
        : path.join(root, 'node_modules', `${specifier.replace(/\.js$/u, '')}.js`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, stubSource(name))
  }
  return outDirectory
}

/**
 * Evaluates `bundlePath` once per argument vector under `runtime` (Bun), in a throwaway HOME,
 * with `packages` stubbed, and reports what it loaded.
 */
export function probeStartupExternals(
  bundlePath: string,
  packages: Iterable<string>,
  runtime: string,
  argumentVectors: readonly (readonly string[])[] = STARTUP_PROBE_ARGUMENTS,
) {
  const root = mkdtempSync(path.join(tmpdir(), 'main-bundle-startup-'))
  try {
    const outDirectory = stagedBundle(root, path.dirname(path.resolve(bundlePath)), packages)
    const entry = path.join(outDirectory, path.basename(bundlePath))
    const home = path.join(root, 'home')
    mkdirSync(home)
    return argumentVectors.map((argv) => {
      const output = execFileSync(runtime, ['-e', PROBE_SOURCE, entry, ...argv], {
        cwd: root,
        encoding: 'utf8',
        // The copied bundle has no source maps beside it, which Bun warns about on stderr.
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: scriptEnv().PATH ?? '', HOME: home, USERPROFILE: home, TMPDIR: home },
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_MAX_BUFFER_BYTES,
      })
      const line = output.trim().split('\n').at(-1) ?? ''
      const parsed: unknown = JSON.parse(line)
      if (!Schema.is(startupProbeOutputSchema)(parsed)) {
        throw new Error(`The startup probe printed ${line}.`)
      }
      const result: StartupProbeResult = {
        argv,
        loaded: parsed.loaded.filter((name): name is string => typeof name === 'string'),
        error: typeof parsed.error === 'string' ? parsed.error : null,
      }
      return result
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Failures for `check:main-bundle`: a package outside the allowlist loaded at startup, or a start
 * that threw, since a start cut short could hide later loads.
 */
export function startupExternalFailures(
  results: readonly StartupProbeResult[],
  allowed: readonly string[] = ALLOWED_STARTUP_EXTERNALS,
) {
  return results.flatMap((result) => {
    const command = `\`${['openwaggle', ...result.argv].join(' ')}\``
    const unexpected = result.loaded.filter((name) => !allowed.includes(name))
    return [
      ...(unexpected.length > 0
        ? [
            `${command} loads ${unexpected.join(', ')} while the main bundle starts; import them where they are used ` +
              '(a module whose initializer runs at startup loads its imports then).',
          ]
        : []),
      ...(result.error
        ? [`${command} threw while the main bundle started under the probe: ${result.error}`]
        : []),
    ]
  })
}
