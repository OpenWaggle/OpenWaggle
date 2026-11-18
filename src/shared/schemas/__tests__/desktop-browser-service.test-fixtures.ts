import { SessionId } from '@shared/types/brand'
import type {
  DesktopBrowserInputMap,
  DesktopBrowserValueMap,
} from '@shared/types/desktop-browser-service'

export const scope = { sessionId: SessionId('worker-1'), workingPath: '/project/worker' }
export const inputs = {
  status: {},
  open: { url: 'https://example.com', reuseExistingTab: true },
  navigate: {
    target: { kind: 'environment-port', port: 3000, path: '/preview' },
    readiness: 'domContentLoaded',
    timeoutMs: 5000,
  },
  resize: { mode: 'freeform', width: 800, height: 600 },
  setAppearance: { colorScheme: 'dark' },
  snapshot: { tabId: 'preview-1' },
  click: { x: 20, y: 40 },
  type: { text: 'hello', locator: 'role=textbox', clear: true },
  press: { key: 'Enter', modifiers: ['Control'] },
  scroll: { deltaY: 120 },
  evaluate: { expression: '({ count: 1 })', awaitPromise: true },
  waitFor: { selector: 'button', timeoutMs: 1000 },
  startRecording: {},
  stopRecording: {},
} satisfies DesktopBrowserInputMap
export const status = {
  available: true,
  visible: false,
  tabId: 'preview-1',
  url: 'https://example.com',
  title: 'Example',
  loading: false,
  viewport: { mode: 'fill' as const },
  appearance: 'dark' as const,
}
export const snapshot = {
  url: 'https://example.com',
  title: 'Example',
  loading: false,
  visibleText: 'Hello',
  interactiveElements: [
    {
      tag: 'button',
      role: 'button',
      name: 'Send',
      selector: '#send',
      x: 1,
      y: 2,
      width: 10,
      height: 10,
    },
  ],
  accessibilityTree: { nodes: [] },
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: { mimeType: 'image/png' as const, data: 'AA==', width: 1, height: 1 },
}
export const values = {
  status,
  open: status,
  navigate: status,
  resize: { tabId: 'preview-1', viewport: { mode: 'fill' } },
  setAppearance: { tabId: 'preview-1', colorScheme: 'dark' },
  snapshot,
  click: null,
  type: null,
  press: null,
  scroll: null,
  evaluate: { count: 1 },
  waitFor: null,
  startRecording: { tabId: 'preview-1', recording: true, startedAt: '2026-09-12T10:00:00Z' },
  stopRecording: {
    id: 'recording-1',
    tabId: 'preview-1',
    path: '/artifacts/recording.webm',
    mimeType: 'video/webm',
    sizeBytes: 42,
    createdAt: '2026-09-12T10:00:00Z',
  },
} satisfies DesktopBrowserValueMap
