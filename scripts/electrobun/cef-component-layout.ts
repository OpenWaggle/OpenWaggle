/**
 * The macOS CEF component's layout and names (vendor/electrobun/README.md, "CEF component"), shared
 * by the scripts that build, pin and verify it.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import type { CefComponentArch } from '../../src/main/adapters/electrobun/cef-component/cef-component-manifest'

export const CEF_COMPONENT_MANIFEST = 'src/main/adapters/electrobun/cef-component/manifest.json'
export const CEF_FRAMEWORK = 'Chromium Embedded Framework.framework'
/** Electrobun names the helpers after the app's `bun` executable; Chromium picks the variant. */
export const CEF_HELPER_APPS = [
  'bun Helper',
  'bun Helper (GPU)',
  'bun Helper (Renderer)',
  'bun Helper (Plugin)',
  'bun Helper (Alerts)',
] as const
export type { CefComponentArch }

/** The CEF version a devkit's native layer was built with, as the native layer names it. */
export async function devkitCefVersion(devkit: string) {
  const source = await fs.readFile(path.join(devkit, 'api', 'shared', 'cef-version.ts'), 'utf8')
  const cef = /CEF_VERSION = `([^`]+)`/u.exec(source)?.[1]
  const chromium = /CHROMIUM_VERSION = `([^`]+)`/u.exec(source)?.[1]
  if (cef === undefined || chromium === undefined) {
    throw new Error(`${devkit} names no CEF version in api/shared/cef-version.ts.`)
  }
  return `${cef}+chromium-${chromium}`
}

/** `156.0.7+g47dbc1d+chromium-…` → `cef-component-156.0.7-g47dbc1d-darwin-arm64.tar.xz`. */
export function cefComponentArchiveName(cefVersion: string, arch: CefComponentArch) {
  const [cef = cefVersion] = cefVersion.split('+chromium-')
  return `cef-component-${cef.replaceAll('+', '-')}-darwin-${arch}.tar.xz`
}

/** The component's top-level entries, in the archive and in its install directory. */
export function cefComponentEntries() {
  return [CEF_FRAMEWORK, ...CEF_HELPER_APPS.map((helper) => `${helper}.app`)]
}

export async function sha256File(file: string) {
  const hash = createHash('sha256')
  const stream = createReadStream(file)
  stream.on('data', (chunk) => hash.update(chunk))
  await finished(stream)
  return hash.digest('hex')
}
