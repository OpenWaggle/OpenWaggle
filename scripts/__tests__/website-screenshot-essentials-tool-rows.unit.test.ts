import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { isRecord } from '../../src/shared/utils/validation'
import { RETRY_SOURCE } from '../website-screenshot-essentials-project'
import { toolRowsAssistantParts } from '../website-screenshot-essentials-tool-rows'

const PROJECT_PATH = '/tmp/openwaggle-shots-test/jotter'

function toolResult(name: string) {
  for (const part of toolRowsAssistantParts('worker-session', PROJECT_PATH)) {
    if (!('toolResult' in part) || !isRecord(part.toolResult)) continue
    if (part.toolResult.name === name) return part.toolResult
  }
  throw new Error(`The tool rows fixture has no ${name} result.`)
}

/** The text block of a Pi tool result. */
const toolResultContentSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.String })),
})
/** Pi's edit tool row: its arguments and the diff details it reported. */
const editStepSchema = Schema.Struct({
  args: Schema.Struct({
    path: Schema.String,
    edits: Schema.Array(Schema.Struct({ oldText: Schema.String, newText: Schema.String })),
  }),
  result: Schema.Struct({
    content: Schema.Unknown,
    details: Schema.Struct({
      patch: Schema.Unknown,
      diff: Schema.Unknown,
      firstChangedLine: Schema.Unknown,
    }),
  }),
})

function editStep() {
  const { args, result } = decodeUnknownOrThrow(editStepSchema, toolResult('edit'))
  return { path: args.path, edits: args.edits, result, details: result.details }
}

function textOf(result: unknown) {
  return decodeUnknownOrThrow(toolResultContentSchema, result).content.at(0)?.text
}

describe('website tool rows fixture', () => {
  it("records the edit exactly as Pi's edit tool reports it on the committed source", async () => {
    const { generateDiffString, generateUnifiedPatch } =
      await import('@earendil-works/pi-coding-agent')
    const { path, edits, result, details } = editStep()
    let edited = RETRY_SOURCE
    for (const { oldText, newText } of edits) {
      expect(edited.split(oldText)).toHaveLength(2)
      edited = edited.replace(oldText, newText)
    }
    const diff = generateDiffString(RETRY_SOURCE, edited)

    expect(details).toEqual({
      patch: generateUnifiedPatch(path, RETRY_SOURCE, edited),
      diff: diff.diff,
      firstChangedLine: diff.firstChangedLine,
    })
    expect(textOf(result)).toBe(
      `Successfully replaced ${String(edits.length)} block(s) in ${path}.`,
    )
  })

  it('stops retrying client errors in the edit the reply describes', () => {
    const { edits } = editStep()

    expect(RETRY_SOURCE).toContain('if (response.ok) return response')
    expect(RETRY_SOURCE).not.toContain('response.status < 500')
    expect(edits.map((edit) => edit.newText).join('\n')).toContain('response.status < 500')
  })

  it('names the absolute path Pi resolved in the failed read', () => {
    const { result } = toolResult('read')

    expect(textOf(result)).toBe(
      `ENOENT: no such file or directory, access '${nodePath.join(PROJECT_PATH, 'src/upload/policy.ts')}'`,
    )
  })
})
