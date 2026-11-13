import { describe, expect, it } from 'vitest'
import { commitMessageSubject, validateCommitMessage } from '../../check-conventional-commits'
import { nulSeparated, planPreCommitFormat } from '../pre-commit'
import { type PushGit, type RefUpdate, parseRefUpdates, planPrePush } from '../pre-push'

const ZERO = '0000000000000000000000000000000000000000'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const UNKNOWN = 'c'.repeat(40)

/** A history where OLD is an ancestor of NEW and UNKNOWN was never fetched. */
const GIT: PushGit = {
  commitExists: (sha) => sha === OLD || sha === NEW,
  isAncestor: (ancestor, descendant) =>
    ancestor === descendant || (ancestor === OLD && descendant === NEW),
}

function update(remoteRef: string, localSha: string, remoteSha: string) {
  return { localRef: 'refs/heads/feature', localSha, remoteRef, remoteSha } satisfies RefUpdate
}

describe('commit-msg', () => {
  it('reads the subject past comments, blank lines and the verbose diff', () => {
    expect(commitMessageSubject('# Please enter\n\n  feat: x  \n\nbody')).toBe('feat: x')
    expect(
      commitMessageSubject('# ------------------------ >8 ------------------------\nfix: y'),
    ).toBe('')
  })

  it('accepts Conventional Commits and the subjects git and autosquash write', () => {
    for (const message of [
      'feat: x',
      'fix(hooks)!: y\n\nbody',
      'Merge branch main into feature',
      'fixup! feat: x',
    ]) {
      expect(validateCommitMessage(message)).toEqual([])
    }
  })

  it('rejects other subjects and empty messages', () => {
    expect(validateCommitMessage('update stuff')[0]).toMatch(
      /not an allowed Conventional Commit subject/,
    )
    expect(validateCommitMessage('feature: x')).toHaveLength(1)
    expect(validateCommitMessage('Revert "feat: x"')).toHaveLength(1)
    expect(validateCommitMessage('# only a comment\n')).toEqual(['The commit message is empty.'])
  })
})

describe('pre-commit', () => {
  it('formats fully staged files and leaves partially staged ones alone', () => {
    expect(planPreCommitFormat(['a.ts', 'b.ts', 'c.md'], ['b.ts', 'other.ts'])).toEqual({
      format: ['a.ts', 'c.md'],
      partiallyStaged: ['b.ts'],
    })
  })

  it('splits NUL-separated git output, keeping spaces in paths', () => {
    expect(nulSeparated('a b.ts\0dir/c.ts\0')).toEqual(['a b.ts', 'dir/c.ts'])
    expect(nulSeparated('')).toEqual([])
  })
})

describe('pre-push', () => {
  it('parses the ref updates git writes to stdin', () => {
    expect(parseRefUpdates(`refs/heads/feature ${NEW} refs/heads/feature ${OLD}\n\n`)).toEqual([
      update('refs/heads/feature', NEW, OLD),
    ])
  })

  it('runs the fast verify for a fast-forward or a new branch', () => {
    expect(planPrePush([update('refs/heads/feature', NEW, OLD)], GIT)).toEqual({
      kind: 'run',
      script: 'verify',
    })
    expect(planPrePush([update('refs/heads/feature', NEW, ZERO)], GIT)).toEqual({
      kind: 'run',
      script: 'verify',
    })
  })

  it('runs the full gate for a push to main', () => {
    expect(planPrePush([update('refs/heads/main', NEW, OLD)], GIT)).toEqual({
      kind: 'run',
      script: 'prepush:main',
    })
  })

  it('refuses a push that drops commits from the remote, with no override', () => {
    const plan = planPrePush([update('refs/heads/feature', OLD, NEW)], GIT)
    expect(plan).toMatchObject({ kind: 'reject' })
    expect(plan.kind === 'reject' ? plan.message : '').toMatch(
      /refusing a force push to refs\/heads\/feature/,
    )
  })

  it('refuses a push over remote commits this clone never fetched', () => {
    expect(planPrePush([update('refs/heads/feature', NEW, UNKNOWN)], GIT)).toMatchObject({
      kind: 'reject',
    })
  })

  it.each([
    ['an ow/ PR branch replayed onto main', [update('refs/heads/ow/pr', OLD, NEW)], 'run'],
    ['a rewrite of main', [update('refs/heads/main', OLD, NEW)], 'reject'],
    [
      'an ow/ rewrite pushed with a non-ow/ rewrite',
      [update('refs/heads/ow/pr', OLD, NEW), update('refs/heads/feature', OLD, NEW)],
      'reject',
    ],
    // The lease names the expected sha, so an ow/ rewrite still needs the remote sha fetched.
    [
      'an ow/ push over an unfetched remote sha',
      [update('refs/heads/ow/pr', NEW, UNKNOWN)],
      'reject',
    ],
  ])('rewrites: %s gives %s', (_name, updates, kind) => {
    expect(planPrePush(updates, GIT)).toMatchObject(
      kind === 'run' ? { kind, script: 'verify' } : { kind },
    )
  })

  it('refuses the whole push when any ref is rewritten', () => {
    const updates = [update('refs/heads/ok', NEW, OLD), update('refs/heads/rewritten', OLD, NEW)]
    expect(planPrePush(updates, GIT)).toMatchObject({ kind: 'reject' })
  })

  it('runs nothing for a deletion-only push', () => {
    expect(planPrePush([update('refs/heads/old', ZERO, OLD)], GIT)).toEqual({ kind: 'skip' })
    expect(planPrePush([], GIT)).toEqual({ kind: 'skip' })
  })
})
