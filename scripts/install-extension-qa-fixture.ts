import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const FIXTURE_EXTENSION_IDS = [
  'openwaggle-reload-qa',
  'openwaggle-github-issues-overview',
] as const
type FixtureExtensionId = (typeof FIXTURE_EXTENSION_IDS)[number]

const FIXTURE_ROOT = path.join(REPOSITORY_ROOT, 'fixtures', 'extensions')
const PROJECT_EXTENSION_ROOT = path.join(
  REPOSITORY_ROOT,
  ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
)
const ALL_FIXTURES_ARG = 'all'
const USER_ARG_OFFSET = 2

function isFixtureExtensionId(fixtureId: string): fixtureId is FixtureExtensionId {
  return FIXTURE_EXTENSION_IDS.some((knownFixtureId) => knownFixtureId === fixtureId)
}

function fixtureIdsFromArgs(args: readonly string[]): readonly FixtureExtensionId[] {
  if (args.length === 0 || args.includes(ALL_FIXTURES_ARG)) {
    return FIXTURE_EXTENSION_IDS
  }

  return args.filter(isFixtureExtensionId)
}

function unsupportedFixtureIds(args: readonly string[]) {
  return args.filter((fixtureId) => fixtureId !== ALL_FIXTURES_ARG && !isFixtureExtensionId(fixtureId))
}

async function installFixture(fixtureId: FixtureExtensionId) {
  const fixtureSourcePath = path.join(FIXTURE_ROOT, fixtureId)
  const fixtureTargetPath = path.join(PROJECT_EXTENSION_ROOT, fixtureId)
  await rm(fixtureTargetPath, { recursive: true, force: true })
  await cp(fixtureSourcePath, fixtureTargetPath, { recursive: true })
  console.info(`Installed ${fixtureId} at ${fixtureTargetPath}`)
}

async function main() {
  const userArgs = process.argv.slice(USER_ARG_OFFSET)
  const unsupportedIds = unsupportedFixtureIds(userArgs)
  if (unsupportedIds.length > 0) {
    throw new Error(`Unknown extension QA fixture: ${unsupportedIds.join(', ')}`)
  }

  const fixtureIds = fixtureIdsFromArgs(userArgs)
  await mkdir(PROJECT_EXTENSION_ROOT, { recursive: true })
  for (const fixtureId of fixtureIds) {
    await installFixture(fixtureId)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
