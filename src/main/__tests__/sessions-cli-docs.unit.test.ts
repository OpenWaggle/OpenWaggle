import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const documentationPath = 'website/src/content/docs/developer-workflow/sessions-cli.md'

describe('Sessions CLI documentation contract', () => {
  it('documents the versioned JSONL envelope and nested record payload', async () => {
    const documentation = await readFile(documentationPath, 'utf8')

    expect(documentation).toContain(
      '{"schemaVersion":1,"type":"response","command":"list","result":',
    )
    expect(documentation).toContain('{"schemaVersion":1,"type":"record","record":{"kind":"cursor"')
    expect(documentation).toContain(
      '{"schemaVersion":1,"type":"error","error":{"kind":"authorization","message":',
    )
    expect(documentation).toContain("line.type === 'record' && line.record.kind === 'cursor'")
    expect(documentation).toContain('persistCheckpoint(line.record.cursor)')
  })
})
