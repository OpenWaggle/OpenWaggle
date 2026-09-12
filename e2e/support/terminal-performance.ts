import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

export const TERMINAL_RENDERER_FLOOD_LINES = 200_000
export const TERMINAL_RENDERER_LONG_TASK_BUDGET_MS = 50
export const TERMINAL_PANE_USABLE_BUDGET_MS = 50
export const TERMINAL_READY_KEY_DISPATCH_P95_BUDGET_MS = 16
export const TERMINAL_RESTART_UNDER_FLOOD_BUDGET_MS = 250

const TERMINAL_FLOOD_TIMEOUT_MS = 90_000
const TERMINAL_FLOOD_LINE = '0123456789abcdef'
const TERMINAL_READY_KEY_DISPATCH_SAMPLES = 40
const TERMINAL_READY_KEY = 'j'
const PERFORMANCE_STATE_KEY = '__openwaggleTerminalFloodPerformance'
const PANE_USABLE_STATE_KEY = '__openwaggleTerminalPaneUsablePerformance'
const ACK_PROBE_KEY_PREFIX = '__openwaggleTerminalAckProbe'
const INPUT_DISPATCH_PROBE_KEY_PREFIX = '__openwaggleTerminalInputDispatchProbe'
const INPUT_KEY_PROBE_KEY_PREFIX = '__openwaggleTerminalInputKeyProbe'
const RESTART_PERFORMANCE_STATE_KEY = '__openwaggleTerminalRestartPerformance'
const TERMINAL_RENDERED_INK_BANDS_MIN = 5
const TERMINAL_RENDERED_INK_PIXELS_MIN = 500
const TERMINAL_RESTART_COLS = 120
const TERMINAL_RESTART_ROWS = 30

export type TerminalFloodShell = 'cmd' | 'posix' | 'powershell'

export interface TerminalFloodPerformanceResult {
  readonly elapsedMs: number
  readonly fallbackGeometry: string | null
  readonly fallbackIssues: string | null
  readonly fallbackReason: string | null
  readonly floodLines: number
  readonly corruptLines: number
  readonly longTasks: readonly number[]
  readonly maxLongTaskMs: number
  readonly renderedInkBands: number
  readonly renderedInkPixels: number
  readonly renderer: 'dom' | 'webgl'
}

export interface TerminalPaneUsablePerformanceResult {
  readonly elapsedMs: number
  readonly screenHeight: number
  readonly screenWidth: number
}

export interface TerminalReadyKeyDispatchPerformanceResult {
  readonly p95Ms: number
  readonly samples: readonly number[]
}

export interface TerminalRestartUnderFloodPerformanceResult {
  readonly corruptFloodLines: number
  readonly floodLines: number
  readonly oldOutputGeneration: number
  readonly replacementMarkerCount: number
  readonly replacementOutputGeneration: number
  readonly restartMs: number
  readonly staleFloodLines: number
  readonly staleGenerationEvents: number
  readonly offsetErrors: number
}

interface TerminalFloodCommand {
  readonly command: string
  readonly doneMarker: string
  readonly startMarker: string
}

interface TerminalRestartFloodCommand {
  readonly command: string
  readonly replacementCommand: string
  readonly replacementMarker: string
  readonly startMarker: string
}

function terminalRestartFloodCommand(
  shell: TerminalFloodShell,
  nonce: string,
): TerminalRestartFloodCommand {
  const startBody = `OPENWAGGLE_RESTART_FLOOD_START_${nonce}`
  const replacementBody = `OPENWAGGLE_RESTART_READY_${nonce}`
  const startMarker = `__${startBody}__`
  const replacementMarker = `__${replacementBody}__`
  if (shell === 'powershell') {
    return {
      command: `$u=[char]95; Write-Output ($u+$u+'${startBody}'+$u+$u); while ($true) { Write-Output '${TERMINAL_FLOOD_LINE}' }`,
      replacementCommand: `$u=[char]95; Write-Output ($u+$u+'${replacementBody}'+$u+$u)`,
      replacementMarker,
      startMarker,
    }
  }
  if (shell === 'cmd') {
    return {
      command: `cmd /Q /V:ON /C "set u=_&& echo !u!!u!${startBody}!u!!u!&& for /L %i in (1,1,2147483647) do @echo ${TERMINAL_FLOOD_LINE}"`,
      replacementCommand: `cmd /Q /V:ON /C "set u=_&& echo !u!!u!${replacementBody}!u!!u!"`,
      replacementMarker,
      startMarker,
    }
  }
  const encodedStart = startMarker.replaceAll('_', '\\137')
  const encodedReplacement = replacementMarker.replaceAll('_', '\\137')
  return {
    command: `printf '${encodedStart}\\n'; yes '${TERMINAL_FLOOD_LINE}'`,
    replacementCommand: `printf '${encodedReplacement}\\n'`,
    replacementMarker,
    startMarker,
  }
}

function terminalFloodCommand(shell: TerminalFloodShell, nonce: string): TerminalFloodCommand {
  const startBody = `OPENWAGGLE_RENDERER_FLOOD_START_${nonce}`
  const doneBody = `OPENWAGGLE_RENDERER_FLOOD_DONE_${nonce}`
  const startMarker = `__${startBody}__`
  const doneMarker = `__${doneBody}__`
  if (shell === 'powershell') {
    return {
      command: `$u=[char]95; Write-Output ($u+$u+'${startBody}'+$u+$u); 1..${TERMINAL_RENDERER_FLOOD_LINES} | ForEach-Object { '${TERMINAL_FLOOD_LINE}' }; Write-Output ($u+$u+'${doneBody}'+$u+$u)`,
      doneMarker,
      startMarker,
    }
  }
  if (shell === 'cmd') {
    return {
      command: `cmd /V:ON /C "set u=_&& echo !u!!u!${startBody}!u!!u!&& for /L %i in (1,1,${TERMINAL_RENDERER_FLOOD_LINES}) do @echo ${TERMINAL_FLOOD_LINE}&& echo !u!!u!${doneBody}!u!!u!"`,
      doneMarker,
      startMarker,
    }
  }
  return {
    command: `printf '\\137\\137${startBody}\\137\\137\\n'; yes '${TERMINAL_FLOOD_LINE}' | head -n ${TERMINAL_RENDERER_FLOOD_LINES}; printf '\\137\\137${doneBody}\\137\\137\\n'`,
    doneMarker,
    startMarker,
  }
}

async function armFloodMeasurement(
  page: Page,
  options: {
    readonly doneMarker: string
    readonly ownerKey: string
    readonly startMarker: string
    readonly terminalId: string
  },
) {
  await page.evaluate(
    ({ doneMarker, floodLine, ownerKey, startMarker, stateKey, terminalId }) => {
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        throw new Error('Chromium long-task performance entries are unavailable.')
      }
      const entries: Array<{ startTime: number; duration: number }> = []
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          entries.push({
            startTime: entry.startTime,
            duration: entry.duration,
          })
        }
      })
      observer.observe({ type: 'longtask' })
      const state = {
        corruptLines: 0,
        doneAt: 0,
        doneEndOffset: -1,
        doneOutputGeneration: -1,
        entries,
        floodLines: 0,
        lineBuffer: '',
        observer,
        phase: 'waiting-for-start',
        startedAt: performance.now(),
        unsubscribe: () => undefined,
      }
      state.unsubscribe = window.api.onTerminalEvent((payload) => {
        if (
          payload.ownerKey !== ownerKey ||
          payload.terminalId !== terminalId ||
          payload.event.type !== 'output' ||
          state.phase === 'done'
        ) {
          return
        }
        const lines = `${state.lineBuffer}${payload.event.data}`.split('\n')
        state.lineBuffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
          if (state.phase === 'waiting-for-start') {
            if (line.includes(startMarker)) state.phase = 'flood'
            continue
          }
          if (line.includes(doneMarker)) {
            state.doneAt = performance.now()
            state.doneEndOffset = payload.event.endOffset
            state.doneOutputGeneration = payload.event.outputGeneration
            state.phase = 'done'
            break
          }
          if (line === floodLine) state.floodLines += 1
          else state.corruptLines += 1
        }
      })
      Reflect.set(window, stateKey, state)
    },
    {
      ...options,
      floodLine: TERMINAL_FLOOD_LINE,
      stateKey: PERFORMANCE_STATE_KEY,
    },
  )
}

interface TerminalOutputBoundary {
  readonly endOffset: number
  readonly outputGeneration: number
}

async function readTerminalOutputBoundary(page: Page): Promise<TerminalOutputBoundary> {
  return page.evaluate((stateKey) => {
    const value: unknown = Reflect.get(window, stateKey)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('doneEndOffset' in value) ||
      !('doneOutputGeneration' in value)
    ) {
      throw new Error('Terminal flood completion boundary is unavailable.')
    }
    const endOffset = Number(value.doneEndOffset)
    const outputGeneration = Number(value.doneOutputGeneration)
    if (
      !Number.isSafeInteger(endOffset) ||
      endOffset < 0 ||
      !Number.isSafeInteger(outputGeneration)
    ) {
      throw new Error('Terminal flood completion boundary is invalid.')
    }
    return { endOffset, outputGeneration }
  }, PERFORMANCE_STATE_KEY)
}

async function armTerminalAckProbe(application: ElectronApplication, stateKey: string) {
  await application.evaluate(({ ipcMain }, key) => {
    const acknowledgements: Array<{
      endOffset: number
      outputGeneration: number
      ownerKey: string
      terminalId: string
    }> = []
    const handler = (
      _event: Electron.IpcMainEvent,
      ownerKey: unknown,
      terminalId: unknown,
      outputGeneration: unknown,
      endOffset: unknown,
    ) => {
      if (
        typeof ownerKey === 'string' &&
        typeof terminalId === 'string' &&
        typeof outputGeneration === 'number' &&
        typeof endOffset === 'number'
      ) {
        acknowledgements.push({
          endOffset,
          outputGeneration,
          ownerKey,
          terminalId,
        })
      }
    }
    ipcMain.on('terminal:ack-output', handler)
    Reflect.set(globalThis, key, { acknowledgements, handler })
  }, stateKey)
}

async function terminalOutputWasAcknowledged(
  application: ElectronApplication,
  input: TerminalOutputBoundary & {
    readonly ownerKey: string
    readonly stateKey: string
    readonly terminalId: string
  },
) {
  return application.evaluate((_electron, expected) => {
    const value: unknown = Reflect.get(globalThis, expected.stateKey)
    if (typeof value !== 'object' || value === null || !('acknowledgements' in value)) return false
    const acknowledgements: unknown = value.acknowledgements
    if (!Array.isArray(acknowledgements)) return false
    return acknowledgements.some((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false
      return (
        'ownerKey' in entry &&
        entry.ownerKey === expected.ownerKey &&
        'terminalId' in entry &&
        entry.terminalId === expected.terminalId &&
        'outputGeneration' in entry &&
        entry.outputGeneration === expected.outputGeneration &&
        'endOffset' in entry &&
        Number(entry.endOffset) >= expected.endOffset
      )
    })
  }, input)
}

async function disposeTerminalAckProbe(application: ElectronApplication, stateKey: string) {
  await application
    .evaluate(({ ipcMain }, key) => {
      const value: unknown = Reflect.get(globalThis, key)
      if (typeof value === 'object' && value !== null && 'handler' in value) {
        const handler: unknown = value.handler
        if (typeof handler === 'function') ipcMain.removeListener('terminal:ack-output', handler)
      }
      Reflect.deleteProperty(globalThis, key)
    }, stateKey)
    .catch(() => undefined)
}

interface TerminalInputDispatch {
  readonly data: string
  readonly ownerKey: string
  readonly terminalId: string
  /** Renderer monotonic time sampled after the handler reached node-pty. */
  readonly writtenAt: number
}

/**
 * Wraps Electron's registered invoke handler only inside the launched test
 * process. Electron has no public observer for ipcRenderer.invoke dispatches;
 * the pinned runtime stores them in this map. Unsupported runtimes fail the
 * release gate explicitly instead of silently substituting shell echo latency.
 */
async function armTerminalInputDispatchProbe(application: ElectronApplication, stateKey: string) {
  await application.evaluate(({ ipcMain }, key) => {
    const invokeHandlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
    if (!(invokeHandlers instanceof Map)) {
      throw new Error(
        'Electron does not expose the registered invoke-handler map required by the terminal input dispatch gate.',
      )
    }
    const originalHandler: unknown = invokeHandlers.get('terminal:write')
    if (typeof originalHandler !== 'function') {
      throw new Error('The terminal:write invoke handler is not registered.')
    }
    const dispatches: TerminalInputDispatch[] = []
    const wrappedHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
      const ownerKey = args[0]
      const terminalId = args[1]
      const data = args[2]
      const input =
        typeof ownerKey === 'string' &&
        typeof terminalId === 'string' &&
        typeof data === 'string'
          ? { data, ownerKey, terminalId }
          : null
      const result = Reflect.apply(originalHandler, ipcMain, [event, ...args])
      return Promise.resolve(result).then(async (value: unknown) => {
        if (
          input !== null &&
          typeof value === 'object' &&
          value !== null &&
          'status' in value &&
          value.status === 'written'
        ) {
          dispatches.push({
            ...input,
            // Both endpoints use the renderer's monotonic clock. Independent
            // process wall clocks can drift backwards on hosted macOS. This
            // additional return trip makes the unchanged budget stricter.
            writtenAt: Number(await event.sender.executeJavaScript('performance.now()')),
          })
        }
        return value
      })
    }
    invokeHandlers.set('terminal:write', wrappedHandler)
    Reflect.set(globalThis, key, {
      dispatches,
      invokeHandlers,
      originalHandler,
      wrappedHandler,
    })
  }, stateKey)
}

async function terminalInputDispatches(
  application: ElectronApplication,
  input: {
    readonly data: string
    readonly ownerKey: string
    readonly stateKey: string
    readonly terminalId: string
  },
): Promise<readonly TerminalInputDispatch[]> {
  return application.evaluate((_electron, expected) => {
    const value: unknown = Reflect.get(globalThis, expected.stateKey)
    if (typeof value !== 'object' || value === null || !('dispatches' in value)) return []
    const dispatches: unknown = value.dispatches
    if (!Array.isArray(dispatches)) return []
    return dispatches.flatMap((dispatch: unknown) => {
      if (
        typeof dispatch !== 'object' ||
        dispatch === null ||
        !('data' in dispatch) ||
        dispatch.data !== expected.data ||
        !('writtenAt' in dispatch) ||
        !('ownerKey' in dispatch) ||
        dispatch.ownerKey !== expected.ownerKey ||
        !('terminalId' in dispatch) ||
        dispatch.terminalId !== expected.terminalId
      ) {
        return []
      }
      return [
        {
          data: String(dispatch.data),
          ownerKey: String(dispatch.ownerKey),
          terminalId: String(dispatch.terminalId),
          writtenAt: Number(dispatch.writtenAt),
        },
      ]
    })
  }, input)
}

async function disposeTerminalInputDispatchProbe(
  application: ElectronApplication,
  stateKey: string,
) {
  await application
    .evaluate((_electron, key) => {
      const value: unknown = Reflect.get(globalThis, key)
      if (
        typeof value === 'object' &&
        value !== null &&
        'invokeHandlers' in value &&
        value.invokeHandlers instanceof Map &&
        'originalHandler' in value &&
        'wrappedHandler' in value &&
        value.invokeHandlers.get('terminal:write') === value.wrappedHandler
      ) {
        value.invokeHandlers.set('terminal:write', value.originalHandler)
      }
      Reflect.deleteProperty(globalThis, key)
    }, stateKey)
    .catch(() => undefined)
}

async function armTerminalKeyProbe(page: Page, textarea: Locator, stateKey: string) {
  await textarea.evaluate(
    (element, input) => {
      const keydownTimes: number[] = []
      const handler = (event: KeyboardEvent) => {
        if (event.isTrusted && event.key === input.key && !event.repeat) {
          keydownTimes.push(performance.now())
        }
      }
      element.addEventListener('keydown', handler, { capture: true })
      Reflect.set(window, input.stateKey, { element, handler, keydownTimes })
    },
    { key: TERMINAL_READY_KEY, stateKey },
  )
}

async function terminalKeydownTimes(page: Page, stateKey: string): Promise<readonly number[]> {
  return page.evaluate((key) => {
    const value: unknown = Reflect.get(window, key)
    if (typeof value !== 'object' || value === null || !('keydownTimes' in value)) return []
    const keydownTimes: unknown = value.keydownTimes
    return Array.isArray(keydownTimes) ? keydownTimes.map(Number) : []
  }, stateKey)
}

async function disposeTerminalKeyProbe(page: Page, stateKey: string) {
  await page
    .evaluate((key) => {
      const value: unknown = Reflect.get(window, key)
      if (
        typeof value === 'object' &&
        value !== null &&
        'element' in value &&
        value.element instanceof HTMLElement &&
        'handler' in value &&
        typeof value.handler === 'function'
      ) {
        value.element.removeEventListener('keydown', value.handler as EventListener, {
          capture: true,
        })
      }
      Reflect.deleteProperty(window, key)
    }, stateKey)
    .catch(() => undefined)
}

async function settleTerminalPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

interface TerminalRenderedInk {
  readonly bands: number
  readonly pixels: number
}

async function measureTerminalRenderedInk(page: Page, pane: Locator): Promise<TerminalRenderedInk> {
  const screenshot = await pane.locator('.xterm-screen').screenshot()
  return page.evaluate(
    async (dataUrl) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new Error('Terminal visual gate could not create a 2D context.')
      context.drawImage(image, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
      const colorCounts = new Map<number, number>()
      for (let offset = 0; offset < data.length; offset += 4) {
        const color =
          (data[offset] ?? 0) * 65_536 + (data[offset + 1] ?? 0) * 256 + (data[offset + 2] ?? 0)
        colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
      }
      let background = 0
      let backgroundCount = -1
      for (const [color, count] of colorCounts) {
        if (count <= backgroundCount) continue
        background = color
        backgroundCount = count
      }
      const backgroundRed = Math.floor(background / 65_536)
      const backgroundGreen = Math.floor(background / 256) % 256
      const backgroundBlue = background % 256
      const rowInk = new Uint32Array(height)
      let pixels = 0
      for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset] ?? 0
        const green = data[offset + 1] ?? 0
        const blue = data[offset + 2] ?? 0
        if (
          Math.max(
            Math.abs(red - backgroundRed),
            Math.abs(green - backgroundGreen),
            Math.abs(blue - backgroundBlue),
          ) <= 24
        ) {
          continue
        }
        pixels += 1
        const row = Math.floor(offset / 4 / width)
        rowInk[row] = (rowInk[row] ?? 0) + 1
      }
      let bands = 0
      let insideBand = false
      for (const count of rowInk) {
        if (count >= 4) {
          if (!insideBand) bands += 1
          insideBand = true
        } else {
          insideBand = false
        }
      }
      return { bands, pixels }
    },
    `data:image/png;base64,${screenshot.toString('base64')}`,
  )
}

async function finishLongTaskMeasurement(
  page: Page,
): Promise<
  Pick<
    TerminalFloodPerformanceResult,
    'corruptLines' | 'elapsedMs' | 'floodLines' | 'longTasks' | 'maxLongTaskMs'
  >
> {
  await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
  return page.evaluate((stateKey) => {
    const value: unknown = Reflect.get(window, stateKey)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('entries' in value) ||
      !('observer' in value) ||
      !('startedAt' in value) ||
      !('unsubscribe' in value)
    ) {
      throw new Error('Terminal flood performance measurement was not armed.')
    }
    const rawEntries: unknown = value.entries
    const observer: unknown = value.observer
    const unsubscribe: unknown = value.unsubscribe
    const startedAt = Number(value.startedAt)
    if (
      !Array.isArray(rawEntries) ||
      !(observer instanceof PerformanceObserver) ||
      typeof unsubscribe !== 'function'
    ) {
      throw new Error('Terminal flood long-task observer state is invalid.')
    }
    const entries: unknown[] = rawEntries
    const finishedAt = performance.now()
    for (const entry of observer.takeRecords()) {
      entries.push({ startTime: entry.startTime, duration: entry.duration })
    }
    observer.disconnect()
    unsubscribe()
    Reflect.deleteProperty(window, stateKey)
    const longTasks = entries.flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('startTime' in entry) ||
        !('duration' in entry)
      ) {
        return []
      }
      const startTime = Number(entry.startTime)
      const duration = Number(entry.duration)
      return Number.isFinite(startTime) &&
        Number.isFinite(duration) &&
        startTime >= startedAt &&
        startTime < finishedAt
        ? [duration]
        : []
    })
    return {
      elapsedMs: finishedAt - startedAt,
      floodLines: Number('floodLines' in value ? value.floodLines : Number.NaN),
      corruptLines: Number('corruptLines' in value ? value.corruptLines : Number.NaN),
      longTasks,
      maxLongTaskMs: Math.max(0, ...longTasks),
    }
  }, PERFORMANCE_STATE_KEY)
}

async function abortLongTaskMeasurement(page: Page) {
  await page
    .evaluate((stateKey) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (typeof value === 'object' && value !== null && 'observer' in value) {
        const observer: unknown = value.observer
        if (observer instanceof PerformanceObserver) observer.disconnect()
        if ('unsubscribe' in value) {
          const unsubscribe: unknown = value.unsubscribe
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }
      Reflect.deleteProperty(window, stateKey)
    }, PERFORMANCE_STATE_KEY)
    .catch(() => undefined)
}

/**
 * Measures trusted, focused keydown events through fulfillment of Electron's
 * real terminal:write handler with `written`, then back to the renderer's
 * monotonic clock. The handler resolves only after the synchronous input drain
 * calls node-pty, so this round trip is a conservative key-to-PTY upper bound.
 * It excludes shell echo and PTY output so user
 * startup/configuration cannot skew the 16 ms input gate.
 */
export async function runTerminalReadyKeyDispatchGate(options: {
  readonly application: ElectronApplication
  readonly ownerKey: string
  readonly page: Page
  readonly pane: Locator
}): Promise<TerminalReadyKeyDispatchPerformanceResult> {
  const { application, ownerKey, page, pane } = options
  const textarea = pane.locator('textarea.xterm-helper-textarea')
  await expect(pane).toHaveAttribute('data-readiness', 'ready', {
    timeout: TERMINAL_FLOOD_TIMEOUT_MS,
  })
  await textarea.focus()
  await expect(textarea).toBeFocused()
  const terminalId = await pane.getAttribute('data-terminal-pane')
  if (terminalId === null || terminalId.length === 0) {
    throw new Error('Terminal input dispatch gate requires a mounted terminal id.')
  }

  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const dispatchStateKey = `${INPUT_DISPATCH_PROBE_KEY_PREFIX}_${nonce}`
  const keyStateKey = `${INPUT_KEY_PROBE_KEY_PREFIX}_${nonce}`
  await armTerminalInputDispatchProbe(application, dispatchStateKey)
  try {
    await armTerminalKeyProbe(page, textarea, keyStateKey)
    for (let index = 0; index < TERMINAL_READY_KEY_DISPATCH_SAMPLES; index += 1) {
      await page.keyboard.press(TERMINAL_READY_KEY)
      await expect
        .poll(
          async () =>
            (
              await terminalInputDispatches(application, {
                data: TERMINAL_READY_KEY,
                ownerKey,
                stateKey: dispatchStateKey,
                terminalId,
              })
            ).length,
          {
            message: `focused terminal key ${index + 1} should dispatch to the PTY`,
            timeout: 5_000,
          },
        )
        .toBe(index + 1)
    }

    const [keydownTimes, dispatches] = await Promise.all([
      terminalKeydownTimes(page, keyStateKey),
      terminalInputDispatches(application, {
        data: TERMINAL_READY_KEY,
        ownerKey,
        stateKey: dispatchStateKey,
        terminalId,
      }),
    ])
    if (
      keydownTimes.length !== TERMINAL_READY_KEY_DISPATCH_SAMPLES ||
      dispatches.length !== TERMINAL_READY_KEY_DISPATCH_SAMPLES
    ) {
      throw new Error(
        `Terminal input dispatch measurement is incomplete: ${keydownTimes.length} key events and ${dispatches.length} dispatches.`,
      )
    }
    const samples = keydownTimes.map(
      (keydownAt, index) => (dispatches[index]?.writtenAt ?? Number.NaN) - keydownAt,
    )
    if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
      throw new Error(
        'Terminal input dispatch timestamps were not ordered on the renderer monotonic clock.',
      )
    }
    const ordered = [...samples].sort((left, right) => left - right)
    const p95Index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1)
    const p95Ms = ordered[p95Index] ?? Number.POSITIVE_INFINITY
    if (p95Ms > TERMINAL_READY_KEY_DISPATCH_P95_BUDGET_MS) {
      throw new Error(
        `Terminal ready-key dispatch p95 was ${p95Ms.toFixed(1)}ms (budget ${TERMINAL_READY_KEY_DISPATCH_P95_BUDGET_MS}ms).`,
      )
    }
    return { p95Ms, samples }
  } finally {
    await page.keyboard.press('Control+C').catch(() => undefined)
    await Promise.all([
      disposeTerminalKeyProbe(page, keyStateKey),
      disposeTerminalInputDispatchProbe(application, dispatchStateKey),
    ])
  }
}

/**
 * Measures the strict click-to-usable upper bound for a new xterm pane. Two
 * consecutive animation frames must report the same positive screen geometry
 * and an enabled helper textarea. Shell startup and prompt readiness are not
 * part of this renderer measurement.
 */
export async function runTerminalPaneUsableGate(options: {
  readonly page: Page
  readonly trigger: Locator
}): Promise<TerminalPaneUsablePerformanceResult> {
  const { page, trigger } = options
  await trigger.evaluate((element, stateKey) => {
    const existingPaneIds = new Set(
      Array.from(document.querySelectorAll('[data-terminal-pane]'), (pane) =>
        pane.getAttribute('data-terminal-pane'),
      ),
    )
    const state = {
      completedAt: 0,
      elapsedMs: 0,
      frameId: 0,
      frameCount: 0,
      firstPaneMs: -1,
      firstScreenMs: -1,
      maxFrameGapMs: 0,
      lastFrameAt: 0,
      previousHeight: 0,
      previousWidth: 0,
      screenHeight: 0,
      screenWidth: 0,
      startedAt: 0,
      status: 'armed',
    }
    const sample = () => {
      const now = performance.now()
      state.frameCount += 1
      state.maxFrameGapMs = Math.max(state.maxFrameGapMs, now - state.lastFrameAt)
      state.lastFrameAt = now
      const pane = Array.from(document.querySelectorAll('[data-terminal-pane]')).find(
        (candidate) => !existingPaneIds.has(candidate.getAttribute('data-terminal-pane')),
      )
      const screen = pane?.querySelector('.xterm-screen')
      const textarea = pane?.querySelector('textarea.xterm-helper-textarea')
      if (pane && state.firstPaneMs < 0) state.firstPaneMs = now - state.startedAt
      if (screen && state.firstScreenMs < 0) state.firstScreenMs = now - state.startedAt
      if (screen instanceof HTMLElement && textarea instanceof HTMLTextAreaElement) {
        const bounds = screen.getBoundingClientRect()
        const stable =
          bounds.width > 0 &&
          bounds.height > 0 &&
          Math.abs(bounds.width - state.previousWidth) <= 0.5 &&
          Math.abs(bounds.height - state.previousHeight) <= 0.5
        state.previousWidth = bounds.width
        state.previousHeight = bounds.height
        if (stable && !textarea.disabled) {
          state.completedAt = performance.now()
          state.elapsedMs = state.completedAt - state.startedAt
          state.screenHeight = bounds.height
          state.screenWidth = bounds.width
          state.status = 'complete'
          return
        }
      }
      state.frameId = requestAnimationFrame(sample)
    }
    element.addEventListener(
      'click',
      () => {
        state.startedAt = performance.now()
        state.lastFrameAt = state.startedAt
        state.status = 'measuring'
        state.frameId = requestAnimationFrame(sample)
      },
      { capture: true, once: true },
    )
    Reflect.set(window, stateKey, state)
  }, PANE_USABLE_STATE_KEY)

  try {
    await trigger.click()
    await page.waitForFunction(
      (stateKey) => {
        const value: unknown = Reflect.get(window, stateKey)
        return (
          typeof value === 'object' &&
          value !== null &&
          'status' in value &&
          value.status === 'complete'
        )
      },
      PANE_USABLE_STATE_KEY,
      { timeout: 10_000 },
    )
    const result = await page.evaluate((stateKey) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('elapsedMs' in value) ||
        !('screenHeight' in value) ||
        !('screenWidth' in value)
      ) {
        throw new Error('Terminal pane usability measurement is invalid.')
      }
      return {
        elapsedMs: Number(value.elapsedMs),
        screenHeight: Number(value.screenHeight),
        screenWidth: Number(value.screenWidth),
      }
    }, PANE_USABLE_STATE_KEY)
    if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) {
      throw new Error('Terminal pane usability measurement did not produce a finite duration.')
    }
    if (result.elapsedMs > TERMINAL_PANE_USABLE_BUDGET_MS) {
      const diagnostics = await page.evaluate((stateKey) => {
        const screen = document.querySelector('.xterm-screen')
        return {
          measurement: Reflect.get(window, stateKey),
          visibility: document.visibilityState,
          fonts: document.fonts.status,
          fontFamily: screen instanceof HTMLElement ? getComputedStyle(screen).fontFamily : null,
        }
      }, PANE_USABLE_STATE_KEY)
      throw new Error(
        `Terminal pane took ${result.elapsedMs.toFixed(1)}ms to become usable (budget ${TERMINAL_PANE_USABLE_BUDGET_MS}ms). ` +
          `Diagnostics: ${JSON.stringify(diagnostics)}`,
      )
    }
    return result
  } finally {
    await page
      .evaluate((stateKey) => {
        const value: unknown = Reflect.get(window, stateKey)
        if (typeof value === 'object' && value !== null && 'frameId' in value) {
          cancelAnimationFrame(Number(value.frameId))
        }
        Reflect.deleteProperty(window, stateKey)
      }, PANE_USABLE_STATE_KEY)
      .catch(() => undefined)
  }
}

/**
 * Real-renderer gate for the 200k-line terminal flood budget. Completion and
 * integrity are observed at the real preload event boundary, so this measures
 * whichever renderer the pane actually selected (guarded WebGL or DOM).
 */
export async function runTerminalRendererFloodGate(options: {
  readonly application: ElectronApplication
  readonly ownerKey: string
  readonly page: Page
  readonly pane: Locator
  readonly shell: TerminalFloodShell
}): Promise<TerminalFloodPerformanceResult> {
  const { page, pane } = options
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const flood = terminalFloodCommand(options.shell, nonce)
  const textarea = pane.locator('textarea.xterm-helper-textarea')
  await expect(pane).toHaveAttribute('data-readiness', 'ready', {
    timeout: TERMINAL_FLOOD_TIMEOUT_MS,
  })
  await textarea.focus()
  const terminalId = await pane.getAttribute('data-terminal-pane')
  if (terminalId === null || terminalId.length === 0) {
    throw new Error('Terminal renderer flood gate requires a mounted terminal id.')
  }
  const ackProbeKey = `${ACK_PROBE_KEY_PREFIX}_${nonce}`
  await armTerminalAckProbe(options.application, ackProbeKey)
  try {
    await armFloodMeasurement(page, {
      doneMarker: flood.doneMarker,
      ownerKey: options.ownerKey,
      startMarker: flood.startMarker,
      terminalId,
    })
    await page.keyboard.insertText(flood.command)
    await page.keyboard.press('Enter')
    await expect
      .poll(
        () =>
          page.evaluate((stateKey) => {
            const value: unknown = Reflect.get(window, stateKey)
            return (
              typeof value === 'object' &&
              value !== null &&
              'phase' in value &&
              value.phase === 'done'
            )
          }, PERFORMANCE_STATE_KEY),
        {
          message: `terminal should dispatch the completion marker after ${TERMINAL_RENDERER_FLOOD_LINES} lines`,
          timeout: TERMINAL_FLOOD_TIMEOUT_MS,
        },
      )
      .toBe(true)
    const boundary = await readTerminalOutputBoundary(page)
    await expect
      .poll(
        () =>
          terminalOutputWasAcknowledged(options.application, {
            ...boundary,
            ownerKey: options.ownerKey,
            stateKey: ackProbeKey,
            terminalId,
          }),
        {
          message: 'xterm should parse and acknowledge the flood completion event',
          timeout: TERMINAL_FLOOD_TIMEOUT_MS,
        },
      )
      .toBe(true)
    await settleTerminalPaint(page)
    const result = await finishLongTaskMeasurement(page)
    // WebGL publishes diagnostics on xterm's root element. The production DOM
    // renderer deliberately has no activator, so the same element exists
    // without those optional attributes.
    const rendererElement = pane.locator('.xterm').first()
    const rendererAttribute = await rendererElement.getAttribute('data-terminal-renderer')
    const renderer = rendererAttribute === 'webgl' ? 'webgl' : 'dom'
    const fallbackGeometry = await rendererElement.getAttribute('data-terminal-renderer-geometry')
    const fallbackIssues = await rendererElement.getAttribute('data-terminal-renderer-issues')
    const fallbackReason = await rendererElement.getAttribute('data-terminal-renderer-reason')
    if (result.floodLines !== TERMINAL_RENDERER_FLOOD_LINES || result.corruptLines !== 0) {
      throw new Error(
        `Terminal flood integrity failed: received ${result.floodLines}/${TERMINAL_RENDERER_FLOOD_LINES} lines with ${result.corruptLines} corrupt lines.`,
      )
    }
    if (result.maxLongTaskMs > TERMINAL_RENDERER_LONG_TASK_BUDGET_MS) {
      throw new Error(
        `Terminal renderer produced a ${result.maxLongTaskMs.toFixed(1)}ms long task during the ${TERMINAL_RENDERER_FLOOD_LINES}-line flood (budget ${TERMINAL_RENDERER_LONG_TASK_BUDGET_MS}ms).`,
      )
    }
    let renderedInk: TerminalRenderedInk = { bands: 0, pixels: 0 }
    await expect
      .poll(
        async () => {
          renderedInk = await measureTerminalRenderedInk(page, pane)
          return renderedInk.bands >= TERMINAL_RENDERED_INK_BANDS_MIN &&
            renderedInk.pixels >= TERMINAL_RENDERED_INK_PIXELS_MIN
            ? 'painted'
            : 'blank'
        },
        {
          message: 'terminal should visibly paint the completed flood viewport',
          timeout: 5_000,
        },
      )
      .toBe('painted')
    return {
      ...result,
      fallbackGeometry,
      fallbackIssues,
      fallbackReason,
      renderedInkBands: renderedInk.bands,
      renderedInkPixels: renderedInk.pixels,
      renderer,
    }
  } catch (error) {
    await abortLongTaskMeasurement(page)
    throw error
  } finally {
    await disposeTerminalAckProbe(options.application, ackProbeKey)
  }
}

async function armRestartFloodMeasurement(
  page: Page,
  options: {
    readonly ownerKey: string
    readonly startMarker: string
    readonly terminalId: string
  },
) {
  await page.evaluate(
    ({ floodLine, ownerKey, startMarker, stateKey, terminalId }) => {
      const postRestartOutputs: Array<{
        data: string
        endOffset: number
        outputGeneration: number
        startOffset: number
      }> = []
      const state = {
        corruptFloodLines: 0,
        floodLines: 0,
        lineBuffer: '',
        oldOutputGeneration: -1,
        phase: 'waiting-for-start',
        postRestartOutputs,
        replacementGeneration: -1,
        replacementReadinessGeneration: -1,
        restartCompletedEventIndex: -1,
        restartInvoked: false,
        readinessGeneration: -1,
        readinessPhase: '',
        unsubscribe: () => undefined,
      }
      state.unsubscribe = window.api.onTerminalEvent((payload) => {
        if (payload.ownerKey !== ownerKey || payload.terminalId !== terminalId) return
        const { event } = payload
        if (event.type === 'readiness') {
          if (state.restartInvoked) {
            state.readinessGeneration = event.readiness.generation
            state.readinessPhase = event.readiness.phase
          }
          return
        }
        if (event.type !== 'output') return
        if (state.restartInvoked) {
          state.postRestartOutputs.push({
            data: event.data,
            endOffset: event.endOffset,
            outputGeneration: event.outputGeneration,
            startOffset: event.startOffset,
          })
          return
        }

        state.oldOutputGeneration = event.outputGeneration
        const lines = `${state.lineBuffer}${event.data}`.split('\n')
        state.lineBuffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
          if (state.phase === 'waiting-for-start') {
            if (line.includes(startMarker)) state.phase = 'flood'
            continue
          }
          if (line === floodLine) state.floodLines += 1
          else state.corruptFloodLines += 1
        }
      })
      Reflect.set(window, stateKey, state)
    },
    {
      ...options,
      floodLine: TERMINAL_FLOOD_LINE,
      stateKey: RESTART_PERFORMANCE_STATE_KEY,
    },
  )
}

async function readRestartFloodMeasurement(page: Page) {
  return page.evaluate((stateKey) => {
    const value: unknown = Reflect.get(window, stateKey)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('corruptFloodLines' in value) ||
      !('floodLines' in value) ||
      !('oldOutputGeneration' in value) ||
      !('phase' in value)
    ) {
      throw new Error('Terminal restart flood measurement was not armed.')
    }
    return {
      corruptFloodLines: Number(value.corruptFloodLines),
      floodLines: Number(value.floodLines),
      oldOutputGeneration: Number(value.oldOutputGeneration),
      phase: String(value.phase),
    }
  }, RESTART_PERFORMANCE_STATE_KEY)
}

async function invokeRestartUnderFlood(
  page: Page,
  input: {
    readonly cwd: string
    readonly ownerKey: string
    readonly terminalId: string
  },
) {
  return page.evaluate(
    async ({ cols, input, rows, stateKey }) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('postRestartOutputs' in value) ||
        !Array.isArray(value.postRestartOutputs)
      ) {
        throw new Error('Terminal restart flood measurement was not armed.')
      }
      Reflect.set(value, 'restartInvoked', true)
      Reflect.set(value, 'phase', 'restarting')
      const startedAt = performance.now()
      const snapshot = await window.api.restartTerminal({
        ownerKey: input.ownerKey,
        terminalId: input.terminalId,
        cwd: input.cwd,
        cols,
        rows,
      })
      const restartMs = performance.now() - startedAt
      Reflect.set(value, 'restartCompletedEventIndex', value.postRestartOutputs.length)
      Reflect.set(value, 'replacementGeneration', snapshot.outputGeneration)
      Reflect.set(value, 'replacementReadinessGeneration', snapshot.readiness?.generation ?? -1)
      return { restartMs, snapshot }
    },
    {
      cols: TERMINAL_RESTART_COLS,
      input,
      rows: TERMINAL_RESTART_ROWS,
      stateKey: RESTART_PERFORMANCE_STATE_KEY,
    },
  )
}

async function replacementShellAttached(page: Page) {
  return page.evaluate((stateKey) => {
    const value: unknown = Reflect.get(window, stateKey)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('readinessGeneration' in value) ||
      !('readinessPhase' in value) ||
      !('replacementReadinessGeneration' in value)
    ) {
      return false
    }
    return (
      Number(value.readinessGeneration) === Number(value.replacementReadinessGeneration) &&
      (value.readinessPhase === 'awaiting-prompt' || value.readinessPhase === 'ready')
    )
  }, RESTART_PERFORMANCE_STATE_KEY)
}

async function replacementMarkerReceived(page: Page, replacementMarker: string) {
  return page.evaluate(
    ({ marker, stateKey }) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('postRestartOutputs' in value) ||
        !Array.isArray(value.postRestartOutputs) ||
        !('replacementGeneration' in value)
      ) {
        return false
      }
      const generation = Number(value.replacementGeneration)
      return value.postRestartOutputs
        .flatMap((event: unknown) => {
          if (
            typeof event !== 'object' ||
            event === null ||
            !('outputGeneration' in event) ||
            Number(event.outputGeneration) !== generation ||
            !('data' in event)
          ) {
            return []
          }
          return [String(event.data)]
        })
        .join('')
        .includes(marker)
    },
    { marker: replacementMarker, stateKey: RESTART_PERFORMANCE_STATE_KEY },
  )
}

async function finishRestartFloodMeasurement(
  page: Page,
  replacementMarker: string,
): Promise<Omit<TerminalRestartUnderFloodPerformanceResult, 'restartMs'>> {
  return page.evaluate(
    ({ floodLine, marker, stateKey }) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('corruptFloodLines' in value) ||
        !('floodLines' in value) ||
        !('oldOutputGeneration' in value) ||
        !('postRestartOutputs' in value) ||
        !Array.isArray(value.postRestartOutputs) ||
        !('replacementGeneration' in value) ||
        !('restartCompletedEventIndex' in value) ||
        !('unsubscribe' in value) ||
        typeof value.unsubscribe !== 'function'
      ) {
        throw new Error('Terminal restart flood measurement is invalid.')
      }
      value.unsubscribe()
      const replacementOutputGeneration = Number(value.replacementGeneration)
      const restartCompletedEventIndex = Number(value.restartCompletedEventIndex)
      const outputs = value.postRestartOutputs.flatMap((event: unknown) => {
        if (
          typeof event !== 'object' ||
          event === null ||
          !('data' in event) ||
          !('endOffset' in event) ||
          !('outputGeneration' in event) ||
          !('startOffset' in event)
        ) {
          return []
        }
        return [
          {
            data: String(event.data),
            endOffset: Number(event.endOffset),
            outputGeneration: Number(event.outputGeneration),
            startOffset: Number(event.startOffset),
          },
        ]
      })
      const firstReplacementIndex = outputs.findIndex(
        (event) => event.outputGeneration === replacementOutputGeneration,
      )
      const staleGenerationEvents = outputs.filter(
        (event, index) =>
          event.outputGeneration !== replacementOutputGeneration &&
          (firstReplacementIndex < 0 ||
            index >= firstReplacementIndex ||
            index >= restartCompletedEventIndex),
      ).length
      const replacementOutputs = outputs.filter(
        (event) => event.outputGeneration === replacementOutputGeneration,
      )
      let expectedStartOffset = 0
      let offsetErrors = 0
      const encoder = new TextEncoder()
      for (const event of replacementOutputs) {
        if (event.startOffset !== expectedStartOffset) offsetErrors += 1
        if (event.endOffset - event.startOffset !== encoder.encode(event.data).byteLength) {
          offsetErrors += 1
        }
        expectedStartOffset = event.endOffset
      }
      const replacementOutput = replacementOutputs.map((event) => event.data).join('')
      let replacementMarkerCount = 0
      let markerOffset = 0
      while (true) {
        const found = replacementOutput.indexOf(marker, markerOffset)
        if (found < 0) break
        replacementMarkerCount += 1
        markerOffset = found + marker.length
      }
      const staleFloodLines = replacementOutput
        .replaceAll('\r\n', '\n')
        .split('\n')
        .filter((line) => line === floodLine).length
      Reflect.deleteProperty(window, stateKey)
      return {
        corruptFloodLines: Number(value.corruptFloodLines),
        floodLines: Number(value.floodLines),
        oldOutputGeneration: Number(value.oldOutputGeneration),
        replacementMarkerCount,
        replacementOutputGeneration,
        staleFloodLines,
        staleGenerationEvents,
        offsetErrors,
      }
    },
    {
      floodLine: TERMINAL_FLOOD_LINE,
      marker: replacementMarker,
      stateKey: RESTART_PERFORMANCE_STATE_KEY,
    },
  )
}

async function abortRestartFloodMeasurement(page: Page) {
  await page
    .evaluate((stateKey) => {
      const value: unknown = Reflect.get(window, stateKey)
      if (typeof value === 'object' && value !== null && 'unsubscribe' in value) {
        const unsubscribe: unknown = value.unsubscribe
        if (typeof unsubscribe === 'function') unsubscribe()
      }
      Reflect.deleteProperty(window, stateKey)
    }, RESTART_PERFORMANCE_STATE_KEY)
    .catch(() => undefined)
}

/**
 * Restarts the real PTY through preload while a renderer-acknowledged flood is
 * still active. The IPC round trip has a 250 ms budget; generation ordering,
 * byte offsets, and a unique command marker prove the replacement shell is
 * clean and usable rather than merely scheduled.
 */
export async function runTerminalRestartUnderFloodGate(options: {
  readonly cwd: string
  readonly ownerKey: string
  readonly page: Page
  readonly pane: Locator
  readonly shell: TerminalFloodShell
}): Promise<TerminalRestartUnderFloodPerformanceResult> {
  const { page, pane } = options
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const flood = terminalRestartFloodCommand(options.shell, nonce)
  const textarea = pane.locator('textarea.xterm-helper-textarea')
  await expect(pane).toHaveAttribute('data-readiness', 'ready', {
    timeout: TERMINAL_FLOOD_TIMEOUT_MS,
  })
  await textarea.focus()
  const terminalId = await pane.getAttribute('data-terminal-pane')
  if (terminalId === null || terminalId.length === 0) {
    throw new Error('Terminal restart flood gate requires a mounted terminal id.')
  }

  await armRestartFloodMeasurement(page, {
    ownerKey: options.ownerKey,
    startMarker: flood.startMarker,
    terminalId,
  })
  try {
    await page.keyboard.insertText(flood.command)
    await page.keyboard.press('Enter')
    await expect
      .poll(
        async () => {
          const state = await readRestartFloodMeasurement(page)
          return state.phase === 'flood' && state.floodLines >= TERMINAL_RENDERER_FLOOD_LINES
        },
        {
          message: `terminal should stay active through ${TERMINAL_RENDERER_FLOOD_LINES} flood lines before restart`,
          timeout: TERMINAL_FLOOD_TIMEOUT_MS,
        },
      )
      .toBe(true)

    const beforeRestart = await readRestartFloodMeasurement(page)
    if (beforeRestart.corruptFloodLines !== 0) {
      throw new Error(
        `Terminal active flood contained ${beforeRestart.corruptFloodLines} corrupt lines before restart.`,
      )
    }
    const restart = await invokeRestartUnderFlood(page, {
      cwd: options.cwd,
      ownerKey: options.ownerKey,
      terminalId,
    })
    if (restart.restartMs > TERMINAL_RESTART_UNDER_FLOOD_BUDGET_MS) {
      throw new Error(
        `Terminal restart under flood took ${restart.restartMs.toFixed(1)}ms (budget ${TERMINAL_RESTART_UNDER_FLOOD_BUDGET_MS}ms).`,
      )
    }
    if (!restart.snapshot.running || restart.snapshot.outputBytes !== 0) {
      throw new Error('Terminal restart did not return a clean running replacement snapshot.')
    }
    if (restart.snapshot.history.length !== 0) {
      throw new Error('Terminal restart replayed stale flood history into the replacement shell.')
    }
    if (restart.snapshot.outputGeneration <= beforeRestart.oldOutputGeneration) {
      throw new Error(
        `Terminal restart kept stale output generation ${beforeRestart.oldOutputGeneration}.`,
      )
    }
    await expect
      .poll(() => replacementShellAttached(page), {
        message: 'replacement shell should attach after restart',
        timeout: TERMINAL_FLOOD_TIMEOUT_MS,
      })
      .toBe(true)
    const inputResults = await page.evaluate(
      async ({ command, ownerKey, terminalId }) => {
        const release = await window.api.sendTerminalInputNow(ownerKey, terminalId)
        // This writes PTY input, not a text file. Enter sends CR on every
        // platform; Windows console line input does not submit on LF.
        const write = await window.api.writeTerminal(ownerKey, terminalId, `${command}\r`)
        return { release, write }
      },
      {
        command: flood.replacementCommand,
        ownerKey: options.ownerKey,
        terminalId,
      },
    )
    if (inputResults.release.status === 'terminal-not-open') {
      throw new Error('Replacement shell was not open for immediate input.')
    }
    if (inputResults.write.status === 'rejected') {
      throw new Error(`Replacement shell rejected its usability command (${inputResults.write.reason}).`)
    }
    await expect
      .poll(() => replacementMarkerReceived(page, flood.replacementMarker), {
        message: 'replacement shell should execute its unique usability marker',
        timeout: TERMINAL_FLOOD_TIMEOUT_MS,
      })
      .toBe(true)

    const measurement = await finishRestartFloodMeasurement(page, flood.replacementMarker)
    if (measurement.replacementMarkerCount !== 1) {
      throw new Error(
        `Replacement usability marker appeared ${measurement.replacementMarkerCount} times instead of once.`,
      )
    }
    if (measurement.staleGenerationEvents !== 0) {
      throw new Error(
        `${measurement.staleGenerationEvents} stale-generation output events crossed the replacement boundary.`,
      )
    }
    if (measurement.staleFloodLines !== 0) {
      throw new Error(
        `${measurement.staleFloodLines} stale flood lines contaminated replacement output.`,
      )
    }
    if (measurement.offsetErrors !== 0) {
      throw new Error(
        `Replacement output contained ${measurement.offsetErrors} duplicate or discontinuous offsets.`,
      )
    }
    return { ...measurement, restartMs: restart.restartMs }
  } finally {
    await abortRestartFloodMeasurement(page)
  }
}
