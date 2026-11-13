/**
 * CEF files the Linux app never loads, removed in the postBuild hook (hooks-steps.ts), before Hutch
 * compresses the app into its update archive and self-extracting payload. The main window and every
 * Browser preview render with CEF on Linux, so only what Chromium never reads goes:
 *
 * - SwiftShader, Chromium's CPU Vulkan: Chromium no longer falls back to it for WebGL on a machine
 *   without a usable GPU, and without one it composites in software through Skia. Nothing in
 *   OpenWaggle uses WebGPU's fallback adapter, so the library and its loader manifest go, as the
 *   Electron package drops them. Electrobun's launcher preloads it only when present. The Vulkan
 *   loader stays: ANGLE and Dawn reach the system's Vulkan driver through it.
 * - Locale packs other than `en-US.pak`: OpenWaggle's interface is English only, and Chromium falls
 *   back to `en-US.pak` when the system locale has no pack. A pack holds Chromium's own strings
 *   (context menus, dialogs) and its default Accept-Language, so on a system in another language a
 *   Browser preview's page now asks for English first.
 *
 * libcef.so also ships unstripped: its static symbol table and strings are about 195 of its 472 MB.
 * Nothing loads them (the dynamic symbols the launcher and the wrapper link against stay), so it
 * is stripped as distributions strip shared libraries (`strip --strip-unneeded`, GNU binutils).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const CEF_LIBRARY = 'libcef.so'
const SWIFTSHADER_FILES = ['libvk_swiftshader.so', 'vk_swiftshader_icd.json'] as const
const LOCALES_DIRECTORY = 'locales'
const KEPT_LOCALES: ReadonlySet<string> = new Set(['en-US.pak'])
const LOCALE_PACK = /\.pak(?:\.info)?$/u

/** The directories under `root` that hold CEF's library: the app's `bin/`. */
async function cefDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const found = entries.some((entry) => entry.isFile() && entry.name === CEF_LIBRARY) ? [root] : []
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== LOCALES_DIRECTORY) {
      found.push(...(await cefDirectories(path.join(root, entry.name))))
    }
  }
  return found
}

/** What to remove beside one `libcef.so`, given the names in its directory and `locales/`. */
export function unusedCefFiles(input: {
  readonly directory: string
  readonly files: readonly string[]
  readonly locales: readonly string[]
}) {
  const swiftshader = SWIFTSHADER_FILES.filter((file) => input.files.includes(file)).map((file) =>
    path.join(input.directory, file),
  )
  const locales = input.locales
    .filter((file) => LOCALE_PACK.test(file) && !KEPT_LOCALES.has(file))
    .map((file) => path.join(input.directory, LOCALES_DIRECTORY, file))
  return [...swiftshader, ...locales]
}

async function stripSharedLibrary(file: string) {
  await run('strip', ['--strip-unneeded', file])
}

/**
 * Removes the unused CEF files of every Linux app under `buildDirectory` and strips its libcef.so;
 * returns what it removed and stripped.
 */
export async function pruneLinuxCef(buildDirectory: string, strip = stripSharedLibrary) {
  const removed: string[] = []
  const stripped: string[] = []
  for (const directory of await cefDirectories(buildDirectory)) {
    const files = await fs.readdir(directory)
    const locales = await fs.readdir(path.join(directory, LOCALES_DIRECTORY)).catch(() => [])
    for (const file of unusedCefFiles({ directory, files, locales })) {
      await fs.rm(file, { force: true })
      removed.push(path.relative(buildDirectory, file))
    }
    const library = path.join(directory, CEF_LIBRARY)
    await strip(library)
    stripped.push(path.relative(buildDirectory, library))
  }
  return { removed, stripped }
}
