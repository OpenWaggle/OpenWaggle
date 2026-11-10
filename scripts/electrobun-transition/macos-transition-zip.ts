/**
 * Zips the signed Electrobun `OpenWaggle.app` as the macOS transition artifact that existing
 * Electron installs download through electron-updater (docs/electrobun-transition.md).
 *
 * electron-updater hands the zip to Squirrel.Mac (ShipIt), which unpacks it and installs it over
 * the running bundle only if the new bundle satisfies the running app's designated requirement:
 * the same bundle identifier and the same signing identity (for Developer ID: the same Team ID).
 * This builder runs the same check before publishing, against the requirement of the release the
 * installs are on, so a mismatched identity fails the release instead of every user's update.
 *
 *   bun scripts/electrobun-transition/macos-transition-zip.ts <OpenWaggle.app> <out.zip> <bundle-id> [requirement]
 */
import { execFile } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ARGUMENT_OFFSET = 2
const MAX_BUFFER_BYTES = 16 * 1024 * 1024

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string; readonly stderr: string }>

const defaultRunner: CommandRunner = (command, args) =>
  run(command, [...args], { maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' })

/** The requirement Squirrel.Mac enforces for a Developer ID build of `bundleId` by `teamId`. */
export function developerIdRequirement(bundleId: string, teamId: string) {
  return (
    `identifier "${bundleId}" and anchor apple generic and ` +
    'certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and ' +
    'certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and ' +
    `certificate leaf[subject.OU] = ${teamId}`
  )
}

export interface MacosTransitionZipInput {
  readonly app: string
  readonly outFile: string
  readonly bundleId: string
  /** The designated requirement of the installed Electron build (`codesign -d -r-`). */
  readonly requirement?: string
  readonly runner?: CommandRunner
}

export async function buildMacosTransitionZip(input: MacosTransitionZipInput) {
  const runner = input.runner ?? defaultRunner
  if (path.extname(input.app) !== '.app') throw new Error(`${input.app} is not an app bundle.`)
  const plist = path.join(input.app, 'Contents', 'Info.plist')
  await access(plist)
  const { stdout: bundleId } = await runner('plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    plist,
  ])
  if (bundleId.trim() !== input.bundleId) {
    throw new Error(`${input.app} has bundle identifier ${bundleId.trim()}, not ${input.bundleId}.`)
  }
  await runner('codesign', ['--verify', '--deep', '--strict', '--verbose=2', input.app])
  if (input.requirement) {
    // Squirrel.Mac's own acceptance test: the update must satisfy the running app's requirement.
    await runner('codesign', [
      '--verify',
      '--deep',
      '--strict',
      `-R=${input.requirement}`,
      input.app,
    ])
  }
  await rm(input.outFile, { force: true })
  // ditto keeps symlinks, modes and extended attributes, which the code signature covers.
  await runner('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', input.app, input.outFile])
  return input.outFile
}

async function main() {
  const [app, outFile, bundleId, requirement] = process.argv.slice(ARGUMENT_OFFSET)
  if (!app || !outFile || !bundleId) {
    throw new Error(
      'Usage: macos-transition-zip.ts <OpenWaggle.app> <out.zip> <bundle-id> [requirement]',
    )
  }
  await buildMacosTransitionZip({ app, outFile, bundleId, ...(requirement ? { requirement } : {}) })
  process.stdout.write(`${outFile}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
