/**
 * Chromium files the packaged app never loads, removed from each pack before it is signed
 * (electron-builder `afterPack`).
 *
 * SwiftShader is Chromium's CPU implementation of Vulkan. Chromium stopped falling back to it for
 * WebGL on a machine without a usable GPU (WebGL fails there unless the user passes
 * `--enable-unsafe-swiftshader`), and without a GPU it composites in software through Skia, not
 * SwiftShader. Nothing in OpenWaggle uses WebGPU's fallback adapter or forces ANGLE onto it, so the
 * library (16 MB on macOS, 5 MB on Windows and Linux) and its loader manifest are dead weight. The
 * Vulkan loader itself stays: ANGLE and Dawn load the system's Vulkan driver through it.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'

type PackedPlatform = 'darwin' | 'linux' | 'win32'

const SWIFTSHADER_MANIFEST = 'vk_swiftshader_icd.json'
const SWIFTSHADER_LIBRARY: Readonly<Record<PackedPlatform, string>> = {
  darwin: 'libvk_swiftshader.dylib',
  linux: 'libvk_swiftshader.so',
  win32: 'vk_swiftshader.dll',
}

/**
 * Chromium's files in a packed app: `appPath` is the `.app` bundle on macOS and the directory
 * holding the executable elsewhere.
 */
export function unusedChromiumFiles(appPath: string, platform: PackedPlatform) {
  const directory =
    platform === 'darwin'
      ? path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Libraries')
      : appPath
  return [SWIFTSHADER_LIBRARY[platform], SWIFTSHADER_MANIFEST].map((file) =>
    path.join(directory, file),
  )
}

function isPackedPlatform(value: string): value is PackedPlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32'
}

/** The part of electron-builder's `AfterPackContext` the hook reads. */
export interface AfterPackContext {
  readonly appOutDir: string
  readonly electronPlatformName: string
  readonly packager: { readonly appInfo: { readonly productFilename: string } }
}

/** electron-builder `afterPack`: runs once per packed platform and architecture. */
export async function removeUnusedChromiumFiles(context: AfterPackContext) {
  const platform = context.electronPlatformName
  if (!isPackedPlatform(platform)) return
  const appPath =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : context.appOutDir
  const files = unusedChromiumFiles(appPath, platform)
  await Promise.all(files.map((file) => rm(file, { force: true })))
}
