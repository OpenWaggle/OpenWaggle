import { describe, expect, it } from 'vitest'
import {
  collectAdrNumberingViolations,
  LEGACY_SHARED_ADR_NUMBERS,
} from '../standards/adr-numbering'

const INDEX = 'docs/architecture.md'

function indexListing(names: readonly string[]) {
  return new Map([[INDEX, names.map((name) => `- \`docs/adr/${name}\``).join('\n')]])
}

describe('ADR numbering', () => {
  it('accepts unique, contiguous ADRs that the index lists', () => {
    const names = ['0001-first.md', '0002-second.md']
    expect(collectAdrNumberingViolations(names, indexListing(names))).toEqual([])
  })

  it('rejects a number two ADRs share', () => {
    const names = ['0001-first.md', '0002-second.md', '0002-also-second.md']
    expect(collectAdrNumberingViolations(names, indexListing(names))).toMatchObject([
      { detail: '0002-also-second.md, 0002-second.md' },
    ])
  })

  it('accepts only the frozen legacy pairs as shared numbers', () => {
    const [number, legacy] = [...LEGACY_SHARED_ADR_NUMBERS].at(-1) ?? ['', []]
    const names = Array.from(
      { length: Number(number) - 1 },
      (_, index) => `${String(index + 1).padStart(4, '0')}-adr.md`,
    ).concat(legacy)
    expect(collectAdrNumberingViolations(names, indexListing(names))).toEqual([])
    const third = [...names, `${number}-a-third-decision.md`]
    expect(collectAdrNumberingViolations(third, indexListing(third))).toHaveLength(1)
  })

  it('rejects a gap in the numbers and a badly named ADR file', () => {
    const names = ['0001-first.md', '0003-third.md', 'notes.md']
    expect(collectAdrNumberingViolations(names, indexListing(names))).toMatchObject([
      { file: 'docs/adr/notes.md' },
      { detail: '0002' },
    ])
  })

  it('requires every ADR in each existing index, and only existing ADRs', () => {
    const names = ['0001-first.md', '0002-second.md']
    expect(
      collectAdrNumberingViolations(names, indexListing(['0001-first.md', '0009-gone.md'])),
    ).toMatchObject([
      { file: INDEX, detail: 'docs/adr/0002-second.md' },
      { file: INDEX, detail: 'docs/adr/0009-gone.md' },
    ])
    expect(collectAdrNumberingViolations(names, new Map())).toEqual([])
  })

  it('reads a docs/adr README index by bare file names', () => {
    const names = ['0001-first.md', '0002-second.md', 'README.md']
    const readme = new Map([['docs/adr/README.md', '- [First](0001-first.md)\n']])
    expect(collectAdrNumberingViolations(names, readme)).toMatchObject([
      { file: 'docs/adr/README.md', detail: 'docs/adr/0002-second.md' },
    ])
  })
})
