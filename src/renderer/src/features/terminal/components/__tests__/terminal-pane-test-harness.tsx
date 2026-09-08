import { TERMINAL } from '@shared/constants/resource-limits'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { TerminalEventPayload, TerminalInputIdentity } from '@shared/types/terminal'
import { type RenderResult, render } from '@testing-library/react'
import { type Mock, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { terminalInputDispatcher } from '../../lib/terminal-input-dispatcher'
import { useTerminalStore } from '../../state/terminal-store'
import { TerminalPane } from '../TerminalPane'
import { TerminalPanel } from '../TerminalPanel'
import type { TerminalPaneModel } from '../terminal-pane-model'

export const OWNER = 'draft:/tmp/project-x'
export const TERMINAL_ID = 'term-1'
export const RUNTIME_KEY = `${OWNER}::${TERMINAL_ID}`
const TEST_TERMINAL_WIDTH_PX = 800
const TEST_TERMINAL_HEIGHT_PX = 320

interface TerminalInstanceMock {
  readonly write: Mock
  readonly reset: Mock
  readonly dispose: Mock
  readonly paste: Mock
  readonly getSelection: Mock
  readonly clearSelection: Mock
  readonly modes: {
    bracketedPasteMode: boolean
    mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any'
  }
  readonly cols: number
  readonly rows: number
  readonly options: Record<string, unknown>
}

type SearchAddonMethod = 'clearDecorations' | 'dispose' | 'findNext' | 'findPrevious'
type SearchAddonInstanceMock = Record<SearchAddonMethod, Mock>

interface TerminalPaneMocks {
  readonly terminalInstances: TerminalInstanceMock[]
  readonly searchAddonInstances: SearchAddonInstanceMock[]
  readonly getEventHandler: () => ((payload: TerminalEventPayload) => void) | null
  readonly setEventHandler: (handler: (payload: TerminalEventPayload) => void) => void
  readonly setInputHandler: (handler: (data: string) => void) => void
  readonly setKeyHandler: (handler: (event: KeyboardEvent) => boolean) => void
  readonly setSelectionHandler: (handler: () => void) => void
  readonly emitInput: (data: string) => void
  readonly emitKey: (event: KeyboardEvent) => boolean | undefined
  readonly getSelection: () => string
  readonly setSelection: (value: string) => void
  readonly resetHandlers: () => void
  readonly openTerminal: Mock
  readonly restartTerminal: Mock
  readonly resizeTerminal: Mock
  readonly clearTerminal: Mock
  readonly detachTerminal: Mock
  readonly closeTerminal: Mock
  readonly openExternal: Mock
  readonly openPath: Mock
  readonly openWorkspaceFile: Mock
  readonly copyToClipboard: Mock
  readonly readFromClipboard: Mock
  readonly prepareAttachmentFromText: Mock
  readonly acknowledgeTerminalOutput: Mock
  readonly writeTerminal: Mock
  readonly sendTerminalInputNow: Mock
  readonly assessTerminalClose: Mock
  readonly showConfirm: Mock
}

const mocks: TerminalPaneMocks = vi.hoisted(() => {
  const terminalInstances: TerminalInstanceMock[] = []
  const searchAddonInstances: SearchAddonInstanceMock[] = []
  let eventHandler: ((payload: TerminalEventPayload) => void) | null = null
  let inputHandler: ((data: string) => void) | null = null
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  let selectionHandler: (() => void) | null = null
  let selection = ''
  return {
    terminalInstances,
    searchAddonInstances,
    getEventHandler: () => eventHandler,
    setEventHandler: (handler: (payload: TerminalEventPayload) => void) => {
      eventHandler = handler
    },
    setInputHandler: (handler: (data: string) => void) => {
      inputHandler = handler
    },
    setKeyHandler: (handler: (event: KeyboardEvent) => boolean) => {
      keyHandler = handler
    },
    setSelectionHandler: (handler: () => void) => {
      selectionHandler = handler
    },
    emitInput: (data: string) => inputHandler?.(data),
    emitKey: (event: KeyboardEvent) => keyHandler?.(event),
    getSelection: () => selection,
    setSelection: (value: string) => {
      selection = value
      selectionHandler?.()
    },
    resetHandlers: () => {
      eventHandler = null
      inputHandler = null
      keyHandler = null
      selectionHandler = null
      selection = ''
    },
    openTerminal: vi.fn(),
    restartTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    clearTerminal: vi.fn(),
    detachTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    openExternal: vi.fn(),
    openPath: vi.fn(),
    openWorkspaceFile: vi.fn(),
    copyToClipboard: vi.fn(),
    readFromClipboard: vi.fn(),
    prepareAttachmentFromText: vi.fn(),
    acknowledgeTerminalOutput: vi.fn(),
    writeTerminal: vi.fn(),
    sendTerminalInputNow: vi.fn(),
    assessTerminalClose: vi.fn(),
    showConfirm: vi.fn(),
  }
})

export function getTerminalPaneMocks(): typeof mocks {
  return mocks
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    openTerminal: mocks.openTerminal,
    restartTerminal: mocks.restartTerminal,
    detachTerminal: mocks.detachTerminal,
    closeTerminal: mocks.closeTerminal,
    assessTerminalClose: mocks.assessTerminalClose,
    showConfirm: mocks.showConfirm,
    resizeTerminal: mocks.resizeTerminal,
    clearTerminal: mocks.clearTerminal,
    writeTerminal: mocks.writeTerminal,
    sendTerminalInputNow: mocks.sendTerminalInputNow,
    acknowledgeTerminalOutput: mocks.acknowledgeTerminalOutput,
    migrateTerminalOwner: vi.fn(),
    openExternal: mocks.openExternal,
    openPath: mocks.openPath,
    copyToClipboard: mocks.copyToClipboard,
    readFromClipboard: mocks.readFromClipboard,
    prepareAttachmentFromText: mocks.prepareAttachmentFromText,
    onTerminalEvent: vi.fn((handler: (payload: TerminalEventPayload) => void) => {
      mocks.setEventHandler(handler)
      return () => undefined
    }),
  },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => mocks.openWorkspaceFile,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = TERMINAL.DEFAULT_COLS
    rows = TERMINAL.DEFAULT_ROWS
    options: Record<string, unknown>
    write = vi.fn((_data: string, callback?: () => void) => callback?.())
    reset = vi.fn()
    dispose = vi.fn()
    focus = vi.fn()
    paste = vi.fn()
    modes = { bracketedPasteMode: false, mouseTrackingMode: 'none' as const }
    getSelection = vi.fn(() => mocks.getSelection())
    getSelectionPosition = vi.fn(() => ({ start: { x: 0, y: 2 }, end: { x: 4, y: 3 } }))
    clearSelection = vi.fn()
    buffer = { active: { getLine: vi.fn() } }

    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      mocks.terminalInstances.push(this)
    }

    loadAddon() {}
    registerLinkProvider() {
      return { dispose: () => undefined }
    }
    onData(handler: (data: string) => void) {
      mocks.setInputHandler(handler)
      return { dispose: () => undefined }
    }
    onSelectionChange(handler: () => void) {
      mocks.setSelectionHandler(handler)
      return { dispose: () => undefined }
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      mocks.setKeyHandler(handler)
    }
    open(container: HTMLElement) {
      vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
        DOMRect.fromRect({ width: TEST_TERMINAL_WIDTH_PX, height: TEST_TERMINAL_HEIGHT_PX }),
      )
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
    findPrevious = vi.fn()
    clearDecorations = vi.fn()
    dispose = vi.fn()

    constructor() {
      mocks.searchAddonInstances.push(this)
    }
  },
}))

type RenderPaneOptions = Partial<TerminalPaneModel> & {
  readonly focused?: boolean
  readonly onFocus?: () => void
}

export function renderPane(options: RenderPaneOptions = {}): RenderResult {
  const pane: TerminalPaneModel = {
    ownerKey: options.ownerKey ?? OWNER,
    runtimeOwnerKey: options.runtimeOwnerKey ?? OWNER,
    terminalId: options.terminalId ?? TERMINAL_ID,
    cwd: options.cwd ?? '/tmp/project-x',
    ...(options.launchEnv === undefined ? {} : { launchEnv: options.launchEnv }),
    defaultCwd: options.defaultCwd ?? '/tmp/project-x',
    defaultProvenance: options.defaultProvenance ?? 'draft-checkout',
    label: options.label ?? 'Terminal 1',
  }
  return render(
    <TerminalPane
      pane={pane}
      focused={options.focused ?? true}
      onFocus={options.onFocus ?? (() => undefined)}
      onSearchAddon={() => undefined}
    />,
  )
}

export function renderTerminalPanel(defaultCwd: string | null = '/tmp/project-x'): RenderResult {
  return render(
    <TerminalPanel
      ownerKey={defaultCwd === null ? '' : OWNER}
      defaultCwd={defaultCwd}
      onClose={() => undefined}
    />,
  )
}

export function resetTerminalPaneHarness() {
  vi.clearAllMocks()
  terminalInputDispatcher.clearOwner(OWNER)
  mocks.terminalInstances.length = 0
  mocks.searchAddonInstances.length = 0
  mocks.resetHandlers()
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Linux x86_64' })
  mocks.openTerminal.mockResolvedValue(attachResult())
  mocks.restartTerminal.mockResolvedValue(attachResult())
  mocks.clearTerminal.mockResolvedValue(undefined)
  mocks.detachTerminal.mockResolvedValue(undefined)
  mocks.writeTerminal.mockImplementation(
    async (_owner, _terminalId, data: string, identity: TerminalInputIdentity) => ({
      status: 'written' as const,
      acceptedBytes: new TextEncoder().encode(data).byteLength,
      identity,
    }),
  )
  mocks.sendTerminalInputNow.mockResolvedValue({ status: 'released', releasedBytes: 0 })
  mocks.assessTerminalClose.mockResolvedValue({ disposition: 'safe', reason: 'idle' })
  mocks.showConfirm.mockResolvedValue(true)
  mocks.readFromClipboard.mockResolvedValue('clipboard text')
  mocks.openPath.mockResolvedValue(undefined)
  mocks.openExternal.mockResolvedValue(undefined)
  mocks.prepareAttachmentFromText.mockResolvedValue({
    id: 'terminal-context-1',
    kind: 'text',
    origin: 'auto-paste-text',
    name: 'generated.md',
    path: '/tmp/generated.md',
    mimeType: 'text/markdown',
    sizeBytes: 100,
    extractedText: 'generated',
  })
  useComposerStore.setState({
    input: '',
    attachments: [],
    activeDraftContextKey: 'project:/tmp/project-x',
    lexicalEditor: null,
    cursorIndex: 0,
  })
  useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  useUIStore.getState().clearToast()
  usePreferencesStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: true, loadError: null })
}

function attachResult() {
  return {
    history: '',
    outputBytes: 0,
    outputGeneration: 1,
    readiness: { phase: 'ready' as const, generation: 1 },
    running: true,
  }
}
