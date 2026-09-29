import { describe, expect, it, vi } from 'vitest'
import { RunCliOutput, sanitizeTerminalText } from '../run-cli-output'

describe('terminal text sanitizing', () => {
  it.each([
    ['plain text\n\ttabbed', 'plain text\n\ttabbed'],
    ['red \u001b[31mtext\u001b[0m', 'red text'],
    ['erase\u001b[2K\u001b[1Gline', 'eraseline'],
    ['title \u001b]0;fake\u0007done', 'title done'],
    ['link \u001b]8;;https://x\u001b\\label', 'link label'],
    ['over\rwrite', 'overwrite'],
    ['windows\r\nline', 'windows\nline'],
    ['bell\u0007 and \u009b31m c1', 'bell and 31m c1'],
    ['dangling escape\u001b', 'dangling escape'],
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeTerminalText(input)).toBe(expected)
  })
})

describe('run output queue', () => {
  it('keeps stdout and stderr in the order they were written', async () => {
    const order: string[] = []
    const output = new RunCliOutput(
      {
        writeStdout: async (text) => {
          await Promise.resolve()
          order.push(`out:${text}`)
        },
        writeStderr: (text) => order.push(`err:${text}`),
        stdoutIsTerminal: false,
      },
      () => undefined,
    )

    output.reply('Hello')
    output.reply('\n')
    output.stderr('note\n')
    await output.flushed()

    expect(order).toEqual(['out:Hello', 'out:\n', 'err:note\n'])
  })

  it('sanitizes replies only when stdout is a terminal', async () => {
    const written: string[] = []
    const sinks = {
      writeStdout: async (text: string) => {
        written.push(text)
      },
      writeStderr: () => undefined,
    }
    new RunCliOutput({ ...sinks, stdoutIsTerminal: false }, () => undefined).reply('\u001b[1mb')
    const terminal = new RunCliOutput({ ...sinks, stdoutIsTerminal: true }, () => undefined)
    terminal.reply('\u001b[1mb')
    await terminal.flushed()

    expect(written).toEqual(['\u001b[1mb', 'b'])
  })

  it('reports the first stdout failure once and stops writing', async () => {
    const onFailure = vi.fn()
    const writeStdout = vi.fn(async () => {
      throw new Error('EPIPE')
    })
    const output = new RunCliOutput(
      { writeStdout, writeStderr: () => undefined, stdoutIsTerminal: false },
      onFailure,
    )

    output.reply('a')
    output.reply('b')
    await output.flushed()

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(writeStdout).toHaveBeenCalledTimes(1)
  })
})
