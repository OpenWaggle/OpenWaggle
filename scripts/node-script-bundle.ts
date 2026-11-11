import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bunExecutable, nodeRuntime } from './support/node-runtime'

/**
 * Some scripts must run on Node.js rather than Bun: the native load probe loads modules built for
 * Node's ABI, and the MCP conformance client exercises the HTTP stack the app
 * ships (Bun replaces the `undici` package with its own). Node cannot load the repository's
 * extensionless TypeScript imports or path aliases, so Bun bundles such a script into one ES
 * module under `node_modules/.cache/openwaggle` first.
 *
 * `bun scripts/node-script-bundle.ts <script>` prints the bundle path, for workflows that start it
 * themselves; `bun scripts/node-script-bundle.ts --run <script> [args...]` runs it on Node.js.
 */
const BUNDLE_DIRECTORY = ['node_modules', '.cache', 'openwaggle'] as const
const RUN_FLAG = '--run'
const FIRST_ARGUMENT_INDEX = 2

export function nodeScriptBundlePath(
  projectRoot: string,
  source: string,
  platform: NodeJS.Platform = process.platform,
) {
  const path = platform === 'win32' ? win32 : posix
  return path.join(projectRoot, ...BUNDLE_DIRECTORY, `${basename(source, extname(source))}.mjs`)
}

export function nodeScriptBuildInvocation(
  projectRoot: string,
  source: string,
  platform: NodeJS.Platform = process.platform,
  bun: string = bunExecutable(),
) {
  const path = platform === 'win32' ? win32 : posix
  return {
    command: bun,
    args: [
      'build',
      path.resolve(projectRoot, source),
      '--target=node',
      '--format=esm',
      '--outfile',
      nodeScriptBundlePath(projectRoot, source, platform),
    ],
  }
}

/** Bundles `source` (relative to `projectRoot`) and returns the module to run with Node. */
export async function buildNodeScript(projectRoot: string, source: string) {
  const outfile = nodeScriptBundlePath(projectRoot, source)
  await mkdir(dirname(outfile), { recursive: true })
  const invocation = nodeScriptBuildInvocation(projectRoot, source)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`bun build of ${source} exited with code ${String(code)}.`))
    })
  })
  return outfile
}

async function runOnNode(projectRoot: string, source: string, args: readonly string[]) {
  const outfile = await buildNodeScript(projectRoot, source)
  return new Promise<number>((resolve, reject) => {
    const child = spawn(nodeRuntime().execPath, [outfile, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

async function main(args: readonly string[]) {
  const [first, ...rest] = args
  if (first === RUN_FLAG) {
    const [source, ...scriptArgs] = rest
    if (source === undefined) {
      throw new Error(`Usage: bun scripts/node-script-bundle.ts ${RUN_FLAG} <script> [args...]`)
    }
    process.exitCode = await runOnNode(process.cwd(), source, scriptArgs)
    return
  }
  if (first === undefined) throw new Error('Usage: bun scripts/node-script-bundle.ts <script>')
  console.log(await buildNodeScript(process.cwd(), first))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_ARGUMENT_INDEX)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
