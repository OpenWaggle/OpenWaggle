import { Schema } from 'effect'
import { commandOutput, parseJson } from './cli'
import type {
  Actor,
  IssueComment,
  PullRequestState,
  Reaction,
  Review,
  ReviewThread,
} from './watch-model'
import { COMMENT_NODE, pageQuery, REVIEW_NODE, SNAPSHOT_QUERY, THREAD_NODE } from './watch-query'
import {
  CommentSchema,
  connectionSchema,
  GraphqlResponseSchema,
  type HeadCommitSchema,
  type PageInfoSchema,
  ReviewSchema,
  SnapshotSchema,
  ThreadSchema,
} from './watch-schemas'

type Variables = Readonly<Record<string, string>>
type ActorNode = { readonly __typename: string; readonly login: string } | null | undefined
type ReactionGroups = typeof SnapshotSchema.Type.repository.pullRequest.reactionGroups

const BOT_SUFFIX_PATTERN = /\[bot\]$/

/** `-F` fills gh's `{owner}`/`{repo}` placeholders and sends `number` as an Int; `-f` keeps a cursor raw. */
function graphql(query: string, variables: Variables) {
  const fields = Object.entries(variables).flatMap(([key, value]) => [
    key === 'after' ? '-f' : '-F',
    `${key}=${value}`,
  ])
  const output = commandOutput('gh', ['api', 'graphql', '-f', `query=${query}`, ...fields])
  return Schema.decodeUnknownSync(GraphqlResponseSchema)(parseJson(output)).data
}

function actor(node: ActorNode): Actor {
  return {
    isBot: node?.__typename === 'Bot',
    login: (node?.login ?? 'ghost').replace(BOT_SUFFIX_PATTERN, ''),
  }
}

function reactions(groups: ReactionGroups): Reaction[] {
  return (groups ?? [])
    .map((group) => ({
      content: group.content,
      logins: group.reactors.nodes.flatMap((node) =>
        node?.login === undefined ? [] : [node.login.replace(BOT_SUFFIX_PATTERN, '')],
      ),
    }))
    .filter((group) => group.logins.length > 0)
}

function toThread(node: typeof ThreadSchema.Type): ReviewThread {
  return {
    comments: node.comments.nodes.map((comment) => ({
      author: actor(comment.author),
      body: comment.body,
      createdAt: comment.createdAt,
      id: comment.databaseId,
      url: comment.url,
    })),
    id: node.id,
    isOutdated: node.isOutdated,
    isResolved: node.isResolved,
    line: node.line ?? undefined,
    path: node.path,
  }
}

function toComment(node: typeof CommentSchema.Type): IssueComment {
  return {
    author: actor(node.author),
    body: node.body,
    createdAt: node.createdAt,
    id: node.databaseId,
    reactions: reactions(node.reactionGroups),
    updatedAt: node.updatedAt,
    url: node.url,
  }
}

function toReview(node: typeof ReviewSchema.Type): Review {
  return {
    author: actor(node.author),
    body: node.body,
    commitSha: node.commit?.oid,
    id: node.databaseId,
    state: node.state,
    submittedAt: node.submittedAt ?? undefined,
    url: node.url,
  }
}

function checksOf(commit: typeof HeadCommitSchema.Type | undefined) {
  const checkRuns = (commit?.checkSuites?.nodes ?? []).flatMap((suite) =>
    (suite.checkRuns?.nodes ?? []).map((run) => ({
      appSlug: suite.app?.slug,
      conclusion: run.conclusion ?? undefined,
      id: run.databaseId,
      isRequired: run.isRequired,
      name: run.name,
      runId: suite.workflowRun?.databaseId,
      status: run.status,
      url: run.detailsUrl ?? undefined,
      workflowName: suite.workflowRun?.workflow.name,
    })),
  )
  const statusContexts = (commit?.status?.contexts ?? []).map((context) => ({
    context: context.context,
    isRequired: context.isRequired,
    state: context.state,
    url: context.targetUrl ?? undefined,
  }))
  return { checkRuns, statusContexts }
}

/** The nodes of one PR connection: the first page from the snapshot, then every later page. */
function allNodes<A, I>(input: {
  readonly first: { readonly nodes: readonly A[]; readonly pageInfo: typeof PageInfoSchema.Type }
  readonly name: string
  readonly node: string
  readonly schema: Schema.Schema<A, I>
  readonly variables: Variables
}) {
  const pageSchema = Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Record({ key: Schema.String, value: connectionSchema(input.schema) }),
    }),
  })
  const nodes = [...input.first.nodes]
  let pageInfo = input.first.pageInfo
  while (pageInfo.hasNextPage && typeof pageInfo.endCursor === 'string') {
    const data = graphql(pageQuery(input.name, input.node), {
      ...input.variables,
      after: pageInfo.endCursor,
    })
    const page = Schema.decodeUnknownSync(pageSchema)(data).repository.pullRequest[input.name]
    if (page === undefined) {
      break
    }
    nodes.push(...page.nodes)
    pageInfo = page.pageInfo
  }
  return nodes
}

/** Reads the PR state `pr:watch` needs: one query per poll, plus extra pages on long PRs. */
export function fetchPullRequestState(prNumber: number): PullRequestState {
  const variables = { name: '{repo}', number: String(prNumber), owner: '{owner}' }
  const data = Schema.decodeUnknownSync(SnapshotSchema)(graphql(SNAPSHOT_QUERY, variables))
  const pr = data.repository.pullRequest
  const threads = allNodes({
    first: pr.reviewThreads,
    name: 'reviewThreads',
    node: THREAD_NODE,
    schema: ThreadSchema,
    variables,
  })
  const comments = allNodes({
    first: pr.comments,
    name: 'comments',
    node: COMMENT_NODE,
    schema: CommentSchema,
    variables,
  })
  const reviews = allNodes({
    first: pr.reviews,
    name: 'reviews',
    node: REVIEW_NODE,
    schema: ReviewSchema,
    variables,
  })
  const head = pr.commits.nodes.find((node) => node.commit.oid === pr.headRefOid)?.commit
  return {
    ...checksOf(head),
    comments: comments.map(toComment),
    headSha: pr.headRefOid,
    isDraft: pr.isDraft,
    number: pr.number,
    reactions: reactions(pr.reactionGroups),
    reviewDecision: pr.reviewDecision ?? undefined,
    reviewRequests: pr.reviewRequests.nodes.flatMap(({ requestedReviewer: reviewer }) =>
      reviewer?.login === undefined
        ? []
        : [actor({ __typename: reviewer.__typename, login: reviewer.login })],
    ),
    reviews: reviews.map(toReview),
    state: pr.state,
    threads: threads.map(toThread),
    url: pr.url,
    viewer: data.viewer.login,
  }
}
