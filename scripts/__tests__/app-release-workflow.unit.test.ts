import fs from 'node:fs'
import path from 'node:path'
import { assertMatching } from '@diegogbrisa/ts-match'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const PROJECT_ROOT = process.cwd()
const WORKFLOW = fs.readFileSync(
  path.join(PROJECT_ROOT, '.github/workflows/release.yml'),
  'utf8',
)
describe('desktop app release workflow', () => {
  it('grants write permissions only to orchestration and publication jobs', () => {
    const parsed: unknown = parse(WORKFLOW)

    assertMatching(
      {
        jobs: {
          release: { permissions: { contents: 'write' } },
          version: {
            permissions: {
              actions: 'write',
              contents: 'write',
              'pull-requests': 'write',
            },
          },
        },
        permissions: { contents: 'read' },
      },
      parsed,
    )
  })

  it('merges a validated version PR instead of bypassing main protection', () => {
    expect(WORKFLOW).not.toContain('git push origin main')
    expect(WORKFLOW).not.toContain('--admin')
    expect(WORKFLOW).toContain('git push origin "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('gh pr create')
    expect(WORKFLOW).toContain('gh workflow run ci.yml --ref "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('-f "head_sha=${HEAD_SHA}"')
    expect(WORKFLOW).toContain('gh run watch "$RUN_ID" --exit-status')
    expect(WORKFLOW).toContain('--match-head-commit "$HEAD_SHA"')
    expect(WORKFLOW).toContain('--squash')
  })

  it('tags only the verified protected merge commit', () => {
    expect(WORKFLOW).toContain('git merge-base --is-ancestor "$commit_sha" origin/main')
    expect(WORKFLOW).toContain(
      'test "$(git show -s --format=%s "$commit_sha")" = "chore(release): v${VERSION}"',
    )
    expect(WORKFLOW).toContain('git tag -a "$TAG" "$MERGE_SHA"')
    expect(WORKFLOW).toContain('git push origin "refs/tags/${TAG}"')
    expect(WORKFLOW).not.toContain('--follow-tags')
  })

  it('resumes compatible durable state and retries stale-base validation', () => {
    expect(WORKFLOW).toContain('gh pr list --state all --head "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts filter-prs')
    expect(WORKFLOW).toContain('if [ "$PR_STATE" = "MERGED" ]')
    expect(WORKFLOW).toContain('if [ "$MERGE_STATE" = "BEHIND" ]')
    expect(WORKFLOW).toContain('/update-branch')
    expect(WORKFLOW).toContain('for MERGE_ATTEMPT in $(seq 1 3)')
    expect(WORKFLOW).toContain('for STATE_ATTEMPT in $(seq 1 30)')
    expect(WORKFLOW).toContain('test "$(git rev-list -n 1 "$TAG")" = "$MERGE_SHA"')
    expect(WORKFLOW).toContain('verify_release_commit "$TAG_COMMIT"')
  })

  it('accepts no candidate package changes beyond the expected version', () => {
    expect(WORKFLOW).toContain('verify_version_only_tree()')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts expected-manifest')
    expect(WORKFLOW).toContain(
      'cmp "$RUNNER_TEMP/expected-package.json" "$RUNNER_TEMP/candidate-package.json"',
    )
    expect(WORKFLOW).toContain('verify_version_only_tree "$parent_sha" "$commit_sha"')
    expect(WORKFLOW).toContain(
      'verify_version_only_tree "origin/main" "origin/${RELEASE_BRANCH}"',
    )
  })

  it('skips release orchestration commits and increments prerelease versions', () => {
    expect(WORKFLOW).toContain(
      `if: "!startsWith(github.event.head_commit.message, 'chore(release):')"`,
    )
    expect(WORKFLOW).toContain('NEW_VERSION="${BASE_VERSION}-${PRERELEASE_TAG}.$((PRERELEASE_NUM + 1))"')
  })

  it('pins every referenced action to an immutable commit', () => {
    const actionReferences = [...WORKFLOW.matchAll(/\buses:\s*([^\s#]+)/gu)].map(
      (match) => match[1],
    )

    expect(actionReferences.length).toBeGreaterThan(0)
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u)
    }
  })
})
