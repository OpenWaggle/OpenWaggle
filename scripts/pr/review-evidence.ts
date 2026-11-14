import { aiNotice, CODE_REVIEW_COMMENT_MARKER } from './managed-content'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const REVIEWED_SHA_LINE_PATTERN = /^reviewed-sha:\s*([0-9a-f]{40})\s*$/gm

/** Why `pr:ready` must refuse, or an empty list when the reviewed SHA is the current HEAD. */
export function reviewedShaViolations(input: {
  readonly headSha: string
  readonly prHeadSha: string
  readonly reviewedSha: string | undefined
}) {
  if (input.reviewedSha === undefined) {
    return ['Missing --reviewed-sha from a fresh-context independent review.']
  }
  if (!FULL_SHA_PATTERN.test(input.reviewedSha)) {
    return ['--reviewed-sha must be a full 40-character lowercase Git SHA.']
  }
  if (input.reviewedSha !== input.headSha) {
    return [
      `The review is stale: it covered ${input.reviewedSha}, HEAD is ${input.headSha}. Review again.`,
    ]
  }
  if (input.prHeadSha !== input.headSha) {
    return [
      `The PR head is ${input.prHeadSha}, local HEAD is ${input.headSha}. Push, then review again.`,
    ]
  }
  return []
}

/** Problems with the review evidence file; it must name the same SHA the flag does. */
export function reviewEvidenceViolations(evidence: string, reviewedSha: string) {
  if (evidence.trim().length === 0) {
    return ['The review evidence file is empty.']
  }
  const named = [...evidence.matchAll(REVIEWED_SHA_LINE_PATTERN)].map((match) => match[1])
  if (named.length === 0) {
    return ['The review evidence must contain a `reviewed-sha: <full sha>` line.']
  }
  if (named.some((sha) => sha !== reviewedSha)) {
    return [`The review evidence names a different SHA than --reviewed-sha ${reviewedSha}.`]
  }
  return []
}

export function renderReviewEvidenceComment(evidence: string) {
  return [aiNotice('ready'), '', evidence.trim(), '', CODE_REVIEW_COMMENT_MARKER, ''].join('\n')
}
