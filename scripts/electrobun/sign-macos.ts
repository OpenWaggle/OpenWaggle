/**
 * Signs the unwrapped Electrobun `OpenWaggle.app` inside out, the way the release signs it with its
 * Developer ID (docs/electrobun-transition.md, "macOS keychain"): every nested Mach-O first, then
 * frameworks and helper bundles, then the app. Hutch's own signing stays off because it signs the
 * bundled `bun` with codesign's default identifier (`bun`); Bun.secrets runs in that process, and
 * Electron's keychain item only trusts code whose designated requirement names
 * `com.openwaggle.app`, so `bun` is signed with the app's identifier.
 *
 *   bun scripts/electrobun/sign-macos.ts <OpenWaggle.app> --identity <name|hash> [--keychain <path>]
 *     [--entitlements <plist>] [--identifier com.openwaggle.app] [--no-timestamp]
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const run = promisify(execFile)
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const FIRST_CLI_ARGUMENT = 2
const MACH_O_MAGIC = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
])
const MAGIC_BYTES = 4
const NESTED_BUNDLE = /\.(?:framework|app|xpc|appex)$/u
const RUNTIME_EXECUTABLE = 'bun'
export const ELECTROBUN_ENTITLEMENTS = 'build/entitlements.electrobun.mac.plist'

export interface MacosSigningOptions {
  readonly app: string
  readonly identity: string
  readonly bundleId: string
  readonly keychain?: string
  readonly entitlements?: string
  /** Apple's timestamp service; a self-signed CI identity signs without one. */
  readonly timestamp: boolean
  /**
   * Re-seals only the app bundle, for a resource changed after the inside-out pass (Hutch's final
   * `version.json`); the nested code keeps its signatures, which the seal records by hash.
   */
  readonly sealOnly?: boolean
}

async function isMachO(file: string) {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(MAGIC_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MAGIC_BYTES, 0)
    return bytesRead === MAGIC_BYTES && MACH_O_MAGIC.has(buffer.readUInt32BE(0))
  } finally {
    await handle.close()
  }
}

/** Every regular file and nested bundle under `directory`, without following symlinks. */
async function walk(directory: string) {
  const files: string[] = []
  const bundles: string[] = []
  const visit = async (current: string) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isFile()) files.push(full)
      if (!entry.isDirectory()) continue
      await visit(full)
      if (NESTED_BUNDLE.test(entry.name)) bundles.push(full)
    }
  }
  await visit(directory)
  return { files, bundles }
}

const depth = (file: string) => file.split(path.sep).length
const BUNDLE_EXECUTABLE = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/u

/** `Contents/MacOS/<CFBundleExecutable>` of an `.app` bundle, from its XML Info.plist. */
async function mainExecutable(bundle: string) {
  const plist = await fs
    .readFile(path.join(bundle, 'Contents', 'Info.plist'), 'utf8')
    .catch(() => '')
  const name = BUNDLE_EXECUTABLE.exec(plist)?.[1]
  return name === undefined ? null : path.join(bundle, 'Contents', 'MacOS', name)
}

/**
 * The order codesign needs: deepest code first, each bundle after its contents, the app last. An
 * app's main executable is left to its bundle: codesign given that file signs the whole bundle, and
 * fails while nested code it has not reached yet is unsigned (an x86_64 `zig-zstd` has no linker
 * signature).
 */
export async function macosSigningOrder(app: string) {
  const { files, bundles } = await walk(path.join(app, 'Contents'))
  const apps = [app, ...bundles.filter((bundle) => bundle.endsWith('.app'))]
  const mainExecutables = new Set(await Promise.all(apps.map(mainExecutable)))
  const machO: string[] = []
  for (const file of files) {
    if (!mainExecutables.has(file) && (await isMachO(file))) machO.push(file)
  }
  const byDepth = (left: string, right: string) =>
    depth(right) - depth(left) || left.localeCompare(right)
  return [...machO.sort(byDepth), ...bundles.sort(byDepth), app]
}

export async function signMacosApp(options: MacosSigningOptions) {
  const base = [
    '--force',
    options.timestamp ? '--timestamp' : '--timestamp=none',
    '--sign',
    options.identity,
    ...(options.keychain === undefined ? [] : ['--keychain', options.keychain]),
    '--options',
    'runtime',
    ...(options.entitlements === undefined ? [] : ['--entitlements', options.entitlements]),
  ]
  const signed: string[] = []
  const targets = options.sealOnly === true ? [options.app] : await macosSigningOrder(options.app)
  for (const target of targets) {
    const identifier =
      target === options.app || path.basename(target) === RUNTIME_EXECUTABLE
        ? ['--identifier', options.bundleId]
        : []
    await run('codesign', [...base, ...identifier, target], { maxBuffer: MAX_BUFFER_BYTES })
    signed.push(target)
  }
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', options.app], {
    maxBuffer: MAX_BUFFER_BYTES,
  })
  return signed
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(FIRST_CLI_ARGUMENT),
    allowPositionals: true,
    options: {
      identity: { type: 'string' },
      keychain: { type: 'string' },
      entitlements: { type: 'string', default: ELECTROBUN_ENTITLEMENTS },
      identifier: { type: 'string', default: 'com.openwaggle.app' },
      'no-timestamp': { type: 'boolean', default: false },
    },
  })
  const [app] = positionals
  if (app === undefined || values.identity === undefined) {
    throw new Error('Usage: sign-macos.ts <App.app> --identity <identity> [--keychain <path>]')
  }
  const signed = await signMacosApp({
    app: path.resolve(app),
    identity: values.identity,
    bundleId: values.identifier,
    entitlements: values.entitlements,
    timestamp: !values['no-timestamp'],
    ...(values.keychain === undefined ? {} : { keychain: values.keychain }),
  })
  console.log(`Signed ${signed.length} items in ${app}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
