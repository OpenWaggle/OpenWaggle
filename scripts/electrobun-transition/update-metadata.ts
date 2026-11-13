/**
 * electron-updater metadata for the Electrobun transition artifacts (ADR 0066,
 * docs/electrobun-transition.md). Existing Electron installs read `<feed>-mac.yml`,
 * `<feed>.yml` (Windows) and `<feed>-linux.yml` from the newest eligible GitHub release
 * (src/main/update-feed.ts); this writes the same format for the artifacts that move them to the
 * Electrobun build, so no further Electron release is needed.
 *
 * electron-updater checks only what this file states: each download's `sha512` (base64) and
 * `size`. No `.blockmap` is published for a transition artifact, so the differential download
 * fails its blockmap request and falls back to the full file, which is the right outcome: nothing
 * in the old installation matches the new bytes. On macOS the zip is then verified by Squirrel.Mac
 * against the running app's designated requirement; on Windows the installer's Authenticode
 * signature is checked only if the installed `app-update.yml` names a `publisherName`.
 *
 *   bun scripts/electrobun-transition/update-metadata.ts <directory> <version> <mac|windows|linux> <channel> <file...>
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMatching, P } from '@diegogbrisa/ts-match'
import { updaterFeedChannel, type UpdateChannel } from '../../src/shared/types/update-channel'

export type TransitionPlatform = 'mac' | 'windows' | 'linux'
export type TransitionFeedChannel = UpdateChannel | 'rc'

const ARTIFACT_PATTERNS: Readonly<Record<TransitionPlatform, RegExp>> = {
  mac: /^openwaggle-.+-(arm64|x64)\.zip$/u,
  windows: /^openwaggle-.+-x64\.exe$/u,
  linux: /^openwaggle-.+-x86_64\.AppImage$/u,
}
const ARGUMENT_OFFSET = 2

interface UpdateFile {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

export function transitionMetadataFilename(
  channel: TransitionFeedChannel,
  platform: TransitionPlatform,
) {
  const feed = channel === 'rc' ? channel : updaterFeedChannel(channel)
  const suffix = platform === 'mac' ? '-mac' : platform === 'linux' ? '-linux' : ''
  return `${feed}${suffix}.yml`
}

async function sha512(filePath: string) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) {
    if (chunk instanceof Buffer) hash.update(chunk)
  }
  return hash.digest('base64')
}

async function updateFile(filePath: string, platform: TransitionPlatform) {
  const url = path.basename(filePath)
  if (!ARTIFACT_PATTERNS[platform].test(url)) {
    // electron-updater picks files by name: the arch in a macOS zip, `.exe`, `.AppImage`.
    throw new Error(`${url} is not named like a ${platform} artifact electron-updater selects.`)
  }
  const [digest, info] = await Promise.all([sha512(filePath), stat(filePath)])
  return { url, sha512: digest, size: info.size }
}

function yamlString(value: string) {
  return JSON.stringify(value)
}

/**
 * The file electron-updater's legacy `path`/`sha512` fields name: on macOS the x64 zip, which an
 * Intel Mac without an arm64 match falls back to (a single-architecture build names its own zip).
 */
function primaryFile(files: readonly UpdateFile[], platform: TransitionPlatform) {
  const intel = platform === 'mac' ? files.find((file) => file.url.endsWith('-x64.zip')) : undefined
  const primary = intel ?? files[0]
  if (!primary) throw new Error(`No primary ${platform} transition artifact was given.`)
  return primary
}

export function renderTransitionMetadata(input: {
  readonly version: string
  readonly platform: TransitionPlatform
  readonly files: readonly UpdateFile[]
  readonly releaseDate: string
}) {
  const lines = [`version: ${yamlString(input.version)}`, 'files:']
  for (const file of input.files) {
    lines.push(
      `  - url: ${yamlString(file.url)}`,
      `    sha512: ${yamlString(file.sha512)}`,
      `    size: ${String(file.size)}`,
    )
    // The wrapper installs per user; never route it through elevate.exe.
    if (input.platform === 'windows') lines.push('    isAdminRightsRequired: false')
  }
  const primary = primaryFile(input.files, input.platform)
  lines.push(
    `path: ${yamlString(primary.url)}`,
    `sha512: ${yamlString(primary.sha512)}`,
    `releaseDate: ${yamlString(input.releaseDate)}`,
    '',
  )
  return lines.join('\n')
}

/** Writes `<feed>[-mac|-linux].yml` beside the artifacts and returns its name. */
export async function writeTransitionMetadata(input: {
  readonly directory: string
  readonly version: string
  readonly platform: TransitionPlatform
  readonly channel: TransitionFeedChannel
  readonly files: readonly string[]
  readonly releaseDate?: string
}) {
  const files = await Promise.all(
    input.files.map((file) => updateFile(path.resolve(input.directory, file), input.platform)),
  )
  const name = transitionMetadataFilename(input.channel, input.platform)
  const metadata = renderTransitionMetadata({
    version: input.version,
    platform: input.platform,
    files,
    releaseDate: input.releaseDate ?? new Date().toISOString(),
  })
  await writeFile(path.join(input.directory, name), metadata)
  return name
}

async function main() {
  const [directory, version, platform, channel, ...files] = process.argv.slice(ARGUMENT_OFFSET)
  if (!directory || !version || !platform || !channel || files.length === 0) {
    throw new Error(
      'Usage: update-metadata.ts <directory> <version> <mac|windows|linux> <stable|rc|beta|alpha> <file...>',
    )
  }
  if (!isMatching(P.union('mac', 'windows', 'linux'), platform)) {
    throw new Error(`Unsupported platform: ${platform}.`)
  }
  if (!isMatching(P.union('stable', 'rc', 'beta', 'alpha'), channel)) {
    throw new Error(`Unsupported channel: ${channel}.`)
  }
  const name = await writeTransitionMetadata({ directory, version, platform, channel, files })
  process.stdout.write(`${name}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
