export const STORAGE_CONFIG = 'config'
export const STORAGE_STATE = 'state'
export const CONFIG_KEY = 'github.issues.config'
export const SUMMARY_KEY = 'github.issues.summary'

export const DEFAULT_CONFIG = {
  owner: 'OpenWaggle',
  repo: 'OpenWaggle',
  labels: ['enhancement', 'ready-for-agent'],
}

const GITHUB_API_ORIGIN = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const ISSUE_PAGE_SIZE = 100
const MAX_ISSUE_PAGES = 3
const STALE_ISSUE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const READY_LABEL = 'ready-for-agent'

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function labelName(value) {
  if (typeof value === 'string') {
    return value
  }

  const object = objectValue(value)
  return object && typeof object.name === 'string' ? object.name : null
}

function issueFromValue(value) {
  const object = objectValue(value)
  if (!object || object.pull_request || typeof object.updated_at !== 'string') {
    return null
  }

  return {
    updatedAt: object.updated_at,
    labels: Array.isArray(object.labels) ? object.labels.map(labelName).filter(Boolean) : [],
  }
}

function issuesUrl(config, page) {
  const owner = encodeURIComponent(config.owner)
  const repo = encodeURIComponent(config.repo)
  const url = new URL(`/repos/${owner}/${repo}/issues`, GITHUB_API_ORIGIN)
  url.searchParams.set('state', 'open')
  url.searchParams.set('per_page', String(ISSUE_PAGE_SIZE))
  url.searchParams.set('page', String(page))
  return url
}

async function errorBody(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function fetchIssuePage(config, page) {
  const response = await fetch(issuesUrl(config, page), {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  })

  if (!response.ok) {
    const body = await errorBody(response)
    throw new Error(`GitHub issues request failed with ${response.status}: ${body}`)
  }

  const payload = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error('GitHub issues response must be an array.')
  }

  return {
    rawCount: payload.length,
    issues: payload.map(issueFromValue).filter(Boolean),
  }
}

async function fetchOpenIssues(config) {
  const issues = []
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const pageResult = await fetchIssuePage(config, page)
    issues.push(...pageResult.issues)
    if (pageResult.rawCount < ISSUE_PAGE_SIZE) {
      break
    }
  }
  return issues
}

export function normalizeLabels(value) {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
}

export function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_CONFIG
  }

  const owner =
    typeof value.owner === 'string' && value.owner.trim() ? value.owner.trim() : 'OpenWaggle'
  const repo =
    typeof value.repo === 'string' && value.repo.trim() ? value.repo.trim() : 'OpenWaggle'
  const labels = Array.isArray(value.labels)
    ? value.labels
        .filter((label) => typeof label === 'string' && label.trim())
        .map((label) => label.trim())
    : DEFAULT_CONFIG.labels

  return { owner, repo, labels: labels.length > 0 ? labels : DEFAULT_CONFIG.labels }
}

export function normalizeSummary(value) {
  const object = objectValue(value)
  if (!object) {
    return null
  }

  return {
    repository:
      typeof object.repository === 'string'
        ? object.repository
        : `${DEFAULT_CONFIG.owner}/${DEFAULT_CONFIG.repo}`,
    open: typeof object.open === 'number' ? object.open : 0,
    stale: typeof object.stale === 'number' ? object.stale : 0,
    ready: typeof object.ready === 'number' ? object.ready : 0,
    labels: Array.isArray(object.labels)
      ? object.labels.filter((label) => typeof label === 'string')
      : DEFAULT_CONFIG.labels,
    updatedAt: typeof object.updatedAt === 'string' ? object.updatedAt : 'Not fetched yet',
  }
}

export async function fetchIssueSummary(config) {
  const normalizedConfig = normalizeConfig(config)
  const issues = await fetchOpenIssues(normalizedConfig)
  const staleBefore = Date.now() - STALE_ISSUE_AGE_MS
  const stale = issues.filter((issue) => Date.parse(issue.updatedAt) < staleBefore).length
  const ready = issues.filter((issue) =>
    issue.labels.some((label) => label.toLowerCase() === READY_LABEL),
  ).length

  return {
    repository: `${normalizedConfig.owner}/${normalizedConfig.repo}`,
    open: issues.length,
    stale,
    ready,
    labels: normalizedConfig.labels,
    updatedAt: `Updated from GitHub at ${new Date().toISOString()}`,
  }
}

function firstProjectPath(context) {
  return context.projectPaths[0] ?? null
}

function projectScope(context) {
  const projectPath = firstProjectPath(context)
  if (!projectPath) {
    throw new Error('GitHub Issues Overview fixture requires a project-scoped mount.')
  }
  return { kind: 'project', projectPath }
}

function packageStorage(context, storageKind) {
  return storageKind === STORAGE_CONFIG
    ? context.sdk.storage.packageConfig
    : context.sdk.storage.packageState
}

function storedResultValue(result) {
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

export async function getStoredValue(context, storageKind, key) {
  const value = await packageStorage(context, storageKind).project.get(projectScope(context), key)
  return storedResultValue(value).value
}

export async function setStoredValue(context, storageKind, key, value) {
  const result = await packageStorage(context, storageKind).project.set(
    projectScope(context),
    key,
    value,
  )
  return storedResultValue(result)
}
