/**
 * The committed CEF component manifest (scripts/electrobun/cef-component.ts): pinning an archive in
 * it, and checking that the pinned asset is the component a release's native layer needs.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from '../../src/shared/utils/validation'
import {
  cefComponentEntries,
  devkitCefVersion,
  sha256File,
  type CefComponentArch,
} from './cef-component-layout'

const run = promisify(execFile)
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const JSON_INDENT = 2

/** Records one architecture's asset in the manifest, keeping the others. */
export async function pinCefComponent(input: {
  readonly manifest: string
  readonly arch: CefComponentArch
  readonly url: string
  readonly archive: string
}) {
  const manifest: unknown = JSON.parse(await fs.readFile(input.manifest, 'utf8'))
  if (!isRecord(manifest) || !isRecord(manifest['assets'])) {
    throw new Error(`${input.manifest} is not a CEF component manifest.`)
  }
  const { size } = await fs.stat(input.archive)
  const asset = { url: input.url, sha256: await sha256File(input.archive), size }
  const assets = { ...manifest['assets'], [`darwin-${input.arch}`]: asset }
  await fs.writeFile(
    input.manifest,
    `${JSON.stringify({ ...manifest, assets }, null, JSON_INDENT)}\n`,
  )
  return asset
}

interface PinnedAsset {
  readonly url: string
  readonly sha256: string
  readonly size: number
}

async function pinnedAsset(manifestPath: string, arch: CefComponentArch) {
  const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const assets = isRecord(manifest) && isRecord(manifest['assets']) ? manifest['assets'] : {}
  const asset = assets[`darwin-${arch}`]
  const cefVersion = isRecord(manifest) ? manifest['cefVersion'] : null
  if (
    typeof cefVersion !== 'string' ||
    !isRecord(asset) ||
    typeof asset['url'] !== 'string' ||
    typeof asset['sha256'] !== 'string' ||
    typeof asset['size'] !== 'number'
  ) {
    throw new Error(`${manifestPath} pins no darwin-${arch} CEF component.`)
  }
  const pinned: PinnedAsset = { url: asset['url'], sha256: asset['sha256'], size: asset['size'] }
  return { cefVersion, asset: pinned }
}

/**
 * Fails unless the manifest's asset for `arch` is what this release's app will install: the devkit's
 * CEF version, downloadable, the pinned size and sha256, the component layout, and code that
 * verifies (signed by `team` when given). release.yml runs it before packaging macOS.
 */
export async function verifyPinnedCefComponent(input: {
  readonly manifest: string
  readonly devkit: string
  readonly arch: CefComponentArch
  readonly work: string
  readonly team?: string
}) {
  const { cefVersion, asset } = await pinnedAsset(input.manifest, input.arch)
  const devkitVersion = await devkitCefVersion(input.devkit)
  if (cefVersion !== devkitVersion) {
    throw new Error(`The manifest pins CEF ${cefVersion}; the native layer has ${devkitVersion}.`)
  }
  const response = await fetch(asset.url)
  if (!response.ok) throw new Error(`${asset.url}: HTTP ${String(response.status)}`)
  const archive = path.join(input.work, 'component.tar.xz')
  const component = path.join(input.work, 'component')
  await fs.mkdir(component, { recursive: true })
  await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const { size } = await fs.stat(archive)
  const sha256 = await sha256File(archive)
  if (size !== asset.size || sha256 !== asset.sha256) {
    throw new Error(
      `${asset.url} is ${String(size)} bytes, sha256 ${sha256}; the manifest pins another.`,
    )
  }
  await run('/usr/bin/tar', ['-xJf', archive, '-C', component], { maxBuffer: MAX_BUFFER_BYTES })
  const entries = (await fs.readdir(component)).sort()
  if (entries.join('\n') !== [...cefComponentEntries()].sort().join('\n')) {
    throw new Error(`${asset.url} holds ${entries.join(', ')}, not the CEF component layout.`)
  }
  for (const entry of entries) {
    const code = path.join(component, entry)
    await run('codesign', ['--verify', '--deep', '--strict', code], { maxBuffer: MAX_BUFFER_BYTES })
    const { stderr } = await run('codesign', ['-dv', code], { maxBuffer: MAX_BUFFER_BYTES })
    if (input.team !== undefined && !stderr.includes(`TeamIdentifier=${input.team}\n`)) {
      throw new Error(`${entry} in ${asset.url} is not signed by team ${input.team}.`)
    }
  }
  return { cefVersion, ...asset }
}
