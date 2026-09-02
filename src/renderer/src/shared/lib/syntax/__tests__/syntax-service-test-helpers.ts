import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import type { SyntaxWorkerRequest, SyntaxWorkerSuccessMessage } from '../protocol'

export class MockWorker {
  static instances: MockWorker[] = []

  readonly messages: SyntaxWorkerRequest[] = []
  readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>()
  readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  terminated = false

  constructor() {
    MockWorker.instances.push(this)
  }

  postMessage(message: SyntaxWorkerRequest) {
    this.messages.push(message)
  }

  addEventListener(type: string, listener: (event: MessageEvent<unknown> | ErrorEvent) => void) {
    if (type === 'message') {
      this.messageListeners.add(listener)
      return
    }
    if (type === 'error') this.errorListeners.add(listener)
  }

  emitMessage(message: unknown) {
    const event = new MessageEvent('message', { data: message })
    for (const listener of this.messageListeners) listener(event)
  }

  terminate() {
    this.terminated = true
  }
}

export const IMPORTED_LANGUAGE = {
  id: 'language:test:project',
  packageId: 'test.project',
  revision: 'revision-1',
  label: 'Test Language',
  languageId: 'test-language',
  scope: 'project',
  format: 'openwaggle',
  sourcePath: '/project/.openwaggle/syntax.json',
  engine: 'javascript',
  registration: {
    name: 'test-language',
    displayName: 'Test Language',
    scopeName: 'source.test',
    aliases: ['test'],
    fileExtensions: ['.test'],
    fileNames: [],
    embeddedLanguages: {},
    injectTo: [],
    grammar: { name: 'test-language', scopeName: 'source.test', patterns: [], repository: {} },
  },
  original: {},
} satisfies SyntaxLanguageResource

export function highlightedResponse(requestId: number): SyntaxWorkerSuccessMessage {
  return {
    type: 'highlighted',
    requestId,
    result: {
      status: 'highlighted',
      language: 'typescript',
      theme: 'dark-plus',
      lines: [[{ content: 'const', color: 'var(--color-text-primary)' }]],
      elapsedMs: 1,
    },
  }
}

export function highlightMessages(worker: MockWorker) {
  return worker.messages.filter((message) => message.type === 'highlight')
}
