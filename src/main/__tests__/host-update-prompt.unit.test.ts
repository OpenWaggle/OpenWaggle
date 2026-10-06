import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { askRunHandling } from '../host-update-prompt'

function terminal() {
  const input = new PassThrough()
  const output = new PassThrough()
  const written: string[] = []
  output.on('data', (chunk: Buffer) => written.push(chunk.toString()))
  const close = vi.fn()
  return { value: { input, output, close }, input, written, close }
}

describe('asking about active Runs before an update', () => {
  it.each([
    ['\n', 'when-idle'],
    ['w\n', 'when-idle'],
    ['N\n', 'now'],
    ['cancel\n', 'cancel'],
  ] as const)('maps the answer %j to %s', async (answer, choice) => {
    const { value, input, close } = terminal()

    const asked = askRunHandling(2, value, () => undefined)
    input.write(answer)

    await expect(asked).resolves.toBe(choice)
    expect(close).toHaveBeenCalledOnce()
  })

  it('asks again after an answer it does not know', async () => {
    const { value, input, written } = terminal()

    const asked = askRunHandling(1, value, () => undefined)
    input.write('maybe\n')
    // A person answers once the question is asked again.
    await vi.waitFor(() => expect(written.join('').split('still working')).toHaveLength(3))
    input.write('n\n')

    await expect(asked).resolves.toBe('now')
    expect(written.join('').match(/1 agent run is still working/gu)).toHaveLength(2)
  })

  it('cancels when the input ends without an answer', async () => {
    const { value, input } = terminal()

    const asked = askRunHandling(1, value, () => undefined)
    input.end()

    await expect(asked).resolves.toBe('cancel')
  })

  it('waits for the Runs, saying so, when there is no terminal to ask on', async () => {
    const notice = vi.fn()

    await expect(askRunHandling(3, null, notice)).resolves.toBe('when-idle')
    expect(notice).toHaveBeenCalledWith(
      '3 agent runs are still working; waiting for them to finish (Ctrl-C cancels).',
    )
  })
})
