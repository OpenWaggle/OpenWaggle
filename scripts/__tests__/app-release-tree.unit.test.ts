import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareAppRelease } from '../app-release-intent'
import { verifyGeneratedAppReleaseTree } from '../app-release-tree'

const tempRoots: string[] = []
const BASE_DATE = '2026-01-02T12:00:00Z'
const CANDIDATE_DATE = '2026-02-03T12:00:00Z'
const VERSION = '0.3.0-alpha.65'

interface ReleaseRepository {
  readonly base: string
  readonly candidate: string
  readonly root: string
}

function git(root: string, ...args: readonly string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function writeReleaseSources(root: string) {
  fs.mkdirSync(path.join(root, '.release', 'changes'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'openwaggle', private: true, version: '0.3.0-alpha.64' }, null, 2)}\n`,
  )
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n<!-- app-release-history -->\n',
  )
  fs.writeFileSync(
    path.join(root, '.release', 'changes', 'sessions.md'),
    '---\nimpact: patch\narea: sessions\naudience: users\nmilestone: v1\n---\n\nSessions are safer.\n',
  )
  fs.writeFileSync(path.join(root, 'helper.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
}

function createReleaseRepository(
  alterCandidate?: (root: string) => void,
): ReleaseRepository {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-release-tree-'))
  tempRoots.push(root)
  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'config', 'user.email', 'release-test@example.com')
  writeReleaseSources(root)
  git(root, 'add', '--all')
  git(root, 'update-index', '--chmod=+x', 'helper.sh')
  git(root, 'commit', '--date', BASE_DATE, '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD')
  const releaseDate = git(root, 'show', '-s', '--format=%as', base)

  prepareAppRelease(root, VERSION, releaseDate)
  git(root, 'add', '--all')
  alterCandidate?.(root)
  git(root, 'commit', '--date', CANDIDATE_DATE, '-m', `chore(release): v${VERSION}`)
  return { base, candidate: git(root, 'rev-parse', 'HEAD'), root }
}

function verifyFromBase(repository: ReleaseRepository) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-trusted-tree-'))
  tempRoots.push(container)
  const trustedRoot = path.join(container, 'checkout')
  git(repository.root, 'worktree', 'add', '--detach', trustedRoot, repository.base)
  try {
    return verifyGeneratedAppReleaseTree({
      candidateRef: repository.candidate,
      projectRoot: trustedRoot,
      version: VERSION,
    })
  } finally {
    git(repository.root, 'worktree', 'remove', '--force', trustedRoot)
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0).reverse()) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe('app release tree verification', () => {
  it('accepts the exact generated tree when the candidate commit date differs', () => {
    const repository = createReleaseRepository()

    expect(git(repository.root, 'show', '-s', '--format=%as', repository.candidate)).toBe(
      '2026-02-03',
    )
    const result = verifyFromBase(repository)
    expect(result.releaseDate).toBe('2026-01-02')
    expect(result.expectedTree).toBe(result.candidateTree)
  })

  it('rejects an extra same-parent candidate change', () => {
    const repository = createReleaseRepository((root) => {
      fs.writeFileSync(path.join(root, 'unexpected.txt'), 'not generated\n')
      git(root, 'add', 'unexpected.txt')
    })

    expect(git(repository.root, 'rev-parse', `${repository.candidate}^`)).toBe(
      repository.base,
    )
    expect(() => verifyFromBase(repository)).toThrow('does not match regenerated tree')
  })

  it('rejects equal content with a different executable mode', () => {
    const repository = createReleaseRepository((root) => {
      git(root, 'update-index', '--chmod=-x', 'helper.sh')
    })

    expect(() => verifyFromBase(repository)).toThrow('does not match regenerated tree')
  })
})
