/**
 * CEF files the Linux app never loads, removed in the postBuild hook (hooks-steps.ts), before Hutch
 * compresses the app into its update archive and self-extracting payload. The main window and every
 * Browser preview render with CEF on Linux, so only what Chromium never reads goes.
 *
 * Electrobun lays CEF out twice: the distribution under `bin/cef/`, and in `bin/`, beside the
 * executable, a copy of its data files with links to its libraries (`bin/libcef.so ->
 * cef/libcef.so`). CEF reads its data from the executable's directory (the native wrapper sets
 * `resources_dir_path` to it and `locales_dir_path` to its `locales/`), and the launcher and the
 * helpers load `bin/libcef.so`. So in `bin/cef/` only the libraries `bin/` links to are used:
 *
 * - `bin/cef/`'s copies of the data files in `bin/` (`resources.pak`, `icudtl.dat`, the snapshot,
 *   the scale packs, `chrome-sandbox`) and its `locales/` go.
 * - SwiftShader, Chromium's CPU Vulkan: Chromium no longer falls back to it for WebGL on a machine
 *   without a usable GPU, and without one it composites in software through Skia. Nothing in
 *   OpenWaggle uses WebGPU's fallback adapter, so the library, its link and its loader manifest go,
 *   as the Electron package drops them. Electrobun's launcher preloads it only when present. The
 *   Vulkan loader stays: ANGLE and Dawn reach the system's Vulkan driver through it.
 * - Locale packs other than `en-US.pak`: OpenWaggle's interface is English only, and Chromium falls
 *   back to `en-US.pak` when the system locale has no pack. A pack holds Chromium's own strings
 *   (context menus, dialogs) and its default Accept-Language, so on a system in another language a
 *   Browser preview's page now asks for English first.
 *
 * libcef.so also ships unstripped: its static symbol table and strings are about 195 of its 472 MB.
 * Nothing loads them (the dynamic symbols the launcher and the wrapper link against stay), so it
 * is stripped as distributions strip shared libraries (`strip --strip-unneeded`, GNU binutils).
 * The native layer's build strips its devkit already (vendor/electrobun/build.ts); this covers a
 * devkit that was not.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const CEF_LIBRARY = 'libcef.so'
const CEF_DATA = 'resources.pak'
const SWIFTSHADER_FILES = ['libvk_swiftshader.so', 'vk_swiftshader_icd.json'] as const
const LOCALES_DIRECTORY = 'locales'
const KEPT_LOCALES: ReadonlySet<string> = new Set(['en-US.pak'])
const LOCALE_PACK = /\.pak(?:\.info)?$/u

interface DirectoryListing {
  /** Regular files. */
  readonly files: readonly string[]
  /** Symbolic links, by name, to their targets as written. */
  readonly links: ReadonlyMap<string, string>
  readonly directories: readonly string[]
}

async function listDirectory(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const links = new Map<string, string>()
  for (const entry of entries.filter((candidate) => candidate.isSymbolicLink())) {
    links.set(entry.name, await fs.readlink(path.join(directory, entry.name)))
  }
  const listing: DirectoryListing = {
    files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    links,
    directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  }
  return listing
}

/** The directories under `root` CEF runs from: `libcef.so` (a file or a link) beside its data. */
async function runtimeDirectories(root: string): Promise<string[]> {
  const listing = await listDirectory(root)
  const names = new Set([...listing.files, ...listing.links.keys()])
  const found = names.has(CEF_LIBRARY) && listing.files.includes(CEF_DATA) ? [root] : []
  for (const name of listing.directories.filter((entry) => entry !== LOCALES_DIRECTORY)) {
    found.push(...(await runtimeDirectories(path.join(root, name))))
  }
  return found
}

function unusedLocales(directory: string, locales: readonly string[], keep: ReadonlySet<string>) {
  return locales
    .filter((file) => LOCALE_PACK.test(file) && !keep.has(file))
    .map((file) => path.join(directory, LOCALES_DIRECTORY, file))
}

/**
 * What to remove for one runtime directory, given its listing, its `locales/`, and, when its
 * `libcef.so` links into another directory, that directory's listing and `locales/`.
 */
export function unusedCefFiles(input: {
  readonly directory: string
  readonly listing: DirectoryListing
  readonly locales: readonly string[]
  readonly library?: {
    readonly directory: string
    readonly listing: DirectoryListing
    readonly locales: readonly string[]
  }
}) {
  const { directory, listing, library } = input
  const swiftshader = SWIFTSHADER_FILES.filter(
    (file) => listing.files.includes(file) || listing.links.has(file),
  ).map((file) => path.join(directory, file))
  const locales = unusedLocales(directory, input.locales, KEPT_LOCALES)
  if (library === undefined) return [...swiftshader, ...locales]
  const linkedSwiftshader = SWIFTSHADER_FILES.filter((file) =>
    library.listing.files.includes(file),
  ).map((file) => path.join(library.directory, file))
  const copies = library.listing.files
    .filter((file) => listing.files.includes(file))
    .map((file) => path.join(library.directory, file))
  // The executable's directory holds the locales CEF reads, so none of the library's are kept.
  const libraryLocales = unusedLocales(library.directory, library.locales, new Set())
  return [...swiftshader, ...locales, ...linkedSwiftshader, ...copies, ...libraryLocales]
}

async function stripSharedLibrary(file: string) {
  await run('strip', ['--strip-unneeded', file])
}

/** The directory `libcef.so` links into, when it is a link, else null. */
function libraryDirectory(directory: string, listing: DirectoryListing) {
  const target = listing.links.get(CEF_LIBRARY)
  return target === undefined ? null : path.dirname(path.resolve(directory, target))
}

/**
 * Removes the unused CEF files of every Linux app under `buildDirectory` and strips its libcef.so;
 * returns what it removed and stripped.
 */
export async function pruneLinuxCef(buildDirectory: string, strip = stripSharedLibrary) {
  const removed: string[] = []
  const stripped: string[] = []
  const runtimes = await Promise.all(
    (await runtimeDirectories(buildDirectory)).map(async (directory) => {
      const listing = await listDirectory(directory)
      return { directory, listing, linked: libraryDirectory(directory, listing) }
    }),
  )
  // A distribution another runtime directory links its libcef.so into is pruned through that one.
  const linkedInto = new Set(runtimes.flatMap(({ linked }) => (linked === null ? [] : [linked])))
  for (const { directory, listing, linked } of runtimes) {
    if (linkedInto.has(directory)) continue
    const locales = (await listDirectory(path.join(directory, LOCALES_DIRECTORY))).files
    const library =
      linked === null
        ? undefined
        : {
            directory: linked,
            listing: await listDirectory(linked),
            locales: (await listDirectory(path.join(linked, LOCALES_DIRECTORY))).files,
          }
    const unused = unusedCefFiles({
      directory,
      listing,
      locales,
      ...(library === undefined ? {} : { library }),
    })
    for (const file of unused) {
      await fs.rm(file, { force: true })
      removed.push(path.relative(buildDirectory, file))
    }
    const realLibrary = path.join(linked ?? directory, CEF_LIBRARY)
    await strip(realLibrary)
    stripped.push(path.relative(buildDirectory, realLibrary))
  }
  return { removed, stripped }
}
