import { parseNameStatus, renderBlastRadius } from './blast-radius'
import { commandOutput, optionalCommandOutput, writeScratchFile } from './cli'
import {
  listIssueComments,
  type PullRequestInfo,
  saveIssueComment,
  updatePullRequestBody,
} from './github'
import {
  BLAST_RADIUS_COMMENT_MARKER,
  BLAST_RADIUS_SECTION_END,
  BLAST_RADIUS_SECTION_START,
  CODE_REVIEW_COMMENT_MARKER,
  findStickyComment,
  replaceManagedSection,
} from './managed-content'
import { renderReviewEvidenceComment } from './review-evidence'

const SHORT_SHA_LENGTH = 12

export function computeBlastRadius(input: { readonly base: string; readonly headSha: string }) {
  const mergeBase = commandOutput('git', ['merge-base', 'HEAD', `origin/${input.base}`])
  const range = `${mergeBase.slice(0, SHORT_SHA_LENGTH)}...${input.headSha.slice(0, SHORT_SHA_LENGTH)}`
  const changedFiles = parseNameStatus(
    commandOutput('git', [
      'diff',
      '--name-status',
      '--find-renames',
      `${mergeBase}...${input.headSha}`,
    ]),
  )
  const previous = optionalCommandOutput('git', ['show', `${mergeBase}:package.json`])
  const current = optionalCommandOutput('git', ['show', `${input.headSha}:package.json`])
  const result = renderBlastRadius({
    changedFiles,
    headSha: input.headSha,
    packageJson: {
      ...(previous === undefined ? {} : { previous }),
      ...(current === undefined ? {} : { current }),
    },
    range,
  })
  const reportPath = writeScratchFile('blast-radius.md', result.report)
  return { ...result, changedFileCount: changedFiles.length, reportPath }
}

/**
 * Writes the blast-radius comment, the managed PR body section and the review evidence comment.
 * Each comment is found again by its marker, so a rerun edits it instead of posting a duplicate.
 */
export function publishReadyRecord(input: {
  readonly blastRadius: ReturnType<typeof computeBlastRadius>
  readonly evidence: string
  readonly pr: PullRequestInfo
  readonly viewer: string
}) {
  const comments = listIssueComments(input.pr.number)
  const reportUrl = saveIssueComment({
    body: input.blastRadius.report,
    existingId: findStickyComment(comments, BLAST_RADIUS_COMMENT_MARKER, input.viewer)?.id,
    prNumber: input.pr.number,
    scratchName: 'blast-radius-comment.md',
  })
  updatePullRequestBody(
    input.pr.number,
    replaceManagedSection({
      body: input.pr.body,
      end: BLAST_RADIUS_SECTION_END,
      section: input.blastRadius.summary(reportUrl),
      start: BLAST_RADIUS_SECTION_START,
    }),
  )
  const reviewUrl = saveIssueComment({
    body: renderReviewEvidenceComment(input.evidence),
    existingId: findStickyComment(comments, CODE_REVIEW_COMMENT_MARKER, input.viewer)?.id,
    prNumber: input.pr.number,
    scratchName: 'code-review-comment.md',
  })
  return { reportUrl, reviewUrl }
}
