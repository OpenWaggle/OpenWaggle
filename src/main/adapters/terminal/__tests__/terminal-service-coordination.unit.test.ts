import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey, TerminalPortPreview } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalProcessActivitySnapshot,
  TerminalProcessInspector,
} from '../terminal-process-inspector'
import { observeTerminalProjectActionActivity } from '../terminal-project-action'
import type { TerminalRecord } from '../terminal-records'
import type { TerminalRuntime } from '../terminal-runtime'
import { startTerminalActivityInspection } from '../terminal-service-coordination'

const portPreviewMocks = vi.hoisted(() => ({
  forProcessPids: vi.fn((): readonly TerminalPortPreview[] => []),
}))

vi.mock('../terminal-process-ports', () => ({
  terminalPortPreviewsForProcessPids: portPreviewMocks.forProcessPids,
}))

const KEY: TerminalKey = 'session-1::main'
const DELIVERED_AT_MS = 10
const FALLBACK_AT_MS = DELIVERED_AT_MS + TERMINAL.PROJECT_ACTION_IDLE_FALLBACK_MS

const IDLE_SNAPSHOT: TerminalProcessActivitySnapshot = {
  processName: null,
  processNames: [],
  processPids: [100],
  processIdentities: [{ pid: 100, startedAt: 'shell-start' }],
  tty: 'ttys001',
  ports: [],
  processReliable: true,
  reliable: true,
}

type InspectorCallback = (key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => void

function makeInspectorHarness() {
  let onActivity: InspectorCallback | null = null
  let onObservation: InspectorCallback | null = null
  const inspector = fromPartial<TerminalProcessInspector>({
    start(callback: InspectorCallback) {
      onActivity = callback
    },
    observe(callback: InspectorCallback) {
      onObservation = callback
    },
  })
  const activity = (snapshot: TerminalProcessActivitySnapshot) => onActivity?.(KEY, snapshot)
  const observation = (snapshot: TerminalProcessActivitySnapshot) => onObservation?.(KEY, snapshot)
  return { inspector, activity, observation }
}

function makeBarrierHarness() {
  const record = fromPartial<TerminalRecord>({
    key: KEY,
    projectAction: {
      executionId: 'fast-action',
      deliveredAfterPromptEpoch: 1,
      sawRunning: false,
      deliveredAtMonotonicMs: DELIVERED_AT_MS,
      reliableIdleObservations: 0,
    },
  })
  const metadataChanged = vi.fn()
  const emitEvent = vi.fn()
  const runtime = fromPartial<TerminalRuntime>({
    records: new Map([[KEY, record]]),
    emitEvent,
    observeProjectActionActivity(current: TerminalRecord) {
      if (observeTerminalProjectActionActivity(current, FALLBACK_AT_MS)) metadataChanged()
    },
  })
  return { record, runtime, metadataChanged, emitEvent }
}

describe('terminal service activity coordination', () => {
  beforeEach(() => {
    portPreviewMocks.forProcessPids.mockReset()
    portPreviewMocks.forProcessPids.mockReturnValue([])
  })

  it('completes a missed fast action from unchanged reliable observations', () => {
    const { inspector, activity, observation } = makeInspectorHarness()
    const { record, runtime, metadataChanged, emitEvent } = makeBarrierHarness()
    startTerminalActivityInspection(inspector, runtime)

    activity(IDLE_SNAPSHOT)
    observation(IDLE_SNAPSHOT)
    expect(record.projectAction?.reliableIdleObservations).toBe(1)

    observation(IDLE_SNAPSHOT)
    expect(record.projectAction).toBeNull()
    expect(metadataChanged).toHaveBeenCalledOnce()
    expect(emitEvent).toHaveBeenCalledTimes(3)
  })

  it('breaks the idle streak when a process observation becomes uncertain', () => {
    const { inspector, activity, observation } = makeInspectorHarness()
    const { record, runtime } = makeBarrierHarness()
    startTerminalActivityInspection(inspector, runtime)

    activity(IDLE_SNAPSHOT)
    observation(IDLE_SNAPSHOT)
    activity({ ...IDLE_SNAPSHOT, processReliable: false, reliable: false })
    expect(record.projectAction?.reliableIdleObservations).toBe(0)

    activity(IDLE_SNAPSHOT)
    observation(IDLE_SNAPSHOT)
    expect(record.projectAction?.reliableIdleObservations).toBe(1)
    observation(IDLE_SNAPSHOT)
    expect(record.projectAction).toBeNull()
  })

  it('publishes a verified preview when a later probe classifies the same listener', () => {
    const { inspector, activity, observation } = makeInspectorHarness()
    const { record, runtime, emitEvent } = makeBarrierHarness()
    startTerminalActivityInspection(inspector, runtime)
    activity({ ...IDLE_SNAPSHOT, ports: [5173] })
    portPreviewMocks.forProcessPids.mockReturnValue([
      { host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' },
    ])

    observation({ ...IDLE_SNAPSHOT, ports: [5173] })

    expect(record.activity?.portPreviews).toEqual([
      { host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' },
    ])
    expect(emitEvent).toHaveBeenLastCalledWith(record, {
      type: 'port-previews',
      previews: [{ host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' }],
    })
  })
})
