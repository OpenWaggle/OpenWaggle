function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transcriptItems(jsonl: string) {
  return jsonl.split('\n').flatMap((line) => {
    if (!line) return []
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed) || !isRecord(parsed.record)) return []
    const streamRecord = parsed.record
    return streamRecord.record === 'item' && 'item' in streamRecord ? [streamRecord.item] : []
  })
}

function recordInvokedSkill(value: unknown, skillId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => recordInvokedSkill(entry, skillId))
  if (!isRecord(value)) return false
  const marker = [value.type, value.kind]
    .filter((entry): entry is string => typeof entry === 'string')
    .join('-')
    .toLowerCase()
    .replaceAll(/[^a-z]/g, '')
  if (marker.includes('tool') && JSON.stringify(value).includes(skillId)) return true
  return Object.values(value).some((entry) => recordInvokedSkill(entry, skillId))
}

export function transcriptInvokedSkill(jsonl: string, skillId: string) {
  return transcriptItems(jsonl).some((item) => recordInvokedSkill(item, skillId))
}

function isSessionsSpawnToolCall(value: Record<string, unknown>) {
  if (value.type === 'toolCall' && value.name === 'sessions' && isRecord(value.arguments)) {
    return value.arguments.action === 'spawn' || value.arguments.operation === 'spawn'
  }
  if (value.type === 'tool-call' && isRecord(value.toolCall)) {
    return (
      value.toolCall.name === 'sessions' &&
      isRecord(value.toolCall.args) &&
      (value.toolCall.args.action === 'spawn' || value.toolCall.args.operation === 'spawn')
    )
  }
  return false
}

function recordInvokedSessionsSpawn(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(recordInvokedSessionsSpawn)
  if (!isRecord(value)) return false
  if (isSessionsSpawnToolCall(value)) return true
  return Object.values(value).some(recordInvokedSessionsSpawn)
}

export function transcriptInvokedSessionsSpawn(jsonl: string) {
  return transcriptItems(jsonl).some(recordInvokedSessionsSpawn)
}
