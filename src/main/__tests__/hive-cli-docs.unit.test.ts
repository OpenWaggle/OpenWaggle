import { readFile } from 'node:fs/promises'
import {
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
} from '@shared/types/local-session-protocol-revisions'
import { describe, expect, it } from 'vitest'
import { CLI_ERROR_KINDS, cliExitCodeForKind } from '../cli-error'

const documentationPath = 'website/src/content/docs/developer-workflow/hive-cli.md'

describe('Hive CLI documentation contract', () => {
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
      'When the Session Host refuses a request, the response still goes to stdout, and the command exits with the code for that kind of error.',
    )
    expect(documentation).toContain('A failure that stops the command before it has a result')
    expect(documentation).toContain('`type: "error"` envelope on stderr')
    expect(documentation).toContain(
      'Its `--format jsonl` output (also selected by the `--jsonl` stream shorthand) is a portable export artifact, not a command-stream envelope',
    )
    expect(documentation).toContain("exportLine.record === 'manifest'")
    expect(documentation).toContain("exportLine.record === 'node'")
    expect(documentation).toContain(
      '`exports-watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope',
    )
  })

  it('documents exactly the error kinds and exit codes the CLI uses (#351)', async () => {
    const documentation = await readFile(documentationPath, 'utf8')
    const rows = [...documentation.matchAll(/^\| `([a-z_]+)` \| (\d+) \|/gm)].map(
      ([, kind, code]) => [kind, Number(code)],
    )

    expect(rows).toEqual(CLI_ERROR_KINDS.map((kind) => [kind, cliExitCodeForKind(kind)]))
  })

  it('names the protocol revision the Session Host accepts, and lists it first', async () => {
    const documentation = await readFile(documentationPath, 'utf8')
    const [accepted] = LOCAL_SESSION_SUPPORTED_REVISIONS
    const revisionRows = [...documentation.matchAll(/^\| (\d+) \| /gm)].map(([, revision]) =>
      Number(revision),
    )

    expect(LOCAL_SESSION_SUPPORTED_REVISIONS).toEqual([LOCAL_SESSION_CURRENT_REVISION])
    expect(documentation).toContain(
      `The current local session protocol revision is ${LOCAL_SESSION_CURRENT_REVISION}, and the Session Host accepts only revision ${accepted}.`,
    )
    expect(revisionRows[0]).toBe(LOCAL_SESSION_CURRENT_REVISION)
    expect(documentation).toContain(`Revision ${LOCAL_SESSION_CURRENT_REVISION} added`)
  })
})
