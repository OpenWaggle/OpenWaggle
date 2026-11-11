/**
 * Which OpenWaggle build the benchmark's OpenWaggle row measured: the app's version and the commit
 * it was built from (`out/build-meta.json`, written by `scripts/record-build-meta.ts`). The page
 * prints it, so a published number names its build rather than "the v1 performance build".
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface AppIdentity {
  readonly appVersion: string | null
  readonly commit: string | null
}

/** Where an Electrobun `.app` keeps OpenWaggle's files (scripts/electrobun/app-config.ts). */
const PACKAGED_APP = path.join('Contents', 'Resources', 'app')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function field(raw: string | null, name: string) {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  const value = isRecord(parsed) ? parsed[name] : undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function readOrNull(file: string) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** `appPath` is an `OpenWaggle.app` bundle or a built checkout, as `--app` accepts. */
export async function readAppIdentity(appPath: string) {
  const resolved = path.resolve(appPath)
  const root = resolved.endsWith('.app') ? path.join(resolved, PACKAGED_APP) : resolved
  const identity: AppIdentity = {
    appVersion: field(await readOrNull(path.join(root, 'package.json')), 'version'),
    commit: field(await readOrNull(path.join(root, 'out', 'build-meta.json')), 'commit'),
  }
  return identity
}
