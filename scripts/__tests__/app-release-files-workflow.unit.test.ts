import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// How release.yml writes and verifies a release PR's package.json and CHANGELOG.md
// (scripts/app-release-tree.ts). The sync and train integration tests run these steps.
const WORKFLOW = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8')
const CI_WORKFLOW = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

describe('desktop app release files in the release workflow', () => {
  it('accepts no candidate changes beyond the generated version and CHANGELOG entry', () => {
    expect(WORKFLOW).toContain('verify_release_tree()')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts verify-release-tree')
    expect(WORKFLOW).toContain('verify_release_tree "$parent_sha" "$commit_sha"')
    // The exact check runs on the head whose CI is awaited, after any rewrite of the files.
    expect(WORKFLOW).toMatch(
      /push_release_head "\$RELEASE_COMMIT_SHA"\n\s+fi\n\s+verify_release_tree "\$MAIN_SHA" "\$HEAD_SHA"\n\n\s+RUN_ID=""/u,
    )
    // Before the files are written again, only the release files may differ, before and after
    // GitHub's merge of main.
    expect(WORKFLOW).toContain('--release-files-only')
    expect(WORKFLOW).toMatch(
      /continue\n\s+fi\n\s+verify_release_branch_base "\$MAIN_SHA" "\$HEAD_SHA"\n/u,
    )
  })

  it('fails CI on a release PR whose files are not the generated ones', () => {
    const commitPolicy = CI_WORKFLOW.slice(
      CI_WORKFLOW.indexOf('name: Commit Policy'),
      CI_WORKFLOW.indexOf('name: Typecheck & Lint'),
    )
    expect(commitPolicy).toContain("startsWith(github.head_ref, 'app-release-v')")
    expect(commitPolicy).toContain(
      'BASE_SHA=$(git merge-base "$HEAD_SHA" refs/remotes/origin/main)',
    )
    expect(commitPolicy).toContain('scripts/app-release-state.ts verify-release-tree')
    expect(commitPolicy).toContain(
      '--base "$BASE_SHA" --candidate "$HEAD_SHA" --version "$VERSION"',
    )
  })

  it('writes the release files in commits that change nothing else', () => {
    expect(WORKFLOW).toContain('scripts/app-release-state.ts release-commit')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts restore-release-files')
    expect(WORKFLOW).toContain(
      'git diff --quiet "$SYNC_BASE" "$MAIN_SHA" -- package.json CHANGELOG.md',
    )
    // A new branch starts from main; pushes never force.
    expect(WORKFLOW).toContain(
      'git push origin "${RELEASE_COMMIT_SHA}:refs/heads/${RELEASE_BRANCH}"',
    )
    expect(WORKFLOW).toContain('git push origin "${commit_sha}:refs/heads/${RELEASE_BRANCH}"')
    expect(WORKFLOW).not.toMatch(/git push[^\n]*(--force|\s\+)/u)
    expect(WORKFLOW).not.toContain('git switch')
  })
})
