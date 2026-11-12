import { describe, expect, it } from 'vitest'
import {
  collectAgentMemoryFileViolations,
  collectAgentMemoryIndexViolations,
  MEMORY_INDEX_TOKEN_CAP,
  MEMORY_TOPIC_TOKEN_CAP,
} from '../standards/agent-memory'

const SUMMARY = ['# Topic', '', 'Covers one area.', 'Says what it holds.', 'Load when touching it.']
const TOPIC = [...SUMMARY, '', '## Entry', '', '- A finding.', ''].join('\n')
// "word " is one o200k token, so this text is a little over the cap.
const overCap = (cap: number) => 'word '.repeat(cap + 10)

describe('project memory caps (ADR 0064)', () => {
  it('accepts a topic that opens with a summary and fits its cap', () => {
    expect(collectAgentMemoryFileViolations('.agents/memory/topic.md', TOPIC)).toEqual([])
  })

  it('rejects a topic without a 3-6 line summary under its title', () => {
    for (const contents of [
      '## Entry\n\n- A finding.\n',
      '# Topic\n\nOne line.\n\n- A finding.\n',
      `# Topic\n\n${'line\n'.repeat(7)}\n- A finding.\n`,
    ]) {
      expect(collectAgentMemoryFileViolations('.agents/memory/topic.md', contents)).toHaveLength(1)
    }
  })

  it('caps the index and each topic in o200k tokens', () => {
    expect(
      collectAgentMemoryFileViolations('MEMORY.md', overCap(MEMORY_INDEX_TOKEN_CAP)),
    ).toMatchObject([{ file: 'MEMORY.md' }])
    expect(
      collectAgentMemoryFileViolations(
        '.agents/memory/topic.md',
        `${SUMMARY.join('\n')}\n\n${overCap(MEMORY_TOPIC_TOKEN_CAP)}`,
      ),
    ).toMatchObject([{ file: '.agents/memory/topic.md' }])
  })

  it('ignores markdown outside the memory files', () => {
    expect(collectAgentMemoryFileViolations('.agents/memory/nested/x.md', '')).toEqual([])
    expect(collectAgentMemoryFileViolations('docs/notes.md', '')).toEqual([])
  })

  it('requires every topic to be indexed and every indexed topic to exist', () => {
    const contentsByFile = new Map([
      [
        'MEMORY.md',
        '- [`a`](.agents/memory/a.md): when.\n- [`gone`](.agents/memory/gone.md): x.\n',
      ],
      ['.agents/memory/a.md', TOPIC],
      ['.agents/memory/b.md', TOPIC],
    ])
    expect(collectAgentMemoryIndexViolations(contentsByFile)).toMatchObject([
      { file: '.agents/memory/b.md' },
      { file: 'MEMORY.md', detail: '.agents/memory/gone.md' },
    ])
  })
})
