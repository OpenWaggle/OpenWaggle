/**
 * The Session data budgets (performance/perf-budgets.json, `sessions.*`): what the desktop window
 * moves and what the Session Host's SQLite store does when the sidebar opens on a project with
 * 3,000 Sessions and when a 2,000-message Session opens. The workload (session-data-workload.ts)
 * goes into the real store through the app runtime; the reads (session-data-window-reads.ts) are
 * the renderer's, served by the Host's own dispatch (session-host-reads.ts). Every value is a count,
 * so it is the same on every run and machine.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SESSION_CATALOG_PAGE_SIZE } from '@shared/types/openwaggle-api-session-catalog'
import { SESSION_DETAIL_MESSAGE_WINDOW } from '@shared/types/session-transcript-window'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as AppRuntime from '../../../src/main/runtime'
import { expectPerfMeasurements } from '../budget-test-support'
import { openSession, openSidebar } from './session-data-window-reads'
import {
  LONG_SESSION_ID,
  PINNED_SESSION_COUNT,
  seedSessionDataWorkload,
} from './session-data-workload'
import { sessionHostReads } from './session-host-reads'
import { meterSqliteWork } from './sqlite-work-meter'

const SOURCE = 'scripts/perf-gate/__tests__/session-data-budgets.integration.test.ts'
/** Every reply the reads return is read at this instant, so no timestamp in them moves. */
const READ_AT_MS = 1_767_830_400_000
/** Loading the app runtime cold can take most of a minute on a loaded runner. */
const COLD_IMPORT_TIMEOUT_MS = 180_000
const WORKLOAD_TIMEOUT_MS = 120_000

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

let runtime: typeof AppRuntime

beforeAll(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-data-budgets-'))
  runtime = await import('../../../src/main/runtime')
  await runtime.resetAppRuntimeForTests()
}, COLD_IMPORT_TIMEOUT_MS)

afterAll(async () => {
  await runtime.resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('Session data budgets', () => {
  it(
    'keeps the sidebar and Session open reads of a large project within the budgets file',
    async () => {
      const clock = vi.spyOn(Date, 'now')
      const meter = meterSqliteWork()
      try {
        await seedSessionDataWorkload((milliseconds) => clock.mockReturnValue(milliseconds))
        clock.mockReturnValue(READ_AT_MS)
        const host = sessionHostReads(runtime.runAppEffect, meter)

        const sidebar = await host.measure(() => openSidebar(host))
        const open = await host.measure(() => openSession(host, LONG_SESSION_ID))

        expectPerfMeasurements('session-data', SOURCE, {
          'sessions.sidebar.bytes': sidebar.bytes,
          'sessions.sidebar.rows': sidebar.rows,
          'sessions.sidebar.queries': sidebar.statements,
          'sessions.sidebar.by-ids-batches': sidebar.channels.filter(
            (channel) => channel === 'sessions:list-by-ids',
          ).length,
          'sessions.open.bytes': open.bytes,
          'sessions.open.rows': open.rows,
          'sessions.open.queries': open.statements,
        })

        // The reads saw the workload: full first pages, every pin, the newest window of messages.
        expect(sidebar.result.active.sessions).toHaveLength(SESSION_CATALOG_PAGE_SIZE)
        expect(sidebar.result.active.nextCursor).toBeDefined()
        expect(sidebar.result.archived.sessions).toHaveLength(SESSION_CATALOG_PAGE_SIZE)
        expect(sidebar.result.pinned).toHaveLength(PINNED_SESSION_COUNT)
        expect(open.result.detail?.messages).toHaveLength(SESSION_DETAIL_MESSAGE_WINDOW)
        expect(open.result.workspace?.transcriptPath.length).toBeGreaterThan(0)
      } finally {
        meter.restore()
        clock.mockRestore()
      }
    },
    WORKLOAD_TIMEOUT_MS,
  )
})
