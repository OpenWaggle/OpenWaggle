import { describe, expect, it, vi } from 'vitest'
import { RunCliOutput } from '../run-cli-output'
import { sanitizeTerminalText } from '../terminal-text'

describe('terminal text sanitizing', () => {
  it.each([
    ['plain text\n\ttabbed', 'plain text\n\ttabbed'],
    ['red \u001b[31mtext\u001b[0m', 'red \\x1b[31mtext\\x1b[0m'],
    ['ls \u001b[;./0m -la', 'ls \\x1b[;./0m -la'],
    ['title \u001b]0;fake\u0007done', 'title \\x1b]0;fake\\x07done'],
    ['over\rwrite', 'over\\x0dwrite'],
    ['windows\r\nline', 'windows\nline'],
    ['c1 \u009b31m', 'c1 \\x9b31m'],
    ['rm -rf \u202esdrawkcab', 'rm -rf \\u202esdrawkcab'],
    ['isolate \u2066x\u2069 mark \u200f', 'isolate \\u2066x\\u2069 mark \\u200f'],
    ['arabic mark \u061c', 'arabic mark \\u061c'],
    ['hid\u200bden \ufeff\u00ad', 'hid\\u200bden \\ufeff\\xad'],
    ['tag \u{e0041}', 'tag \\u{e0041}'],
    [
      'scotland \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}',
      'scotland \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}',
    ],
    ['family \u{1f468}\u200d\u{1f469}', 'family \u{1f468}\u200d\u{1f469}'],
    ['lone \\x0d\n kept', 'lone \\x0d\n kept'],
    ['bare flag \u{1f3f4}\u{e0049}\u{e0047}', 'bare flag \u{1f3f4}\\u{e0049}\\u{e0047}'],
    ['short flag \u{1f3f4}\u{e0061}\u{e007f}', 'short flag \u{1f3f4}\\u{e0061}\\u{e007f}'],
    [
      'after flag \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}\u{e0063}',
      'after flag \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}\\u{e0063}',
    ],
    ['fillers \u3164\u034f\u{e0100}', 'fillers \\u3164\\u034f\\u{e0100}'],
    ['selectors ls\ufe00\ufe01\ufe0e -la', 'selectors ls\ufe00\\ufe01\\ufe0e -la'],
    ['joiners ls\u200d\ufe0f\u200d -la', 'joiners ls\\u200d\\ufe0f\\u200d -la'],
    ['mongolian \u180b khmer \u17b4 \u206a', 'mongolian \\u180b khmer \\u17b4 \\u206a'],
    ['heart fire \u2764\ufe0f\u200d\u{1f525}', 'heart fire \u2764\ufe0f\u200d\u{1f525}'],
    [
      'skin toned \u{1f469}\u{1f3fd}\u200d\u{1f4bb}',
      'skin toned \u{1f469}\u{1f3fd}\u200d\u{1f4bb}',
    ],
    [
      'emoji \u2764\ufe0f \u{1f44d}\u{1f3fd} \u4e2d\u6587 e\u0301',
      'emoji \u2764\ufe0f \u{1f44d}\u{1f3fd} \u4e2d\u6587 e\u0301',
    ],
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

    expect(written).toEqual(['\u001b[1mb', '\\x1b[1mb'])
  })

  it('keeps a CRLF split across two reply deltas as one line break', async () => {
    const written: string[] = []
    const output = new RunCliOutput(
      {
        writeStdout: async (text) => {
          written.push(text)
        },
        writeStderr: () => undefined,
        stdoutIsTerminal: true,
      },
      () => undefined,
    )
    output.reply('a\r')
    output.reply('\nb')
    await output.flushed()

    expect(written.join('')).toBe('a\nb')
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
