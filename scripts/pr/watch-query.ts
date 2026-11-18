/** GraphQL documents `pr:watch` sends through `gh api graphql`. One query per poll, plus pages. */

const ACTOR = 'author { __typename login }'
const REACTIONS =
  'reactionGroups { content reactors(first: 20) { nodes { __typename ... on Bot { login } ... on User { login } } } }'
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'

export const THREAD_NODE = `id isResolved isOutdated path line
  comments(first: 50) { nodes { databaseId ${ACTOR} body createdAt url } }`
export const COMMENT_NODE = `databaseId ${ACTOR} body createdAt updatedAt url ${REACTIONS}`
export const REVIEW_NODE = `databaseId ${ACTOR} state body commit { oid } submittedAt url`

const CHECKS = `commits(last: 1) { nodes { commit { oid
  checkSuites(first: 50) { nodes {
    app { slug }
    workflowRun { databaseId workflow { name } }
    checkRuns(first: 100, filterBy: { checkType: ALL }) { nodes {
      databaseId name status conclusion detailsUrl isRequired(pullRequestNumber: $number)
    } }
  } }
  status { contexts { context state targetUrl isRequired(pullRequestNumber: $number) } }
} } }`

export const SNAPSHOT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    number url state isDraft headRefOid reviewDecision
    ${REACTIONS}
    reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on Bot { login } ... on User { login } } } }
    ${CHECKS}
    reviewThreads(first: 100) { ${PAGE_INFO} nodes { ${THREAD_NODE} } }
    comments(first: 100) { ${PAGE_INFO} nodes { ${COMMENT_NODE} } }
    reviews(first: 100) { ${PAGE_INFO} nodes { ${REVIEW_NODE} } }
  } }
}`

/** A follow-up page of one PR connection (`reviewThreads`, `comments` or `reviews`). */
export function pageQuery(connection: string, node: string) {
  return `query($owner: String!, $name: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    ${connection}(first: 100, after: $after) { ${PAGE_INFO} nodes { ${node} } }
  } }
}`
}
