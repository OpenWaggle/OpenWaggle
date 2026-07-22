import { DEFAULT_CONFIG, fetchIssueSummary, normalizeConfig } from '../../modules/github-api.js'

const TOOL_NAME = 'openwaggle.github.listIssues'
const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    owner: { type: 'string', description: 'GitHub repository owner.' },
    repo: { type: 'string', description: 'GitHub repository name.' },
    labels: {
      type: 'array',
      items: { type: 'string' },
      description: 'Labels to track in UI.',
    },
  },
  additionalProperties: false,
}

function summaryText(summary) {
  const issueRows = summary.issues
    .slice(0, 5)
    .map((issue) => `#${issue.number} ${issue.title}`)
    .join('\n')
  const header = `${summary.repository}: ${summary.open} open, ${summary.ready} ready-for-agent, ${summary.stale} stale`
  return issueRows.length > 0 ? `${header}\n${issueRows}` : header
}

export default function registerGithubIssuesTool(pi) {
  pi.registerTool({
    name: TOOL_NAME,
    label: 'List GitHub issues',
    description: 'Fetch open GitHub issues for a repository and return counts plus recent rows.',
    promptSnippet: `${TOOL_NAME}: list open GitHub issues for a repository.`,
    parameters: TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const summary = await fetchIssueSummary(
        normalizeConfig({
          owner: params.owner ?? DEFAULT_CONFIG.owner,
          repo: params.repo ?? DEFAULT_CONFIG.repo,
          labels: params.labels ?? DEFAULT_CONFIG.labels,
        }),
      )

      return {
        content: [{ type: 'text', text: summaryText(summary) }],
        details: summary,
      }
    },
  })
}
