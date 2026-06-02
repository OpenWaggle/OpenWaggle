import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const FIXTURE_EXTENSION_ID = 'openwaggle-reload-qa'
const FIXTURE_SOURCE_PATH = path.join(
  REPOSITORY_ROOT,
  'fixtures',
  'extensions',
  FIXTURE_EXTENSION_ID,
)
const PROJECT_EXTENSION_ROOT = path.join(
  REPOSITORY_ROOT,
  ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
)
const FIXTURE_TARGET_PATH = path.join(PROJECT_EXTENSION_ROOT, FIXTURE_EXTENSION_ID)

async function main() {
  await mkdir(PROJECT_EXTENSION_ROOT, { recursive: true })
  await rm(FIXTURE_TARGET_PATH, { recursive: true, force: true })
  await cp(FIXTURE_SOURCE_PATH, FIXTURE_TARGET_PATH, { recursive: true })
  console.info(`Installed ${FIXTURE_EXTENSION_ID} at ${FIXTURE_TARGET_PATH}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
