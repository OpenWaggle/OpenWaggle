import { DefaultChangelogNotes } from 'release-please/build/src/changelog-notes/default.js'
import { parseConventionalCommits } from 'release-please/build/src/commit.js'
import {
  type Logger,
  logger as releasePleaseLogger,
  setLogger,
} from 'release-please/build/src/util/logger.js'
import { PullRequestTitle } from 'release-please/build/src/util/pull-request-title.js'

import { hasPackageReleaseIntent } from './check-conventional-commits'
import { extractPackageReleaseNotes } from './package-release-artifacts'

const FIXTURE_BRANCH = 'main'
const FIXTURE_CURRENT_TAG = 'extension-sdk-v0.1.1'
const FIXTURE_PREVIOUS_TAG = 'extension-sdk-v0.1.0'
const FIXTURE_VERSION = '0.1.1'
const discardLog: Logger['warn'] = () => undefined
const QUIET_LOGGER: Logger = {
  debug: discardLog,
  error: discardLog,
  info: discardLog,
  trace: discardLog,
  warn: discardLog,
}

function generateReleasePleaseTitle(titlePattern: string) {
  const previousLogger = releasePleaseLogger
  setLogger(QUIET_LOGGER)
  try {
    return PullRequestTitle.ofTargetBranch(FIXTURE_BRANCH, titlePattern).toString()
  } finally {
    setLogger(previousLogger)
  }
}

export async function validateReleasePleaseRuntimeContract(titlePattern: string) {
  const violations: string[] = []
  const title = generateReleasePleaseTitle(titlePattern)
  const parsedTitle = PullRequestTitle.parse(title, titlePattern, false, QUIET_LOGGER)
  if (
    !hasPackageReleaseIntent(title) ||
    parsedTitle?.getTargetBranch() !== FIXTURE_BRANCH
  ) {
    violations.push(`Pinned Release Please generated an incompatible pull request title: ${title}.`)
  }

  const commits = parseConventionalCommits([
    {
      message: 'fix(packages): validate generated release output',
      sha: '0123456789abcdef0123456789abcdef01234567',
    },
  ])
  const generatedNotes = await new DefaultChangelogNotes().buildNotes(commits, {
    currentTag: FIXTURE_CURRENT_TAG,
    owner: 'OpenWaggle',
    previousTag: FIXTURE_PREVIOUS_TAG,
    repository: 'OpenWaggle',
    targetBranch: FIXTURE_BRANCH,
    version: FIXTURE_VERSION,
  })
  const changelog = `# Changelog\n\n${generatedNotes}\n\n## 0.1.0\n\nInitial release.\n`
  if (extractPackageReleaseNotes(changelog, FIXTURE_VERSION) !== generatedNotes) {
    violations.push('Package artifact preparation cannot read pinned Release Please changelog output.')
  }

  return violations
}
