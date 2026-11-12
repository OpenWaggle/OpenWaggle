import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { captureFirstTurnPrefix } from '../capture-first-turn'
import { FIRST_TURN_PREFIX_BUDGETS } from '../first-turn-prefix-budget'
import { measurePrefixTokens } from '../prefix-tokens'
import { PREFIX_SESSION_ROLES } from '../session-identity-rows'

/**
 * The first-turn prefix budget (decision 6 of the v1 performance plan): what an empty project's
 * first model request carries before any user text, measured through OpenWaggle's own Run
 * composition with every first-party extension and the default settings.
 *
 * `OPENWAGGLE_PERF_PREFIX_OUT=<dir>` also writes the full per-section and per-tool report;
 * `OPENWAGGLE_PERF_PREFIX_PROJECT=<dir>` measures that project instead of an empty one (then no
 * budget applies), and `OPENWAGGLE_PERF_PREFIX_SECOND_REQUEST_MS` captures a second request after
 * MCP servers had that long to connect.
 */
const reportDirectory = process.env.OPENWAGGLE_PERF_PREFIX_OUT
const measuredProject = process.env.OPENWAGGLE_PERF_PREFIX_PROJECT
const secondRequestAfterMs = process.env.OPENWAGGLE_PERF_PREFIX_SECOND_REQUEST_MS
const MEASUREMENT_TIMEOUT_MS = 120_000
const JSON_INDENT = 2

const cleanups: string[] = []

// The Run's MCP extension keeps its sign-in state under Electron's user data, as in the Host.
vi.mock('electron', () => ({
  app: { getPath: () => process.env.OPENWAGGLE_USER_DATA_DIR ?? tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {},
}))

afterAll(async () => {
  await Promise.all(cleanups.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function projectToMeasure() {
  if (measuredProject) return measuredProject
  const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-prefix-project-'))
  cleanups.push(directory)
  return directory
}

async function writeReport(role: string, report: unknown) {
  if (!reportDirectory) return
  await mkdir(reportDirectory, { recursive: true })
  const file = path.join(reportDirectory, `first-turn-prefix-${role}.json`)
  await writeFile(file, `${JSON.stringify(report, null, JSON_INDENT)}\n`)
}

describe('first-turn prefix', () => {
  it.each(PREFIX_SESSION_ROLES)(
    'keeps the %s first request of an empty project within its o200k budget',
    async (role) => {
      const captured = await captureFirstTurnPrefix({
        projectPath: await projectToMeasure(),
        role,
        ...(secondRequestAfterMs ? { secondRequestAfterMs: Number(secondRequestAfterMs) } : {}),
      })
      const reports = captured.requests.map(measurePrefixTokens)
      const [first] = reports
      if (!first) throw new Error('The measured Run sent no provider request.')
      await writeReport(role, { role, project: measuredProject ?? 'empty', requests: reports })
      if (measuredProject) return
      expect(first.o200kTotal).toBeLessThanOrEqual(FIRST_TURN_PREFIX_BUDGETS[role])
    },
    MEASUREMENT_TIMEOUT_MS,
  )
})
