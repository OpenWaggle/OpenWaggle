/**
 * Skips a cacheable step (a package build) when its inputs, commands and dependencies are the same
 * as when it last passed and its outputs still exist. The cache lives in .tmp/check/cache.json;
 * CI starts without one, so every step runs there.
 */
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import micromatch from 'micromatch'
import type { CheckStep } from './step-model'

export const CACHE_FILE = '.tmp/check/cache.json'
const JSON_INDENT = 2

export type StepCacheEntries = Record<string, string>

export async function readJsonFile(file: string) {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return parsed
  } catch {
    return undefined
  }
}

export async function readStepCache() {
  const parsed = await readJsonFile(CACHE_FILE)
  if (parsed === null || typeof parsed !== 'object') return {}
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

export async function writeStepCache(entries: StepCacheEntries) {
  await writeFile(CACHE_FILE, `${JSON.stringify(entries, null, JSON_INDENT)}\n`)
}

/**
 * Hashes the step's commands (executable names, not their install paths), its dependencies'
 * fingerprints, and the path, size and mtime of every repository file matching its inputs.
 */
export async function stepFingerprint(
  step: CheckStep,
  repositoryFiles: readonly string[],
  dependencyFingerprints: readonly string[],
) {
  const hash = createHash('sha256')
  hash.update(
    JSON.stringify(step.commands.map((command) => command.map((part) => path.basename(part)))),
  )
  for (const dependency of dependencyFingerprints) hash.update(dependency)
  const inputs = repositoryFiles.filter((file) =>
    micromatch.isMatch(file, [...step.inputs], { dot: true }),
  )
  const stats = await Promise.all(inputs.map((file) => stat(file).catch(() => undefined)))
  inputs.forEach((file, index) => {
    const entry = stats[index]
    hash.update(`${file}\0${entry?.size ?? -1}\0${entry?.mtimeMs ?? -1}\n`)
  })
  return hash.digest('hex')
}

export async function stepOutputsExist(step: CheckStep) {
  const outputs = step.cache?.outputs ?? []
  const present = await Promise.all(
    outputs.map((output) =>
      stat(output).then(
        () => true,
        () => false,
      ),
    ),
  )
  return present.every(Boolean)
}
