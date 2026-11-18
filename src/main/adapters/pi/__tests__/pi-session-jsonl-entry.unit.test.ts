import { describe, expect, it } from 'vitest'
import { parsePiSessionEntryLine, parsePiSessionObjectLine } from '../pi-session-jsonl-entry'

const USAGE = {
  input: 10,
  output: 20,
  cacheRead: 1,
  cacheWrite: 2,
  totalTokens: 33,
  cost: { total: 0.5, input: 0.1 },
}

const WELL_FORMED = {
  type: 'message',
  id: 'entry-1',
  parentId: 'entry-0',
  cwd: '/tmp/project',
  timestamp: '2026-11-13T08:00:00.000Z',
  name: 'Session',
  customType: 'openwaggle-run',
  provider: 'openai',
  modelId: 'gpt-5.5',
  model: 'gpt-5.5',
  usage: USAGE,
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Hello' },
      { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'README.md' } },
    ],
    timestamp: 1,
    provider: 'openai',
    model: 'gpt-5.5',
    stopReason: 'stop',
    usage: USAGE,
    api: 'responses',
  },
}

const DECODED_USAGE = {
  input: 10,
  output: 20,
  cacheRead: 1,
  cacheWrite: 2,
  totalTokens: 33,
  cost: { total: 0.5 },
}

const DECODED = {
  type: 'message',
  id: 'entry-1',
  cwd: '/tmp/project',
  timestamp: '2026-11-13T08:00:00.000Z',
  name: 'Session',
  customType: 'openwaggle-run',
  provider: 'openai',
  modelId: 'gpt-5.5',
  model: 'gpt-5.5',
  usage: DECODED_USAGE,
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }, { type: 'toolCall' }],
    timestamp: 1,
    provider: 'openai',
    model: 'gpt-5.5',
    stopReason: 'stop',
    usage: DECODED_USAGE,
  },
}

// A well-formed line takes the strict decode and a malformed one the lenient decode; the entry
// must be the one the lenient schema alone gave, explicit-undefined keys included.
describe('parsePiSessionObjectLine', () => {
  it.each([
    { kind: 'a well-formed line', line: WELL_FORMED, expected: DECODED },
    {
      kind: 'a field of the wrong type',
      line: { ...WELL_FORMED, timestamp: 5 },
      expected: { ...DECODED, timestamp: undefined },
    },
    {
      kind: 'a content array with parts that do not decode',
      line: {
        ...WELL_FORMED,
        message: { ...WELL_FORMED.message, content: [{ type: 'text', text: 'a' }, 7, { type: 1 }] },
      },
      expected: {
        ...DECODED,
        message: {
          ...DECODED.message,
          content: [{ type: 'text', text: 'a' }, { type: undefined }],
        },
      },
    },
    {
      kind: 'a message that is not an object',
      line: { ...WELL_FORMED, message: 'hello' },
      expected: { ...DECODED, message: undefined },
    },
    {
      kind: 'a usage with a non-numeric count',
      line: { ...WELL_FORMED, usage: { ...USAGE, input: '10' } },
      expected: { ...DECODED, usage: { ...DECODED_USAGE, input: undefined } },
    },
  ])('decodes $kind as the lenient schema does', ({ line, expected }) => {
    expect(parsePiSessionObjectLine(JSON.stringify(line))).toStrictEqual(expected)
  })

  it.each([
    { line: '', entry: null, object: null },
    { line: '{"type":', entry: null, object: null },
    { line: '[1]', entry: {}, object: null },
  ])('reads $line as $entry, or $object for an object line', ({ line, entry, object }) => {
    expect(parsePiSessionEntryLine(line)).toStrictEqual(entry)
    expect(parsePiSessionObjectLine(line)).toStrictEqual(object)
  })
})
