import { describe, expect, it, vi } from 'vitest'
import { StreamSession } from './stream-session'

interface ChunkRecorder {
  readonly chunks: unknown[]
  readonly emit: (chunk: unknown) => void
}

function createRecorder(): ChunkRecorder {
  const chunks: unknown[] = []
  return {
    chunks,
    emit(chunk) {
      chunks.push(chunk)
    },
  }
}

function chunkTypes(chunks: readonly unknown[]): string[] {
  const types: string[] = []
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'type' in chunk) {
      const maybeType = chunk.type
      if (typeof maybeType === 'string') {
        types.push(maybeType)
      }
    }
  }
  return types
}

describe('StreamSession', () => {
  it('throws when chunkSize is not a positive integer', () => {
    const recorder = createRecorder()

    expect(
      () =>
        new StreamSession({
          runId: 'run-1',
          threadId: 'thread-1',
          messageId: 'msg-1',
          emitChunk: recorder.emit,
          now: () => 1,
          sleep: async () => {},
          chunkSize: 0,
          chunkDelayMs: 12,
        }),
    ).toThrow('StreamSession chunkSize must be a positive integer')
  })

  it('throws when chunkDelayMs is negative', () => {
    const recorder = createRecorder()

    expect(
      () =>
        new StreamSession({
          runId: 'run-1',
          threadId: 'thread-1',
          messageId: 'msg-1',
          emitChunk: recorder.emit,
          now: () => 1,
          sleep: async () => {},
          chunkSize: 50,
          chunkDelayMs: -1,
        }),
    ).toThrow('StreamSession chunkDelayMs must be a non-negative number')
  })

  it('emits RUN_STARTED exactly once', () => {
    const recorder = createRecorder()
    const session = new StreamSession({
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      emitChunk: recorder.emit,
      now: () => 1,
      sleep: async () => {},
      chunkSize: 50,
      chunkDelayMs: 12,
    })

    session.startRun()
    session.startRun()

    expect(chunkTypes(recorder.chunks)).toEqual(['RUN_STARTED'])
  })

  it('pairs TEXT_MESSAGE_START/END and emits RUN_FINISHED on completion', () => {
    const recorder = createRecorder()
    const session = new StreamSession({
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      emitChunk: recorder.emit,
      now: () => 1,
      sleep: async () => {},
      chunkSize: 50,
      chunkDelayMs: 12,
    })

    session.startRun()
    session.appendText('hello')
    session.closeMessage()
    session.finishRun()

    expect(chunkTypes(recorder.chunks)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
  })

  it('does not emit RUN_FINISHED when handed off to fallback', () => {
    const recorder = createRecorder()
    const session = new StreamSession({
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      emitChunk: recorder.emit,
      now: () => 1,
      sleep: async () => {},
      chunkSize: 50,
      chunkDelayMs: 12,
    })

    session.startRun()
    session.appendText('partial')
    session.closeMessage()
    session.handoffToFallback()
    session.finishRun()

    expect(chunkTypes(recorder.chunks)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
  })

  it('ignores post-terminal content writes', () => {
    const recorder = createRecorder()
    const session = new StreamSession({
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      emitChunk: recorder.emit,
      now: () => 1,
      sleep: async () => {},
      chunkSize: 50,
      chunkDelayMs: 12,
    })

    session.startRun()
    session.appendText('one')
    session.closeMessage()
    session.finishRun()
    session.appendText('two')

    expect(session.text).toBe('one')
    expect(chunkTypes(recorder.chunks)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
  })

  it('streams text in chunks and waits between chunks', async () => {
    const recorder = createRecorder()
    const sleep = vi.fn(async () => {})
    const session = new StreamSession({
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      emitChunk: recorder.emit,
      now: () => 1,
      sleep,
      chunkSize: 2,
      chunkDelayMs: 12,
    })

    session.startRun()
    await session.streamText('abcdef')

    expect(session.text).toBe('abcdef')
    const types = chunkTypes(recorder.chunks)
    expect(types).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
    ])
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
