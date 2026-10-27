import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  createBashToolDefinition,
  type ExtensionToolContext,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, onTestFinished } from 'vitest'

/**
 * A command's result stays in the conversation and is re-read on every later request until
 * compaction; bash results were 55% of those re-reads. Pi showed up to 50 KB of the output's end.
 * The patched tool shows at most 16 KB, its first and last 8 KB, and saves the whole output to a
 * file the model can read.
 */

const MODEL_OUTPUT_MAX_BYTES = 16 * 1024

async function runBash(command: string) {
  // No session to expose: the tool then reads nothing from its context.
  const tool = createBashToolDefinition(process.cwd(), { exposeSessionEnvironment: false })
  const result = await tool.execute(
    'call-1',
    { command },
    undefined,
    undefined,
    fromPartial<ExtensionToolContext>({}),
  )
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const fullOutputPath: unknown =
    typeof result.details === 'object' && result.details !== null
      ? Reflect.get(result.details, 'fullOutputPath')
      : undefined
  if (typeof fullOutputPath === 'string') {
    onTestFinished(() => rmSync(fullOutputPath, { force: true }))
  }
  return { text, fullOutputPath }
}

/** 400 numbered lines of 100 bytes each: 40,000 bytes. */
const LONG_OUTPUT = 'for i in $(seq 1 400); do printf "line %04d %089d\\n" "$i" 0; done'

describe('bash output the model sees', () => {
  it('keeps the first and last 8 KB of a long output and saves all of it', async () => {
    const { text, fullOutputPath } = await runBash(LONG_OUTPUT)

    expect(Buffer.byteLength(text)).toBeLessThan(MODEL_OUTPUT_MAX_BYTES + 400)
    expect(text.startsWith('line 0001 ')).toBe(true)
    expect(text).toContain('line 0400 ')
    expect(text).not.toContain('line 0200 ')
    expect(text).toMatch(/bytes omitted/u)
    expect(text).toContain(`Full output: ${String(fullOutputPath)}`)
    const saved = await readFile(String(fullOutputPath), 'utf8')
    expect(saved.split('\n').filter(Boolean)).toHaveLength(400)
  })

  it('shows a short output whole, with no file', async () => {
    const { text, fullOutputPath } = await runBash('printf "short\\n"')

    expect(text).toBe('short\n')
    expect(fullOutputPath).toBeUndefined()
  })

  it('says so in the tool description', () => {
    expect(createBashToolDefinition(process.cwd()).description).toContain(
      'Output over 16KB keeps its first and last 8KB',
    )
  })
})
