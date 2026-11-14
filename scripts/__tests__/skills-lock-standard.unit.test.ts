import { describe, expect, it } from 'vitest'
import {
  claimSkillFiles,
  collectSkillsLockViolations,
  decodeSkillsLock,
  hashSkillFiles,
  isPristineSkill,
  type SkillsLock,
  type VendoredSkill,
} from '../standards/skills-lock'

const REF = 'a'.repeat(40)
const UPSTREAM_FILES = new Map([
  ['SKILL.md', '# Skill\n\nDo the task.\n'],
  ['references/notes.md', 'Notes.\n'],
])

function vendored(files: ReadonlyMap<string, string>, localEdits?: string) {
  const skill = {
    upstream: [
      {
        repository: 'https://github.com/example/skills',
        path: 'skills/example',
        ref: REF,
        hash: hashSkillFiles(UPSTREAM_FILES),
      },
    ],
    hash: hashSkillFiles(files),
  } satisfies VendoredSkill
  return localEdits === undefined ? skill : { ...skill, localEdits }
}

function lockWith(skill: VendoredSkill, firstParty: readonly string[] = ['local']) {
  return { lockfileVersion: 1, firstParty, skills: { example: skill } } satisfies SkillsLock
}

function skillsOnDisk(example: ReadonlyMap<string, string>) {
  return new Map([
    ['example', example],
    ['local', new Map([['SKILL.md', '# Local\n']])],
  ])
}

describe('skills lock', () => {
  it('hashes text without line-ending or final-newline differences', () => {
    const crlf = new Map(
      [...UPSTREAM_FILES].map(([file, text]) => [file, text.replaceAll('\n', '\r\n')]),
    )
    const trimmed = new Map([...UPSTREAM_FILES].map(([file, text]) => [file, text.trimEnd()]))
    expect(hashSkillFiles(crlf)).toBe(hashSkillFiles(UPSTREAM_FILES))
    expect(hashSkillFiles(trimmed)).toBe(hashSkillFiles(UPSTREAM_FILES))
    expect(hashSkillFiles(new Map([['SKILL.md', 'changed']]))).not.toBe(
      hashSkillFiles(UPSTREAM_FILES),
    )
  })

  it('accepts a pristine vendored skill and a listed first-party skill', () => {
    const lock = lockWith(vendored(UPSTREAM_FILES))
    expect(collectSkillsLockViolations(lock, skillsOnDisk(UPSTREAM_FILES))).toEqual([])
  })

  it('requires a recorded reason when the local copy differs from upstream', () => {
    const edited = new Map([...UPSTREAM_FILES, ['SKILL.md', '# Skill\n\nDo it our way.\n']])
    expect(
      collectSkillsLockViolations(lockWith(vendored(edited)), skillsOnDisk(edited)),
    ).toMatchObject([
      { detail: 'example', message: expect.stringContaining('without a recorded reason') },
    ])
    expect(
      collectSkillsLockViolations(
        lockWith(vendored(edited, 'Uses this repository commands.')),
        skillsOnDisk(edited),
      ),
    ).toEqual([])
  })

  it('rejects an edit made after the lock entry was recorded', () => {
    const lock = lockWith(vendored(UPSTREAM_FILES))
    const edited = new Map([...UPSTREAM_FILES, ['extra.md', 'New.\n']])
    expect(collectSkillsLockViolations(lock, skillsOnDisk(edited))).toMatchObject([
      { detail: 'example', message: expect.stringContaining('changed since its lock entry') },
    ])
  })

  it('rejects a stale reason on a skill that matches its upstream', () => {
    const lock = lockWith(vendored(UPSTREAM_FILES, 'Old reason.'))
    expect(collectSkillsLockViolations(lock, skillsOnDisk(UPSTREAM_FILES))).toMatchObject([
      { message: expect.stringContaining('stale localEdits') },
    ])
  })

  it('requires every skill directory to be listed, and every listed skill to exist', () => {
    const lock = lockWith(vendored(UPSTREAM_FILES), ['gone'])
    expect(collectSkillsLockViolations(lock, skillsOnDisk(UPSTREAM_FILES))).toMatchObject([
      { file: 'skills-lock.json', detail: 'gone' },
      { file: '.agents/skills/local' },
    ])
  })

  it('pins upstreams to full commit SHAs over https', () => {
    const skill = vendored(UPSTREAM_FILES)
    const [upstream] = skill.upstream
    const loose: VendoredSkill = {
      ...skill,
      upstream: [{ ...upstream, repository: 'git@github.com:example/skills', ref: 'main' }],
    }
    expect(
      collectSkillsLockViolations(lockWith(loose), skillsOnDisk(UPSTREAM_FILES)).map(
        (violation) => violation.message,
      ),
    ).toEqual([
      'An upstream repository is an https URL.',
      'An upstream ref is a full 40-character commit SHA.',
    ])
  })

  it('splits files between an upstream with a files list and the whole-directory upstream', () => {
    const license = 'License text.\n'
    const skill: VendoredSkill = {
      upstream: [
        {
          repository: 'https://github.com/example/skills',
          path: 'skills/example',
          ref: REF,
          hash: hashSkillFiles(UPSTREAM_FILES),
        },
        {
          repository: 'https://github.com/example/other',
          path: 'creator',
          ref: REF,
          files: ['LICENSE.txt'],
          hash: hashSkillFiles(new Map([['LICENSE.txt', license]])),
        },
      ],
      hash: '',
    }
    const files = new Map([...UPSTREAM_FILES, ['LICENSE.txt', license]])
    const { claimed, unclaimed } = claimSkillFiles(skill, files)
    expect(claimed.map((set) => [...set.keys()].sort())).toEqual([
      ['SKILL.md', 'references/notes.md'],
      ['LICENSE.txt'],
    ])
    expect(unclaimed).toEqual([])
    expect(isPristineSkill(skill, files)).toBe(true)
  })

  it('decodes the lock strictly', () => {
    expect(decodeSkillsLock('{"lockfileVersion":1,"firstParty":[],"skills":{}}')).toEqual({
      ok: true,
      lock: { lockfileVersion: 1, firstParty: [], skills: {} },
    })
    expect(decodeSkillsLock('{"lockfileVersion":1,"firstParty":[],"skills":{},"x":1}').ok).toBe(
      false,
    )
    expect(decodeSkillsLock('not json').ok).toBe(false)
  })
})
