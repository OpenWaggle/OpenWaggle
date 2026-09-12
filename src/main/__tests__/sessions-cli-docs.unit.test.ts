import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const documentationPath = 'website/src/content/docs/developer-workflow/sessions-cli.md'

describe('Sessions CLI documentation contract', () => {
  it('distinguishes command envelopes, rejected responses, and export artifact records', async () => {
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
    expect(documentation).toContain(
      'structured rejected outcome returned by the Host; the response remains available on stdout',
    )
    expect(documentation).toContain(
      'failure that aborts before a structured command result is available',
    )
    expect(documentation).toContain('`type: "error"` envelope on stderr')
    expect(documentation).toContain(
      'Its `--format jsonl` output (also selected by the `--jsonl` stream shorthand) is a portable export artifact, not a command-stream envelope',
    )
    expect(documentation).toContain("exportLine.record === 'manifest'")
    expect(documentation).toContain("exportLine.record === 'node'")
    expect(documentation).toContain(
      '`export watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope',
    )
  })
})
