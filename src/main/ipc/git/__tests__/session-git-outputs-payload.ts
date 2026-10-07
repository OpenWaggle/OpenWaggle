import type { GitRunStackedActionResult, SessionGitOutputsPayload } from '@shared/types/git'

/** The Outputs payload the Session Host records for a stacked action's result. */
export function outputsPayloadFor(
  result: GitRunStackedActionResult,
  occurrence: SessionGitOutputsPayload['occurrence'],
): SessionGitOutputsPayload {
  return {
    occurrence,
    ...(result.commit?.commitHash
      ? { commit: { commitHash: result.commit.commitHash, summary: result.commit.summary } }
      : {}),
    ...(result.ok && result.changeRequest
      ? { changeRequest: { title: result.changeRequest.title, url: result.changeRequest.url } }
      : {}),
  }
}
