/**
 * Which OpenWaggle build the benchmark's OpenWaggle row measured: the app's version and the commit
 * it was built from (`out/build-meta.json`, written by `scripts/record-build-meta.ts`). The page
 * prints it, so a published number names its build rather than "the v1 performance build".
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readAsarArchive } from '../asar-archive'

export interface AppIdentity {
  readonly appVersion: string | null
  readonly commit: string | null
}

const PACKAGED_ASAR = path.join('Contents', 'Resources', 'app.asar')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function field(raw: string | null, name: string) {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  const value = isRecord(parsed) ? parsed[name] : undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function readOrNull(read: () => Promise<Buffer | string>) {
  try {
    return (await read()).toString()
  } catch {
    return null
  }
}

/** `appPath` is an `OpenWaggle.app` bundle or a built checkout, as `--app` accepts. */
export async function readAppIdentity(appPath: string): Promise<AppIdentity> {
  const resolved = path.resolve(appPath)
  if (resolved.endsWith('.app')) {
    const archive = await readAsarArchive(path.join(resolved, PACKAGED_ASAR))
    return {
      appVersion: field(await readOrNull(() => archive.readFile('/package.json')), 'version'),
      commit: field(await readOrNull(() => archive.readFile('/out/build-meta.json')), 'commit'),
    }
  }
  return {
    appVersion: field(await readOrNull(() => readFile(path.join(resolved, 'package.json'), 'utf8')), 'version'),
    commit: field(await readOrNull(() => readFile(path.join(resolved, 'out', 'build-meta.json'), 'utf8')), 'commit'),
  }
}
