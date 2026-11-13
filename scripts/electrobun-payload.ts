/**
 * Electrobun release layouts. A packaged Electrobun app is a small self-extracting wrapper (its
 * launcher is Electrobun's extractor) around a zstd-compressed tar of the real app in
 * `Resources/<hash>.tar.zst`; the first launch unpacks that payload. Release guards have to read both
 * trees, because both run on the user's machine.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export type ElectrobunPlatform = 'darwin' | 'linux' | 'win32'

const PAYLOAD_SUFFIX = '.tar.zst'
const EXEC_BUFFER_BYTES = 64 * 1024 * 1024
/**
 * Windows' own bsdtar: the GNU tar that Git for Windows puts first on PATH reads `C:\...` as a
 * remote `host:path` archive.
 */
const TAR =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'

/** Where each platform's Electrobun launcher lives, relative to the app root. */
export const ELECTROBUN_LAUNCHER: Readonly<Record<ElectrobunPlatform, readonly string[]>> = {
  darwin: ['Contents/MacOS/launcher'],
  linux: ['bin/launcher', 'launcher'],
  win32: ['bin/launcher.exe', 'launcher.exe'],
}

/** The `Resources` directory that holds a payload, per platform. */
const RESOURCES: Readonly<Record<ElectrobunPlatform, string>> = {
  darwin: 'Contents/Resources',
  linux: 'Resources',
  win32: 'Resources',
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

export async function electrobunLauncher(root: string, platform: ElectrobunPlatform) {
  for (const candidate of ELECTROBUN_LAUNCHER[platform]) {
    if (await exists(path.join(root, candidate))) return candidate
  }
  return null
}

export async function electrobunPayloads(root: string, platform: ElectrobunPlatform) {
  const resources = path.join(root, RESOURCES[platform])
  const entries = await fs.readdir(resources).catch(() => [])
  return entries
    .filter((name) => name.endsWith(PAYLOAD_SUFFIX))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => path.join(resources, name))
}

async function decompressZstd(source: string, destination: string) {
  const decompress = Reflect.get(zlib, 'zstdDecompressSync')
  if (typeof decompress === 'function') {
    const output: unknown = decompress(await fs.readFile(source))
    if (Buffer.isBuffer(output)) {
      await fs.writeFile(destination, output)
      return
    }
  }
  execFileSync('zstd', ['-d', '-f', '-q', source, '-o', destination], {
    maxBuffer: EXEC_BUFFER_BYTES,
  })
}

/** Unpacks a payload into `tree` (created if needed), the same bytes the wrapper installs. */
export async function unpackElectrobunPayload(payload: string, tree: string) {
  await fs.mkdir(tree, { recursive: true })
  const tarball = `${tree}.payload.tar`
  try {
    await decompressZstd(payload, tarball)
    execFileSync(TAR, ['-xf', tarball, '-C', tree], { maxBuffer: EXEC_BUFFER_BYTES })
  } finally {
    await fs.rm(tarball, { force: true })
  }
  const entries = await fs.readdir(tree, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(tree, entry.name))
}

/**
 * Unpacks a payload into a fresh temporary directory and returns the app roots inside it (the
 * archive's top-level directories, such as `OpenWaggle.app`).
 */
export async function extractElectrobunPayload(payload: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electrobun-payload-'))
  const roots = await unpackElectrobunPayload(payload, path.join(directory, 'tree'))
  return { directory, roots }
}
