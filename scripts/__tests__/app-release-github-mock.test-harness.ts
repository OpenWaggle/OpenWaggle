import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { assertMatching, P } from '@diegogbrisa/ts-match'

const execFile = promisify(execFileCallback)

// Stands in for `gh`, `bun` and `sleep` in a release.yml step run against a local Git remote. The
// TEST_* variables describe the fixture; see app-release-sync.test-harness.ts and
// app-release-train.test-harness.ts.
const GITHUB_MOCK = String.raw`
bun() {
  case "$1" in
    scripts/app-release-state.ts|scripts/app-release-notes.ts) ;;
    *) echo "Unexpected bun command: $*" >&2; return 1 ;;
  esac
  local script="$1"
  shift
  command "$TEST_BUN" "$TEST_PROJECT_ROOT/$script" "$@"
}
fixture_advance_main() {
  if [ -n "$TEST_FUTURE_MAIN" ] && [ ! -f "$TEST_ADVANCED" ]; then
    git -C "$TEST_AUTHOR" push origin "$TEST_FUTURE_MAIN:refs/heads/main" >&2
    touch "$TEST_ADVANCED"
  fi
}
fixture_pr() {
  jq -nc --arg sha "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" \
    --arg branch "$TEST_BRANCH" --arg status "$TEST_MERGE_STATUS" \
    --arg state "$(if [ -f "$TEST_PR_CLOSED" ]; then echo CLOSED; else echo OPEN; fi)" \
    --arg version "$TEST_VERSION" \
    '{baseRefName:"main", headRefName:$branch, headRefOid:$sha,
      headRepository:{name:"OpenWaggle"}, headRepositoryOwner:{login:"OpenWaggle"},
      isCrossRepository:false, mergeCommit:null, number:221, state:$state,
      title:("chore(release): v" + $version), url:"https://example.test/pull/221",
      mergeStateStatus:$status}'
}
fixture_merged_pr() {
  jq -nc --arg sha "$GITHUB_SHA" --arg branch "$TEST_BRANCH" --arg repository "$GITHUB_REPOSITORY" \
    --arg head "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" --arg version "$TEST_VERSION" \
    '{number:301, state:"closed", merged_at:"2026-11-09T00:00:00Z", merge_commit_sha:$sha,
      base:{ref:"main"}, head:{ref:$branch, sha:$head, repo:{full_name:$repository}},
      title:("chore(release): v" + $version), merged_by:{type:"User", login:"maintainer"}}'
}
gh() {
  case "$1 $2" in
    'pr list')
      if [ -f "$TEST_PR_EXISTS" ]; then fixture_pr | jq -sc '.'; else echo '[]'; fi
      ;;
    'pr create')
      touch "$TEST_PR_EXISTS"
      echo 'create' >> "$TEST_EVENTS"
      echo 'https://example.test/pull/221'
      ;;
    'pr view')
      case "$*" in
        *'--jq .number') echo 221 ;;
        *'--jq .headRefOid') fixture_pr | jq -r '.headRefOid' ;;
        *) fixture_pr ;;
      esac
      ;;
    'api --method')
      test "$3" = 'PUT'
      if [ "$TEST_UPDATE_FAILS_ONCE" = 'true' ] && [ ! -f "$TEST_UPDATE_FAILED" ]; then
        touch "$TEST_UPDATE_FAILED"
        echo 'HTTP 502: Bad Gateway' >&2
        return 1
      fi
      test "$6" = "expected_head_sha=$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")"
      git -C "$TEST_AUTHOR" fetch origin main "$TEST_BRANCH" >&2
      git -C "$TEST_AUTHOR" switch -C "$TEST_BRANCH" "origin/$TEST_BRANCH" >&2
      git -C "$TEST_AUTHOR" merge --no-ff origin/main -m 'Merge main into release' >&2
      if [ "$TEST_TAMPER_ON_UPDATE" = 'true' ]; then
        echo 'unexpected change' > "$TEST_AUTHOR/unexpected.txt"
        git -C "$TEST_AUTHOR" add unexpected.txt
        git -C "$TEST_AUTHOR" commit -m 'chore: unexpected update change' >&2
      fi
      git -C "$TEST_AUTHOR" push origin "$TEST_BRANCH" >&2
      echo 'update' >> "$TEST_EVENTS"
      if [ "$TEST_ADVANCE_DURING" = 'update' ]; then fixture_advance_main; fi
      ;;
    'api --paginate')
      test "$3" = "repos/$GITHUB_REPOSITORY/releases?per_page=100"
      test "$4 $5" = "--jq .[] | {tag_name, draft}"
      echo 'releases' >> "$TEST_EVENTS"
      if [ "$TEST_RELEASES_UNREADABLE" = 'true' ]; then
        echo 'HTTP 502: Bad Gateway' >&2
        return 1
      fi
      cat "$TEST_RELEASES"
      ;;
    'api repos/'*)
      case "$2" in
        "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls") fixture_merged_pr | jq -sc '.' ;;
        "repos/$GITHUB_REPOSITORY/pulls/301") fixture_merged_pr ;;
        "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?"*)
          jq -nc --arg sha "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" \
            '{workflow_runs:[{head_sha:$sha,event:"pull_request",id:$sha,status:"completed",conclusion:"success"}]}'
          ;;
        *) echo "Unexpected gh api path: $2" >&2; return 1 ;;
      esac
      ;;
    'run view')
      jq -nc --arg sha "$3" \
        '{attempt:1,conclusion:"success",event:"pull_request",headSha:$sha,status:"completed"}'
      ;;
    'run watch')
      echo "ci $3" >> "$TEST_EVENTS"
      if [ "$TEST_ADVANCE_DURING" = 'ci' ]; then fixture_advance_main; fi
      if [ "$TEST_CLOSE_DURING_CI" = 'true' ]; then touch "$TEST_PR_CLOSED"; fi
      ;;
    *) echo "Unexpected gh command: $*" >&2; return 1 ;;
  esac
}
sleep() {
  echo 'Unexpected polling delay' >&2
  return 1
}
`

/** Runs one workflow step's script under the GitHub mock; a failing step resolves, not rejects. */
export function runStep(script: string, cwd: string, env: NodeJS.ProcessEnv) {
  return execFile('bash', ['-c', `${GITHUB_MOCK}\n${script}`], { cwd, env }).then(
    (output) => ({ succeeded: true, ...output }),
    (error: unknown) => {
      assertMatching({ stdout: P.string, stderr: P.string }, error)
      return { succeeded: false, stdout: error.stdout, stderr: error.stderr }
    },
  )
}
