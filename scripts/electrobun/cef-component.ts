/**
 * The macOS CEF component (docs/electrobun-transition.md, "CEF component"): the Chromium Embedded
 * Framework and Electrobun's CEF helper apps, which the app downloads on its first Browser preview
 * instead of bundling them (vendor patch 0015 starts CEF from the install directory).
 *
 *   bun scripts/electrobun/cef-component.ts build --devkit <devkit> --arch <arm64|x64> --out <dir>
 *     [--identity <name|hash> [--keychain <path>] [--entitlements <plist>] [--no-timestamp]]
 *   bun scripts/electrobun/cef-component.ts pin --arch <arm64|x64> --url <url> --archive <file>
 *   bun scripts/electrobun/cef-component.ts verify --devkit <devkit> --arch <arm64|x64>
 *
 * `build` assembles the component from a native devkit (vendor/electrobun/build.ts), signs it with
 * the app's identity when one is given (ad hoc otherwise), notarizes it when the notary credentials
 * are set too, and writes
 * `<out>/cef-component-<cef>-darwin-<arch>.tar.xz` and a `.json` beside it with its sha256 and
 * size. `pin` records an archive's URL, sha256 and size in the committed manifest the app verifies
 * downloads against. `verify` fails unless the pinned asset is the component this devkit needs,
 * signed by APPLE_TEAM_ID when that is set.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import {
  CEF_COMPONENT_MANIFEST,
  CEF_FRAMEWORK,
  CEF_HELPER_APPS,
  cefComponentArchiveName,
  cefComponentEntries,
  devkitCefVersion,
  sha256File,
  type CefComponentArch,
} from './cef-component-layout'
import { pinCefComponent, verifyPinnedCefComponent } from './cef-component-manifest'
import { notarizeMacosDirectory, notaryCredentials, type NotaryCredentials } from './notarize-macos'
import { ELECTROBUN_ENTITLEMENTS, signMacosDirectory } from './sign-macos'

const run = promisify(execFile)
const FIRST_CLI_ARGUMENT = 2
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const EXECUTABLE_MODE = 0o755
const JSON_INDENT = 2
/** The release's Apple team, whose signature `verify` requires when it is set. */
const TEAM_ID_ENV = 'APPLE_TEAM_ID'

/** The framework and one helper app per variant, each the devkit's `process_helper`. */
export async function assembleCefComponent(devkit: string, directory: string) {
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })
  await run('/bin/cp', ['-R', path.join(devkit, 'cef', CEF_FRAMEWORK), directory])
  for (const helper of CEF_HELPER_APPS) {
    const executable = path.join(directory, `${helper}.app`, 'Contents', 'MacOS', helper)
    await fs.mkdir(path.dirname(executable), { recursive: true })
    await fs.copyFile(path.join(devkit, 'process_helper'), executable)
    await fs.chmod(executable, EXECUTABLE_MODE)
  }
}

interface SigningInput {
  readonly identity: string
  readonly keychain?: string
  readonly entitlements: string
  readonly timestamp: boolean
}

export async function buildCefComponent(input: {
  readonly devkit: string
  readonly arch: CefComponentArch
  readonly out: string
  readonly signing: SigningInput | null
  /** Notarizes the signed component and staples its helper apps. */
  readonly notary?: NotaryCredentials | null
}) {
  const cefVersion = await devkitCefVersion(input.devkit)
  const directory = path.join(input.out, `cef-component-${input.arch}`)
  await assembleCefComponent(input.devkit, directory)
  if (input.signing === null) {
    await run('codesign', ['--force', '--deep', '--sign', '-', ...cefComponentEntries()], {
      cwd: directory,
      maxBuffer: MAX_BUFFER_BYTES,
    })
  } else {
    await signMacosDirectory({ directory, ...input.signing })
  }
  if (input.notary) {
    const helpers = CEF_HELPER_APPS.map((helper) => path.join(directory, `${helper}.app`))
    await notarizeMacosDirectory(directory, helpers, input.notary)
  }
  const archive = path.join(input.out, cefComponentArchiveName(cefVersion, input.arch))
  await fs.rm(archive, { force: true })
  await run(
    '/usr/bin/tar',
    ['--options', 'xz:compression-level=9', '-cJf', archive, ...cefComponentEntries()],
    {
      cwd: directory,
      maxBuffer: MAX_BUFFER_BYTES,
    },
  )
  const { size } = await fs.stat(archive)
  const result = { cefVersion, arch: input.arch, archive, sha256: await sha256File(archive), size }
  await fs.writeFile(`${archive}.json`, `${JSON.stringify(result, null, JSON_INDENT)}\n`)
  return result
}

function parseArch(value: string | undefined): CefComponentArch {
  if (value === 'arm64' || value === 'x64') return value
  throw new Error(`--arch must be arm64 or x64, not ${String(value)}.`)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(FIRST_CLI_ARGUMENT),
    allowPositionals: true,
    options: {
      devkit: { type: 'string' },
      arch: { type: 'string' },
      out: { type: 'string', default: 'out/electrobun/cef-component' },
      identity: { type: 'string' },
      keychain: { type: 'string' },
      entitlements: { type: 'string', default: ELECTROBUN_ENTITLEMENTS },
      'no-timestamp': { type: 'boolean', default: false },
      url: { type: 'string' },
      archive: { type: 'string' },
      manifest: { type: 'string', default: CEF_COMPONENT_MANIFEST },
    },
  })
  const arch = parseArch(values.arch)
  const [command] = positionals
  if (command === 'pin' && values.url !== undefined && values.archive !== undefined) {
    const { manifest, url, archive } = values
    console.log(JSON.stringify(await pinCefComponent({ manifest, arch, url, archive })))
    return
  }
  if (command === 'verify' && values.devkit !== undefined) {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cef-component-'))
    const team = process.env[TEAM_ID_ENV]?.trim()
    try {
      const devkit = path.resolve(values.devkit)
      const verified = await verifyPinnedCefComponent({
        ...{ manifest: values.manifest, devkit, arch, work },
        ...(team ? { team } : {}),
      })
      console.log(JSON.stringify(verified))
    } finally {
      await fs.rm(work, { recursive: true, force: true })
    }
    return
  }
  if (command !== 'build' || values.devkit === undefined) {
    throw new Error(
      'Usage: cef-component.ts build --devkit <dir> --arch <arch> | pin --arch <arch> --url <url> --archive <file>',
    )
  }
  const signing =
    values.identity === undefined
      ? null
      : {
          identity: values.identity,
          entitlements: values.entitlements,
          timestamp: !values['no-timestamp'],
          ...(values.keychain === undefined ? {} : { keychain: values.keychain }),
        }
  const result = await buildCefComponent({
    devkit: path.resolve(values.devkit),
    arch,
    out: path.resolve(values.out),
    signing,
    // APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID, as the app's notarization reads them.
    notary: signing === null ? null : notaryCredentials(process.env),
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
