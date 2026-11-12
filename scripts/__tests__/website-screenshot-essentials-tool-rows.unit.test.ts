import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
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

function editStep() {
  const step = toolResult('edit')
  const { args, result } = step
  if (!isRecord(args) || !isRecord(result) || !isRecord(result['details'])) {
    throw new Error('The edit row has no arguments or details.')
  }
  const { path, edits } = args
  if (typeof path !== 'string' || !Array.isArray(edits)) throw new Error('Malformed edit args.')
  return { path, edits: edits.filter(isRecord), result, details: result['details'] }
}

function textOf(result: Record<string, unknown>) {
  const [block] = Array.isArray(result['content']) ? result['content'] : []
  return isRecord(block) ? block['text'] : undefined
}

describe('website tool rows fixture', () => {
  it("records the edit exactly as Pi's edit tool reports it on the committed source", async () => {
    const { generateDiffString, generateUnifiedPatch } =
      await import('@earendil-works/pi-coding-agent')
    const { path, edits, result, details } = editStep()
    let edited = RETRY_SOURCE
    for (const edit of edits) {
      const { oldText, newText } = edit
      if (typeof oldText !== 'string' || typeof newText !== 'string') throw new Error('Bad edit.')
      expect(edited.split(oldText)).toHaveLength(2)
      edited = edited.replace(oldText, newText)
    }
    const diff = generateDiffString(RETRY_SOURCE, edited)

    expect(details['patch']).toBe(generateUnifiedPatch(path, RETRY_SOURCE, edited))
    expect(details['diff']).toBe(diff.diff)
    expect(details['firstChangedLine']).toBe(diff.firstChangedLine)
    expect(textOf(result)).toBe(
      `Successfully replaced ${String(edits.length)} block(s) in ${path}.`,
    )
  })

  it('stops retrying client errors in the edit the reply describes', () => {
    const { edits } = editStep()

    expect(RETRY_SOURCE).toContain('if (response.ok) return response')
    expect(RETRY_SOURCE).not.toContain('response.status < 500')
    expect(edits.map((edit) => edit['newText']).join('\n')).toContain('response.status < 500')
  })

  it('names the absolute path Pi resolved in the failed read', () => {
    const { result } = toolResult('read')
    if (!isRecord(result)) throw new Error('The read row has no result.')

    expect(textOf(result)).toBe(
      `ENOENT: no such file or directory, access '${nodePath.join(PROJECT_PATH, 'src/upload/policy.ts')}'`,
    )
  })
})
