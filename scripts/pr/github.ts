import { Schema } from 'effect'
import { commandOutput, parseJson, writeScratchFile } from './cli'

const PullRequestSchema = Schema.Struct({
  baseRefName: Schema.String,
  body: Schema.String,
  headRefOid: Schema.String,
  isDraft: Schema.Boolean,
  number: Schema.Number,
  state: Schema.String,
  url: Schema.String,
})

export type PullRequestInfo = typeof PullRequestSchema.Type

const CommentLineSchema = Schema.Struct({
  author: Schema.String,
  body: Schema.String,
  id: Schema.Number,
})
const SavedCommentSchema = Schema.Struct({ html_url: Schema.String, id: Schema.Number })

/** The PR for `selector` (number, URL or branch), else the current branch's PR. */
export function viewPullRequest(selector: string | undefined) {
  const output = commandOutput('gh', [
    'pr',
    'view',
    ...(selector === undefined ? [] : [selector]),
    '--json',
    'baseRefName,body,headRefOid,isDraft,number,state,url',
  ])
  return Schema.decodeUnknownSync(PullRequestSchema)(parseJson(output))
}

export function viewerLogin() {
  return commandOutput('gh', ['api', 'user', '--jq', '.login'])
}

export function listIssueComments(prNumber: number) {
  const output = commandOutput('gh', [
    'api',
    '--paginate',
    `repos/{owner}/{repo}/issues/${String(prNumber)}/comments?per_page=100`,
    '--jq',
    '.[] | {id, author: .user.login, body}',
  ])
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => Schema.decodeUnknownSync(CommentLineSchema)(parseJson(line)))
}

/** Creates the comment, or edits `existingId` in place; returns the comment URL. */
export function saveIssueComment(input: {
  readonly body: string
  readonly existingId: number | undefined
  readonly prNumber: number
  readonly scratchName: string
}) {
  const file = writeScratchFile(input.scratchName, input.body)
  const args =
    input.existingId === undefined
      ? [
          'api',
          '--method',
          'POST',
          `repos/{owner}/{repo}/issues/${String(input.prNumber)}/comments`,
        ]
      : [
          'api',
          '--method',
          'PATCH',
          `repos/{owner}/{repo}/issues/comments/${String(input.existingId)}`,
        ]
  const output = commandOutput('gh', [...args, '-F', `body=@${file}`])
  return Schema.decodeUnknownSync(SavedCommentSchema)(parseJson(output)).html_url
}

export function updatePullRequestBody(prNumber: number, body: string) {
  const file = writeScratchFile('body.md', body)
  commandOutput('gh', [
    'api',
    '--method',
    'PATCH',
    `repos/{owner}/{repo}/pulls/${String(prNumber)}`,
    '-F',
    `body=@${file}`,
    '--silent',
  ])
}
