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

  it('leaves the validated release PR open for a maintainer to merge', () => {
    expect(WORKFLOW).not.toContain('git push origin main')
    expect(WORKFLOW).not.toContain('--admin')
    expect(WORKFLOW).not.toContain('gh pr merge')
    expect(WORKFLOW).not.toContain('enablePullRequestAutoMerge')
    expect(WORKFLOW).toContain('git push origin "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('gh pr create')
    expect(WORKFLOW).toContain('event=pull_request&branch=${RELEASE_BRANCH}')
    expect(WORKFLOW).toContain('gh run rerun "$RUN_ID"')
    expect(WORKFLOW).toContain('gh run watch "$RUN_ID" --exit-status')
    expect(WORKFLOW).not.toContain('gh workflow run ci.yml --ref "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('Release PR ready for maintainer review: ${PR_URL}')
    expect(WORKFLOW).toContain('A maintainer must merge this PR manually')
  })

  it('publishes only a verified human-merged release PR commit', () => {
    expect(WORKFLOW).toContain('git merge-base --is-ancestor "$commit_sha" origin/main')
    expect(WORKFLOW).toContain(
      'scripts/app-release-state.ts release-subject-version',
    )
    expect(WORKFLOW).toContain('repos/${GITHUB_REPOSITORY}/commits/${MERGE_SHA}/pulls')
    expect(WORKFLOW).toContain(
      'repos/${GITHUB_REPOSITORY}/pulls/${MATCHING_PR_NUMBER}',
    )
    expect(WORKFLOW).not.toContain('.[0].merged_by')
    expect(WORKFLOW).toContain(`test "$(jq -er '.merged_by.type' <<<"$MATCHING_PR")" = "User"`)
    expect(WORKFLOW).toContain(
      `test "$(jq -er '.merged_by.login' <<<"$MATCHING_PR")" != "github-actions[bot]"`,
    )
    expect(WORKFLOW).toContain('RELEASE_PR_HEAD_SHA=$(jq -er \'.head.sha\'')
    expect(WORKFLOW).toContain('.conclusion == "success"')
    expect(WORKFLOW).toContain('git tag -a "$TAG" "$MERGE_SHA"')
    expect(WORKFLOW).toContain('git push origin "refs/tags/${TAG}"')
    expect(WORKFLOW).not.toContain('--follow-tags')
  })

  it('regenerates one durable release branch from current main without merge commits', () => {
    expect(WORKFLOW).toContain('RELEASE_BRANCH="app-release"')
    expect(WORKFLOW).toContain('git switch --detach origin/main')
    expect(WORKFLOW).toContain('RELEASE_DATE=$(git show -s --format=%as "$BASE_SHA")')
    expect(WORKFLOW).toContain('gh pr list --state open --head "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts filter-prs')
    expect(WORKFLOW).toContain('--force-with-lease="refs/heads/${RELEASE_BRANCH}:${REMOTE_RELEASE_SHA}"')
    expect(WORKFLOW).toContain('= "$CANDIDATE_SHA"')
    expect(WORKFLOW).toContain('pnpm exec tsx scripts/app-release-intent-cli.ts prepare')
    expect(WORKFLOW).toContain('verify_generated_release_tree')
    expect(WORKFLOW).not.toContain('/update-branch')
    expect(WORKFLOW).toContain(
      'Main advanced; its queued preparation run will regenerate the release candidate.',
    )
    expect(WORKFLOW).toContain('for VALIDATION_ATTEMPT in $(seq 1 3)')
    expect(WORKFLOW).toContain('test "$(git rev-list -n 1 "$TAG")" = "$MERGE_SHA"')
    expect(WORKFLOW).toContain('its protected-merge run owns publication')
    expect(WORKFLOW).toContain('Release PR merged after validation')
  })

  it('recovers from transient and ambiguous GitHub PR creation failures', () => {
    expect(WORKFLOW).toContain('for PR_CREATE_ATTEMPT in $(seq 1 4)')
    expect(WORKFLOW).toContain('2>"$PR_CREATE_ERROR"')
    expect(WORKFLOW).toContain(
      'RECOVERY_ALL_PRS=$(gh pr list --state open --head "$RELEASE_BRANCH"',
    )
    expect(WORKFLOW).toContain('scripts/app-release-state.ts filter-prs')
    expect(WORKFLOW).toContain(
      'Adopted release PR after an ambiguous creation failure',
    )
    expect(WORKFLOW).toContain('sleep $((PR_CREATE_ATTEMPT * 5))')
    expect(WORKFLOW).toContain('test -n "$PR_URL"')
  })

  it('accepts only the fully regenerated release tree and the validated PR tree', () => {
    expect(WORKFLOW).toContain('git archive "$base_ref"')
    expect(WORKFLOW).toContain('git archive "$candidate_ref"')
    expect(WORKFLOW).toContain('diff -qr "$expected_root" "$candidate_root"')
    expect(WORKFLOW).toContain('test -z "$(git ls-tree -r --name-only "$commit_sha" .release/changes)"')
    expect(WORKFLOW).toContain('"${RELEASE_PR_HEAD_SHA}^{tree}"')
    expect(WORKFLOW).toContain('"${MERGE_SHA}^{tree}"')
  })

  it('separates PR preparation from protected-merge publication', () => {
    expect(WORKFLOW).toContain('scripts/app-release-intent-cli.ts plan')
    expect(WORKFLOW).not.toContain('Determine bump from conventional commits')
    expect(WORKFLOW).not.toContain("git log --format='%s'")
    expect(WORKFLOW).toContain(
      'if [ "$RELEASE_SUBJECT_VERSION" = "$CURRENT_VERSION" ]',
    )
    expect(WORKFLOW).toContain('write_no_release_output')
    expect(WORKFLOW).toContain('write_release_outputs')
    expect(WORKFLOW).toContain(
      "group: \"${{ startsWith(github.event.head_commit.message, 'chore(release): v') && format('release-{0}', github.sha) || 'release-prepare' }}\"",
    )
    expect(WORKFLOW).toContain('cancel-in-progress: false')
    expect(WORKFLOW).toContain('body_path: .release/release-notes.md')
    expect(WORKFLOW).not.toContain('generate_release_notes: true')
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

  it('verifies the Windows installer through the typed deterministic verifier', () => {
    expect(WORKFLOW).toContain(
      'pnpm exec tsx scripts/verify-windows-installer.ts "$env:INSTALLER_PATH"',
    )
    expect(WORKFLOW).toContain("INSTALLER_PATH: ${{ runner.temp }}\\release\\windows\\openwaggle-")
    expect(WORKFLOW).not.toContain('Installed executable not found after silent install')
  })

  it('installs and executes the documented macOS CLI shim under an isolated home', () => {
    expect(WORKFLOW).toContain('export OPENWAGGLE_APPLICATIONS_DIR="$RUNNER_TEMP/Applications"')
    expect(WORKFLOW).toContain('bash scripts/install.sh')
    expect(WORKFLOW).toContain('test -x "$HOME/.local/bin/openwaggle"')
    expect(WORKFLOW).toContain(
      'pnpm exec tsx scripts/verify-installed-cli.ts "$HOME/.local/bin/openwaggle"',
    )
    expect(WORKFLOW).not.toContain('scripts/verify-installed-cli.ts "$APP_BINARY"')
  })

  it('verifies each exact macOS installer on a matching supported architecture', () => {
    expect(WORKFLOW).toContain(
      "build-macos:\n    name: Build macOS\n    needs: version\n    if: needs.version.outputs.should_release == 'true'\n    runs-on: macos-15",
    )
    expect(WORKFLOW).not.toContain('macos-14')
    expect(WORKFLOW).toContain(
      'os: macos-15-intel\n            platform: macos\n            architecture: x64\n            expected_uname: x86_64',
    )
    expect(WORKFLOW).toContain(
      'os: macos-15\n            platform: macos\n            architecture: arm64\n            expected_uname: arm64',
    )
    expect(WORKFLOW).toContain(
      'DMG_NAME="openwaggle-${VERSION}-${{ matrix.architecture }}.dmg"',
    )
    expect(WORKFLOW).toContain(
      'ZIP_NAME="openwaggle-${VERSION}-${{ matrix.architecture }}.zip"',
    )
    expect(
      WORKFLOW.match(/test "\$\(uname -m\)" = "\$\{\{ matrix\.expected_uname \}\}"/gu),
    ).toHaveLength(2)
    expect(WORKFLOW).not.toContain('case "$(uname -m)" in')
  })

  it('runs packaged first-start and legacy-cutover smoke on every platform build', () => {
    expect(
      WORKFLOW.match(/pnpm qa:packaged-session-host-startup --/gu),
    ).toHaveLength(3)
    expect(WORKFLOW).toContain('dist/linux-unpacked/openwaggle')
    expect(WORKFLOW).toContain('dist\\win-unpacked\\OpenWaggle.exe')
    expect(WORKFLOW).toContain('$APP_ROOT/OpenWaggle.app/Contents/MacOS/OpenWaggle')
    expect(WORKFLOW).toContain(
      'architecture: x64\n            runner: macos-15-intel\n            expected_uname: x86_64',
    )
    expect(WORKFLOW).toContain(
      'architecture: arm64\n            runner: macos-15\n            expected_uname: arm64',
    )
    expect(WORKFLOW).toContain('test "$(uname -m)" = "${{ matrix.expected_uname }}"')
    expect(WORKFLOW).toContain('electron-builder --mac --arm64 --x64')
    expect(WORKFLOW).not.toContain('NATIVE_APP=')
    expect(WORKFLOW).toContain('needs: [version, smoke-macos, verify-installers]')
  })
})
