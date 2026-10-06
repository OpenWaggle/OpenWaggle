import type { UIMessage } from '@shared/types/chat-ui'

/**
 * The display key of a rendered message: its role and text, as the Pi log names it. A persisted
 * tool result has none; it renders inside the assistant message that called the tool.
 */
export function messageKey(message: UIMessage) {
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.content] : []))
    .join(' ')
  if (!text && message.parts.every((part) => part.type === 'tool-result')) return null
  return `${message.role}:${text}`
}

/**
 * The order violations of a shown transcript against the Pi log: a message shown more often than
 * the log holds it, one the log does not hold, or one shown before a message the log has before
 * it. Each shown message stands for the first occurrence of its key after the previous one shown.
 * Messages the renderer cannot know yet (a Run's earlier answers after a renderer reload) may be
 * missing, never misplaced. A promoted steer Pi has not incorporated yet (`pending`) is delivered
 * after everything shown, so it ends the list.
 */
export function transcriptOrderViolations(
  shown: readonly string[],
  truth: readonly string[],
  pending: readonly string[] = [],
) {
  const truthCounts = countKeys(truth)
  // The pending previews end the list; one with a delivered message's text (a prompt) may repeat it.
  const pendingLeft = countKeys(pending)
  let end = shown.length
  for (let key = shown[end - 1]; key !== undefined && (pendingLeft.get(key) ?? 0) > 0; ) {
    pendingLeft.set(key, (pendingLeft.get(key) ?? 0) - 1)
    end -= 1
    key = shown[end - 1]
  }
  const delivered = shown.slice(0, end)
  const deliveredCounts = countKeys(delivered)
  const misplaced = [...pendingLeft].some(
    ([key, left]) => left > 0 && (deliveredCounts.get(key) ?? 0) > (truthCounts.get(key) ?? 0),
  )
  if (misplaced) return [`a pending steer is not last: ${shown.join(' | ')}`]
  const shownCounts = new Map<string, number>()
  const violations: string[] = []
  let previous = -1
  for (const key of delivered) {
    const count = (shownCounts.get(key) ?? 0) + 1
    shownCounts.set(key, count)
    const inLog = truthCounts.get(key) ?? 0
    if (inLog === 0) {
      violations.push(`not in the log: ${key}`)
      continue
    }
    if (count > inLog) {
      violations.push(`shown twice: ${key}`)
      continue
    }
    const index = truth.indexOf(key, previous + 1)
    if (index < 0) {
      violations.push(`out of order: ${key}`)
      continue
    }
    previous = index
  }
  return violations
}

function countKeys(keys: readonly string[]) {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}
