import fs from 'node:fs/promises'
import path from 'node:path'

export const SESSION_RESOURCE_TEMPORARY_SUFFIX = '.tmp'
const LEGACY_RANDOM_TEMPORARY_PATTERN =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u

async function removeLegacyRandomTemporaryFiles(sessionDirectory: string) {
  const entries = await fs.readdir(sessionDirectory, { withFileTypes: true })
  await Promise.all(
    entries.flatMap((entry) =>
      entry.isFile() && LEGACY_RANDOM_TEMPORARY_PATTERN.test(entry.name)
        ? [fs.rm(path.join(sessionDirectory, entry.name), { force: true })]
        : [],
    ),
  )
}

export function createSessionResourceTemporaryPathManager() {
  const sweptSessionDirectories = new Set<string>()
  return async (sessionDirectory: string, targetPath: string) => {
    if (!sweptSessionDirectories.has(sessionDirectory)) {
      await removeLegacyRandomTemporaryFiles(sessionDirectory)
      sweptSessionDirectories.add(sessionDirectory)
    }
    const temporaryPath = `${targetPath}${SESSION_RESOURCE_TEMPORARY_SUFFIX}`
    await fs.rm(temporaryPath, { force: true })
    return temporaryPath
  }
}
