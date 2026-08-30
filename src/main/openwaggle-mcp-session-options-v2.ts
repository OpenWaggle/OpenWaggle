import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-v2'

function add(options: Map<string, string[]>, name: string, value: unknown) {
  if (value === undefined || value === false) return
  options.set(name, [value === true ? 'true' : String(value)])
}

function append(options: Map<string, string[]>, name: string, values: readonly string[]) {
  for (const value of values) options.set(name, [...(options.get(name) ?? []), value])
}

function addBaseOptions(options: Map<string, string[]>, input: SessionToolInputV2) {
  for (const [name, value] of [
    [
      'project',
      input.operation === 'create' || input.operation === 'launch' ? undefined : input.projectPath,
    ],
    ['title', input.operation === 'rename' ? undefined : input.title],
    ['expected-run', input.expectedRunId],
    ['queue-revision', input.queueRevision],
    ['workspace', input.workspace],
    ['workspace-id', input.workspaceId],
    ['base-ref', input.baseRef],
    ['start-from-origin', input.startFromOrigin],
    ['target-node', input.targetNodeId],
    ['position', input.forkPosition],
    ['agent', input.agent],
    ['model', input.model],
    ['thinking', input.thinking],
    ['limit', input.limit],
    ['cursor', input.cursor],
    ['after', input.afterCreatedOrder],
    ['run', input.operation === 'items' ? input.runId : undefined],
    ['condition', input.condition],
    ['after-state-revision', input.afterStateRevision],
    ['timeout-ms', input.timeoutMs],
    ['interaction-timeout-ms', input.interactionTimeoutMs],
    ['full-transcript', input.fullTranscript],
    ['include-archived', input.includeArchived],
    ['include-bodies', input.includeBodies],
    ['include-queue-bodies', input.includeQueueBodies],
    ['scope', input.branchScope],
    ['branch', input.branchId],
    ['format', input.exportFormat],
    ['overwrite', input.overwriteExisting],
    ['mode', input.searchMode],
    ['require-fresh', input.requireFresh],
    ['all', input.catalogScope === 'all'],
    ['archived', input.archived],
    ['yolo', input.yolo],
    ['authorization', input.runAuthorizationOverride],
    ['idempotency-key', input.idempotencyKey],
    ['parent', input.parentSessionId],
    ['worker', input.workerSessionId],
    ['delegation', input.operation === 'delegations-conflicts' ? input.delegationId : undefined],
    ['approve', input.operation === 'approval-respond'],
  ] as const)
    add(options, name, value)
  if (input.interactionResponse)
    add(options, 'response-json', JSON.stringify(input.interactionResponse))
}

function addCollaborationOptions(options: Map<string, string[]>, input: SessionToolInputV2) {
  add(options, 'upstream', input.reportTarget === 'upstream')
  add(options, 'queen', input.reportTarget === 'queen')
  add(options, 'worker', input.workerReference)
  add(options, 'source-run', input.sourceRunId)
  add(options, 'request-reply', input.requestReply)
  add(options, 'reply-to', input.replyToReportId)
  if (input.reportTarget === 'session' || input.reportTarget === 'sessions') {
    append(options, 'target', input.targetSessionIds ?? [])
  }
  append(
    options,
    'evidence-json',
    (input.evidence ?? []).map((item) => JSON.stringify(item)),
  )
  if (input.delegationSpecification) {
    add(options, 'specification-json', JSON.stringify(input.delegationSpecification))
  }
  add(options, 'proposal', input.proposalId)
  append(
    options,
    'claim-json',
    (input.claims ?? []).map((item) => JSON.stringify(item)),
  )
  if (!input.revisedSpecification) return
  add(options, 'revised-objective', input.revisedSpecification.objective)
  append(options, 'deliverable', input.revisedSpecification.deliverables)
  append(options, 'accept', input.revisedSpecification.acceptanceCriteria)
  append(options, 'resource', input.revisedSpecification.resourceReferences)
}

function commandFor(operation: SessionToolInputV2['operation']) {
  if (operation.startsWith('queue-')) return 'queue'
  if (
    operation === 'requests-list' ||
    operation === 'request-respond' ||
    operation === 'approval-respond'
  ) {
    return 'requests'
  }
  if (operation === 'authorization-set') return 'authorization'
  if (operation.startsWith('delegation-')) return 'delegation'
  if (operation.startsWith('export-') || operation.startsWith('exports-')) return 'export'
  return operation
}

export function mcpSessionCliOptionsV2(input: SessionToolInputV2, message?: string) {
  const options = new Map<string, string[]>()
  addBaseOptions(options, input)
  addCollaborationOptions(options, input)
  append(options, 'deliverable', input.deliverables ?? [])
  append(options, 'accept', input.acceptanceCriteria ?? [])
  append(options, 'state', input.states ?? [])
  append(options, 'kind', input.conflictKinds ?? [])
  append(options, 'status', input.conflictStatuses ?? [])
  append(options, 'status', input.exportStatuses ?? [])
  if (input.operation === 'spawn') append(options, 'resource', input.resourceReferences ?? [])
  if (input.operation === 'export-create') append(options, 'resource', input.exportResources ?? [])
  const messageOperations = new Set([
    'launch',
    'spawn',
    'message',
    'start',
    'follow-up',
    'steer',
    'replace',
    'report',
  ])
  if (message && messageOperations.has(input.operation)) add(options, 'text', message)
  return { command: commandFor(input.operation), options }
}
