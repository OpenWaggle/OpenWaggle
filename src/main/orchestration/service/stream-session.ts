import type { StreamChunk } from '@tanstack/ai'

interface StreamSessionOptions {
  readonly runId: string
  readonly threadId: string
  readonly messageId: string
  readonly emitChunk: (chunk: StreamChunk) => void
  readonly now: () => number
  readonly sleep: (delayMs: number) => Promise<void>
  readonly chunkSize: number
  readonly chunkDelayMs: number
}

type MessageState = 'idle' | 'open' | 'closed'

export class StreamSession {
  private readonly runId: string
  private readonly threadId: string
  private readonly messageId: string
  private readonly emitChunk: (chunk: StreamChunk) => void
  private readonly now: () => number
  private readonly sleep: (delayMs: number) => Promise<void>
  private readonly chunkSize: number
  private readonly chunkDelayMs: number

  private runStarted = false
  private runFinished = false
  private terminal = false
  private messageState: MessageState = 'idle'
  private fullText = ''

  constructor(options: StreamSessionOptions) {
    if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
      throw new Error('StreamSession chunkSize must be a positive integer')
    }
    if (!Number.isFinite(options.chunkDelayMs) || options.chunkDelayMs < 0) {
      throw new Error('StreamSession chunkDelayMs must be a non-negative number')
    }

    this.runId = options.runId
    this.threadId = options.threadId
    this.messageId = options.messageId
    this.emitChunk = options.emitChunk
    this.now = options.now
    this.sleep = options.sleep
    this.chunkSize = options.chunkSize
    this.chunkDelayMs = options.chunkDelayMs
  }

  get text(): string {
    return this.fullText
  }

  get messageStarted(): boolean {
    return this.messageState !== 'idle'
  }

  startRun(): void {
    if (this.runStarted || this.runFinished) return
    this.runStarted = true
    this.emitChunk({
      type: 'RUN_STARTED',
      timestamp: this.now(),
      runId: this.runId,
      threadId: this.threadId,
    })
  }

  appendText(delta: string): void {
    if (this.terminal || delta.length === 0) return
    this.ensureMessageStarted()
    if (this.messageState !== 'open') return
    this.fullText += delta
    this.emitChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: this.now(),
      messageId: this.messageId,
      delta,
    })
  }

  async streamText(text: string): Promise<void> {
    if (this.terminal || text.length === 0) return
    this.ensureMessageStarted()
    if (this.messageState !== 'open') return

    this.fullText += text
    for (let index = 0; index < text.length; index += this.chunkSize) {
      if (this.terminal || this.messageState !== 'open') {
        return
      }
      const delta = text.slice(index, index + this.chunkSize)
      this.emitChunk({
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: this.now(),
        messageId: this.messageId,
        delta,
      })
      if (index + this.chunkSize < text.length) {
        await this.sleep(this.chunkDelayMs)
      }
    }
  }

  closeMessage(): void {
    if (this.terminal) return
    if (this.messageState !== 'open') return
    this.messageState = 'closed'
    this.emitChunk({
      type: 'TEXT_MESSAGE_END',
      timestamp: this.now(),
      messageId: this.messageId,
    })
  }

  finishRun(): void {
    if (this.terminal || this.runFinished) return
    this.runFinished = true
    this.terminal = true
    this.emitChunk({
      type: 'RUN_FINISHED',
      timestamp: this.now(),
      runId: this.runId,
      finishReason: 'stop',
    })
  }

  handoffToFallback(): void {
    if (this.runFinished) return
    this.terminal = true
  }

  private ensureMessageStarted(): void {
    if (this.messageState !== 'idle') return
    this.startRun()
    this.messageState = 'open'
    this.emitChunk({
      type: 'TEXT_MESSAGE_START',
      timestamp: this.now(),
      messageId: this.messageId,
      role: 'assistant',
    })
  }
}
