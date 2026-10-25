import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Tests must never see the real user's home: a dev run once migrated a maintainer's real
 * ~/.openwaggle/mcp.json. The home isolation has to be the first setup file of every config, so
 * nothing resolves a path before it, and every Node config also stubs the MCP migration entry.
 */

const HOME_ISOLATION = 'scripts/test-support/isolate-user-home.ts'
const MCP_ISOLATION = 'src/main/test-support/isolate-user-mcp-files.ts'
const TEMPORARY_ROOT = 'scripts/test-support/vitest-temporary-root.ts'

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** The root config file's `test` options, loaded the way Vitest loads it. */
async function testOptions(configFile: string): Promise<unknown> {
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

function setupFilesOf(test: unknown) {
  return filesOf(test, 'setupFiles')
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
  ])('isolates the home first and stubs the MCP migration in the %s config', async (_name, load) => {
    const files = setupFilesOf(await load())

    expect(files[0]).toBe(HOME_ISOLATION)
    expect(files).toContain(MCP_ISOLATION)
  })

  it.each([
    ['component', () => testOptions('vitest.component.config.ts')],
    ['coverage component project', () => coverageProject('component')],
  ])('isolates the home first in the %s config', async (_name, load) => {
    expect(setupFilesOf(await load())[0]).toBe(HOME_ISOLATION)
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
   * pnpm test:coverage runs the same tests under instrumentation. Without the tiers' deadlines it
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
})
