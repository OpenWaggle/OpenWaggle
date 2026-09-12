import { TERMINAL } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRecord,
  FAKE_PID,
  INPUT,
  makeFakePty,
  makeRuntime,
  setupTerminalRuntimeTest,
  teardownTerminalRuntimeTest,
} from './terminal-runtime-test-harness'

describe('makeTerminalRuntime output delivery', () => {
  beforeEach(setupTerminalRuntimeTest)
  afterEach(teardownTerminalRuntimeTest)

  it('delivers one offset-ordered output chunk at a time until exact acknowledgement', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    const first = 'a'.repeat(TERMINAL.OUTPUT_DELIVERY_CHUNK_BYTES)
    const second = 'b'.repeat(TERMINAL.OUTPUT_DELIVERY_CHUNK_BYTES)
    fake.dataListeners[0]?.(first + second)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)

    const outputEvents = emitted.flatMap((payload) =>
      payload.event.type === 'output' ? [payload.event] : [],
    )
    expect(outputEvents).toHaveLength(1)
    const firstEvent = outputEvents[0]
    expect(firstEvent).toMatchObject({ startOffset: 0, endOffset: first.length, data: first })

    runtime.acknowledgeOutput(record, record.outputGeneration - 1, first.length)
    runtime.acknowledgeOutput(record, record.outputGeneration, first.length - 1)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)
    expect(emitted.filter((payload) => payload.event.type === 'output')).toHaveLength(1)

    runtime.acknowledgeOutput(record, record.outputGeneration, first.length)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)
    const delivered = emitted.flatMap((payload) =>
      payload.event.type === 'output' ? [payload.event] : [],
    )
    expect(delivered).toHaveLength(2)
    expect(delivered[1]).toMatchObject({
      startOffset: first.length,
      endOffset: first.length + second.length,
      data: second,
    })
  })

  it('tracks delivery and snapshot offsets in UTF-8 bytes', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    fake.dataListeners[0]?.('a🙂β')
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)

    expect(record.outputBytes).toBe(7)
    expect(emitted.findLast((payload) => payload.event.type === 'output')?.event).toMatchObject({
      type: 'output',
      data: 'a🙂β',
      startOffset: 0,
      endOffset: 7,
    })
  })

  it('never splits an emoji at the delivery byte cap and requires its byte end-offset ack', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    const asciiPrefix = 'x'.repeat(TERMINAL.OUTPUT_DELIVERY_CHUNK_BYTES - 1)

    fake.dataListeners[0]?.(`${asciiPrefix}🙂β`)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)
    const first = emitted.findLast((payload) => payload.event.type === 'output')?.event
    if (first?.type !== 'output') throw new Error('Expected first output event')
    expect(first).toMatchObject({
      data: asciiPrefix,
      startOffset: 0,
      endOffset: asciiPrefix.length,
    })

    runtime.acknowledgeOutput(record, first.outputGeneration, first.endOffset)
    await vi.advanceTimersByTimeAsync(0)
    const outputs = emitted.flatMap((payload) =>
      payload.event.type === 'output' ? [payload.event] : [],
    )
    expect(outputs[1]).toMatchObject({
      data: '🙂β',
      startOffset: asciiPrefix.length,
      endOffset: asciiPrefix.length + 6,
    })
    const second = outputs[1]
    if (second === undefined) throw new Error('Expected second output event')
    runtime.acknowledgeOutput(record, second.outputGeneration, second.endOffset)
    expect(record.inFlightOutput).toBeNull()
  })

  it('pauses at the high-water backlog and resumes after acknowledgements drain it', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    fake.resumeOutput.mockClear()

    fake.dataListeners[0]?.('x'.repeat(TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES))
    expect(fake.pauseOutput).toHaveBeenCalledOnce()

    while (record.pendingOutput.length > 0 || record.inFlightOutput !== null) {
      await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)
      const event = emitted.findLast((payload) => payload.event.type === 'output')?.event
      if (event?.type === 'output') {
        runtime.acknowledgeOutput(record, event.outputGeneration, event.endOffset)
      }
    }

    expect(fake.resumeOutput).toHaveBeenCalledOnce()
    expect(record.live?.outputPaused).toBe(false)
  })

  it('clearing a paused output generation restores flow-control state for the next generation', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    fake.resumeOutput.mockClear()

    fake.dataListeners[0]?.('x'.repeat(TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES))
    expect(record.live?.outputPaused).toBe(true)

    runtime.resetOutputStream(record)

    expect(fake.resumeOutput).toHaveBeenCalledOnce()
    expect(record.live?.outputPaused).toBe(false)

    fake.dataListeners[0]?.('y'.repeat(TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES))
    expect(fake.pauseOutput).toHaveBeenCalledTimes(2)
    expect(record.live?.outputPaused).toBe(true)
  })

  it('auto-acknowledges output when no renderer surface received it', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake, 0)
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    fake.dataListeners[0]?.('hidden terminal output')
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.inFlightOutput).toBeNull()
    expect(record.scrollback.toString()).toBe('hidden terminal output')
  })
})
