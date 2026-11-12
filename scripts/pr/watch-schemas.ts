import { Schema } from 'effect'

/** Shapes of the `gh api graphql` responses `pr:watch` reads; extra fields are ignored. */

const Nullish = <A, I>(schema: Schema.Schema<A, I>) =>
  Schema.optionalWith(Schema.NullOr(schema), { exact: true })

const ActorSchema = Schema.Struct({ __typename: Schema.String, login: Schema.String })
export const PageInfoSchema = Schema.Struct({
  endCursor: Nullish(Schema.String),
  hasNextPage: Schema.Boolean,
})
const ReactionGroupSchema = Schema.Struct({
  content: Schema.String,
  reactors: Schema.Struct({
    nodes: Schema.Array(
      Schema.NullOr(Schema.Struct({ login: Schema.optionalWith(Schema.String, { exact: true }) })),
    ),
  }),
})
export const ThreadSchema = Schema.Struct({
  comments: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        author: Nullish(ActorSchema),
        body: Schema.String,
        createdAt: Schema.String,
        databaseId: Schema.Number,
        url: Schema.String,
      }),
    ),
  }),
  id: Schema.String,
  isOutdated: Schema.Boolean,
  isResolved: Schema.Boolean,
  line: Nullish(Schema.Number),
  path: Schema.String,
})
export const CommentSchema = Schema.Struct({
  author: Nullish(ActorSchema),
  body: Schema.String,
  createdAt: Schema.String,
  databaseId: Schema.Number,
  reactionGroups: Nullish(Schema.Array(ReactionGroupSchema)),
  updatedAt: Schema.String,
  url: Schema.String,
})
export const ReviewSchema = Schema.Struct({
  author: Nullish(ActorSchema),
  body: Schema.String,
  commit: Nullish(Schema.Struct({ oid: Schema.String })),
  databaseId: Schema.Number,
  state: Schema.String,
  submittedAt: Nullish(Schema.String),
  url: Schema.String,
})
const CheckRunSchema = Schema.Struct({
  conclusion: Nullish(Schema.String),
  databaseId: Schema.Number,
  detailsUrl: Nullish(Schema.String),
  isRequired: Schema.Boolean,
  name: Schema.String,
  status: Schema.String,
})
const CheckSuiteSchema = Schema.Struct({
  app: Nullish(Schema.Struct({ slug: Schema.String })),
  checkRuns: Nullish(Schema.Struct({ nodes: Schema.Array(CheckRunSchema) })),
  workflowRun: Nullish(
    Schema.Struct({ databaseId: Schema.Number, workflow: Schema.Struct({ name: Schema.String }) }),
  ),
})
const StatusContextSchema = Schema.Struct({
  context: Schema.String,
  isRequired: Schema.Boolean,
  state: Schema.String,
  targetUrl: Nullish(Schema.String),
})

export function connectionSchema<A, I>(node: Schema.Schema<A, I>) {
  return Schema.Struct({ nodes: Schema.Array(node), pageInfo: PageInfoSchema })
}

export const HeadCommitSchema = Schema.Struct({
  checkSuites: Nullish(Schema.Struct({ nodes: Schema.Array(CheckSuiteSchema) })),
  oid: Schema.String,
  status: Nullish(Schema.Struct({ contexts: Schema.Array(StatusContextSchema) })),
})

export const SnapshotSchema = Schema.Struct({
  repository: Schema.Struct({
    pullRequest: Schema.Struct({
      comments: connectionSchema(CommentSchema),
      commits: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ commit: HeadCommitSchema })) }),
      headRefOid: Schema.String,
      isDraft: Schema.Boolean,
      number: Schema.Number,
      reactionGroups: Nullish(Schema.Array(ReactionGroupSchema)),
      reviewDecision: Nullish(Schema.String),
      reviewRequests: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            requestedReviewer: Nullish(
              Schema.Struct({
                __typename: Schema.String,
                login: Schema.optionalWith(Schema.String, { exact: true }),
              }),
            ),
          }),
        ),
      }),
      reviewThreads: connectionSchema(ThreadSchema),
      reviews: connectionSchema(ReviewSchema),
      state: Schema.String,
      url: Schema.String,
    }),
  }),
  viewer: Schema.Struct({ login: Schema.String }),
})

export const GraphqlResponseSchema = Schema.Struct({ data: Schema.Unknown })
