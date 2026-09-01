import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  readPreferredWorkspaceExternalEditor,
  writePreferredWorkspaceExternalEditor,
} from '../workspace-external-editor-preference'

describe('workspace external editor preference', () => {
  it('round-trips a supported editor id', () => {
    let value: string | null = null
    const storage = fromPartial<Storage>({
      getItem: () => value,
      setItem: (_key: string, nextValue: string) => {
        value = nextValue
      },
    })
    writePreferredWorkspaceExternalEditor(storage, 'vscode')

    expect(readPreferredWorkspaceExternalEditor(storage)).toBe('vscode')
  })

  it('ignores stale or malformed values', () => {
    const storage = fromPartial<Storage>({
      getItem: () => 'system-default',
    })

    expect(readPreferredWorkspaceExternalEditor(storage)).toBeNull()
  })

  it('fails soft when storage is unavailable', () => {
    const storage = fromPartial<Storage>({
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })

    expect(readPreferredWorkspaceExternalEditor(storage)).toBeNull()
    expect(() => writePreferredWorkspaceExternalEditor(storage, 'zed')).not.toThrow()
  })
})
