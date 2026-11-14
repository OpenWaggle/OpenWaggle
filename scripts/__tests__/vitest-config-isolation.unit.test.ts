import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REUSED_WORKER_SETUP, testTimeZone } from '../test-support/vitest-tier-options'

/*
 * Tests must never see the real user's home: a dev run once migrated a maintainer's real
 * ~/.openwaggle/mcp.json. The home isolation has to be the first setup file of every config, so
 * nothing resolves a path before it, and every Node config also stubs the MCP migration entry. In
 * the tiers that reuse workers, only the reset that gives each file a fresh worker's modules and
 * process state comes before it; it resolves no path.
 */

const HOME_ISOLATION = 'scripts/test-support/isolate-user-home.ts'
const MCP_ISOLATION = 'src/main/test-support/isolate-user-mcp-files.ts'
const TEMPORARY_ROOT = 'scripts/test-support/vitest-temporary-root.ts'

function field(value: unknown, key: string) {
  const result: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  return result
}

/** The root config file's `test` options, loaded the way Vitest loads it. */
async function testOptions(configFile: string) {
  const loaded: unknown = await import(pathToFileURL(path.resolve(configFile)).href)
  return field(field(loaded, 'default'), 'test')
}

async function coverageProject(name: string) {
  const projects = field(await testOptions('vitest.coverage.config.ts'), 'projects')
  const project = Array.isArray(projects)
    ? projects.find((candidate) => field(field(candidate, 'test'), 'name') === name)
    : undefined
  if (!project) throw new Error(`No coverage project named ${name}.`)
  return field(project, 'test')
}

function filesOf(test: unknown, key: 'setupFiles' | 'globalSetup') {
  const files = field(test, key)
  if (typeof files === 'string') return [files]
  return Array.isArray(files) ? files.filter((file) => typeof file === 'string') : []
}

/** The setup files after the reused-worker reset, which must come first when a config has it. */
function setupFilesOf(test: unknown) {
  const files = filesOf(test, 'setupFiles')
  return files[0] === REUSED_WORKER_SETUP ? files.slice(1) : files
}

function timeoutsOf(test: unknown) {
  return { testTimeout: field(test, 'testTimeout'), hookTimeout: field(test, 'hookTimeout') }
}

describe('Vitest config isolation', () => {
  it.each([
    ['unit', () => testOptions('vitest.unit.config.ts')],
    ['integration', () => testOptions('vitest.integration.config.ts')],
    ['default', () => testOptions('vitest.config.ts')],
    ['coverage node project', () => coverageProject('node')],
  ])(
    'isolates the home first and stubs the MCP migration in the %s config',
    async (_name, load) => {
      const files = setupFilesOf(await load())

      expect(files[0]).toBe(HOME_ISOLATION)
      expect(files).toContain(MCP_ISOLATION)
    },
  )

  it.each([
    ['component', () => testOptions('vitest.component.config.ts')],
    ['coverage component project', () => coverageProject('component')],
  ])('isolates the home first in the %s config', async (_name, load) => {
    expect(setupFilesOf(await load())[0]).toBe(HOME_ISOLATION)
  })

  it.each([
    ['unit', 'vitest.unit.config.ts', true],
    ['component', 'vitest.component.config.ts', true],
    ['integration', 'vitest.integration.config.ts', false],
    ['default', 'vitest.config.ts', false],
  ])('the %s config reuses workers only with the reset first', async (_name, config, reused) => {
    const test = await testOptions(config)
    const files = filesOf(test, 'setupFiles')

    expect(field(test, 'isolate') === false).toBe(reused)
    expect(files.indexOf(REUSED_WORKER_SETUP)).toBe(reused ? 0 : -1)
  })

  it.each([
    ['unit', () => testOptions('vitest.unit.config.ts')],
    ['integration', () => testOptions('vitest.integration.config.ts')],
    ['component', () => testOptions('vitest.component.config.ts')],
    ['default', () => testOptions('vitest.config.ts')],
    ['coverage', () => testOptions('vitest.coverage.config.ts')],
  ])('removes the run temporary root after the %s config', async (_name, load) => {
    expect(filesOf(await load(), 'globalSetup')).toContain(TEMPORARY_ROOT)
  })

  /*
   * `bun run test:coverage` runs the same tests under instrumentation. Without the tiers' deadlines it
   * fell back to Vitest's 5 s default, and 26 tests in 10 files timed out on a clean main.
   */
  it.each([
    ['node', 'vitest.unit.config.ts'],
    ['node', 'vitest.integration.config.ts'],
    ['component', 'vitest.component.config.ts'],
  ])('gives the coverage %s project the timeouts of %s', async (project, tierConfig) => {
    expect(timeoutsOf(await coverageProject(project))).toEqual(
      timeoutsOf(await testOptions(tierConfig)),
    )
  })

  it('keeps generous timeouts in the Node tiers', async () => {
    for (const tier of ['vitest.unit.config.ts', 'vitest.integration.config.ts']) {
      expect(timeoutsOf(await testOptions(tier))).toEqual({
        testTimeout: 60_000,
        hookTimeout: 60_000,
      })
    }
  })

  /*
   * Tests that read local dates passed on UTC CI and failed on a machine far from UTC, so every
   * config runs its tests in one zone far from UTC, on every machine.
   */
  it.each([
    ['unit', () => testOptions('vitest.unit.config.ts')],
    ['integration', () => testOptions('vitest.integration.config.ts')],
    ['component', () => testOptions('vitest.component.config.ts')],
    ['default', () => testOptions('vitest.config.ts')],
    ['coverage node project', () => coverageProject('node')],
    ['coverage component project', () => coverageProject('component')],
  ])('pins the time zone in the %s config', async (_name, load) => {
    expect(field(field(await load(), 'env'), 'TZ')).toBe(testTimeZone())
  })
})
