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
const PNPM_WORKSPACE = fs.readFileSync(path.join(PROJECT_ROOT, 'pnpm-workspace.yaml'), 'utf8')
const PNPM_LOCK = fs.readFileSync(path.join(PROJECT_ROOT, 'pnpm-lock.yaml'), 'utf8')
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

  it('prepares candidate-derived assets without publication authority', () => {
    const preparationStart = WORKFLOW.indexOf('\n  prepare-release-assets:')
    const publicationStart = WORKFLOW.indexOf('\n  release:', preparationStart)
    const preparation = WORKFLOW.slice(preparationStart, publicationStart)
    const publication = WORKFLOW.slice(publicationStart)

    expect(preparationStart).toBeGreaterThan(0)
    expect(publicationStart).toBeGreaterThan(preparationStart)
    expect(preparation).not.toContain('contents: write')
    expect(preparation).toContain('persist-credentials: false')
    expect(preparation).toContain('generate-macos-update-metadata.ts')
    expect(publication).not.toContain('actions/checkout')
    expect(publication).not.toContain('\n        run:')
    expect(publication).not.toContain('generate-macos-update-metadata.ts')
  })

  it('leaves the validated version PR open for a maintainer to merge', () => {
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

  it('resumes compatible durable state and retries stale-base validation', () => {
    expect(WORKFLOW).toContain('gh pr list --state all --head "$RELEASE_BRANCH"')
    expect(WORKFLOW).toContain('scripts/app-release-state.ts filter-prs')
    expect(WORKFLOW).toContain('if [ "$PR_STATE" = "MERGED" ]')
    expect(WORKFLOW).toContain('if [ "$MERGE_STATE" = "BEHIND" ]')
    expect(WORKFLOW).toContain('/update-branch')
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

  it('separates PR preparation from protected-merge publication', () => {
    expect(WORKFLOW).toContain(
      `if: "!startsWith(github.event.head_commit.message, 'chore(release):')"`,
    )
    expect(WORKFLOW).toContain(
      'if [ "$RELEASE_SUBJECT_VERSION" = "$CURRENT_VERSION" ]',
    )
    expect(WORKFLOW).toContain('write_no_release_output')
    expect(WORKFLOW).toContain('write_release_outputs')
    expect(WORKFLOW).toContain(
      "group: \"${{ startsWith(github.event.head_commit.message, 'chore(release): v') && format('release-{0}', github.sha) || 'release-prepare' }}\"",
    )
    expect(WORKFLOW).toContain('cancel-in-progress: false')
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

  it('verifies the Windows installer through the typed deterministic verifier', () => {
    expect(WORKFLOW).toContain(
      'pnpm exec tsx scripts/verify-windows-installer.ts "$env:INSTALLER_PATH"',
    )
    expect(WORKFLOW).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(WORKFLOW).not.toContain('node scripts/verify-windows-installer.ts')
    expect(WORKFLOW).toContain("INSTALLER_PATH: ${{ runner.temp }}\\release\\windows\\openwaggle-")
    expect(WORKFLOW).not.toContain('Installed executable not found after silent install')
  })

  it('builds and smokes each macOS architecture only on a matching runner', () => {
    expect(WORKFLOW).toContain('os: macos-15-intel')
    expect(WORKFLOW).toContain('os: macos-15')
    expect(WORKFLOW).not.toContain('runs-on: macos-14')
    expect(WORKFLOW).toContain("test \"$(uname -m)\" = '${{ matrix.machine }}'")
    expect(WORKFLOW).toContain(
      'pnpm exec electron-builder --mac --${{ matrix.arch }} --publish never',
    )
    expect(WORKFLOW).not.toContain('electron-builder --mac --arm64 --x64')
    expect(WORKFLOW).toContain('name: macos-${{ matrix.arch }}-artifacts')
    expect(WORKFLOW).toContain(
      "node --no-warnings scripts/generate-macos-update-metadata.ts release '${{ needs.version.outputs.new_version }}'",
    )
    expect(WORKFLOW).toContain('node-version: 24.14.0')
    expect(WORKFLOW).toContain("'darwin',")
    expect(WORKFLOW).toContain('process.env.OPENWAGGLE_ONNX_ARCH')
    expect(WORKFLOW).toContain("'onnxruntime_binding.node'")
    expect(PNPM_WORKSPACE).toContain(
      '"@huggingface/transformers>onnxruntime-node": 1.23.2',
    )
    expect(PNPM_LOCK).toContain("'@huggingface/transformers>onnxruntime-node': 1.23.2")
    expect(PNPM_LOCK).toContain('onnxruntime-node: 1.23.2')
  })

  it('gates every platform artifact on packaged resources and production startup', () => {
    expect(WORKFLOW.match(/pnpm packaged-app:smoke --/gu)).toHaveLength(3)
    expect(WORKFLOW.match(/pnpm qa:packaged-session-host-startup --/gu)).toHaveLength(3)
    expect(WORKFLOW).toContain('dist/linux-unpacked/openwaggle')
    expect(WORKFLOW).toContain('dist/win-unpacked/OpenWaggle.exe')
    expect(WORKFLOW).toContain(
      'dist/${{ matrix.app_dir }}/OpenWaggle.app/Contents/MacOS/OpenWaggle',
    )
  })

  it('executes installed CLIs with isolated lifecycle cleanup on Linux and both Macs', () => {
    expect(WORKFLOW).toContain('artifact_name: macos-arm64-artifacts')
    expect(WORKFLOW).toContain('artifact_name: macos-x64-artifacts')
    expect(WORKFLOW).toContain('OPENWAGGLE_APPLICATIONS_DIR="$RUNNER_TEMP/Applications"')
    expect(WORKFLOW).toContain(
      'xvfb-run --auto-servernum pnpm exec tsx scripts/verify-installed-cli.ts',
    )
    expect(WORKFLOW).toContain(
      'pnpm exec tsx scripts/verify-installed-cli.ts "$HOME/.local/bin/openwaggle"',
    )
  })
})
