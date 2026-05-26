export interface WaggleConsensusSignal {
  readonly type: 'explicit-agreement' | 'no-new-information' | 'action-convergence' | 'turn-limit'
  readonly confidence: number
  readonly reason: string
}

export interface WaggleConsensusCheckResult {
  readonly reached: boolean
  readonly confidence: number
  readonly reason: string
  readonly signals: readonly WaggleConsensusSignal[]
}

const CONFIDENCE_THRESHOLD = 0.8
const NO_CONFIDENCE = 0
const PERCENT_BASE = 100
const CONSENSUS_THRESHOLD = 0.7
const EXPLICIT_AGREEMENT_CONFIDENCE = 0.9
const CONTENT_SIMILARITY_CONFIDENCE = 0.7
const SHRINKING_RESPONSE_CONFIDENCE = 0.6
const TURN_LIMIT_CONFIDENCE = 0.5
const JACCARD_SIMILARITY_THRESHOLD = 0.6
const SHRINKING_RATIO_THRESHOLD = 0.4
const SHRINKING_MIN_LENGTH = 100
const TURN_LIMIT_ACTIVATION = 0.75
const MIN_SENTENCE_LENGTH = 10
const AGREEMENT_SHORT_MESSAGE_THRESHOLD = 500
const AGREEMENT_LONG_MESSAGE_CONFIDENCE = 0.5
const MIN_SUBSTANTIVE_LENGTH = 20

const AGREEMENT_PHRASES = [
  'i agree',
  'agreed',
  'looks good',
  'lgtm',
  'nothing to add',
  'no further changes',
  'no additional changes',
  'that covers it',
  'well said',
  'exactly right',
  'i concur',
  'that looks correct',
  'no objections',
  'sounds good',
  'i think we are aligned',
  'we are aligned',
  'good to go',
  'ship it',
  'no issues found',
] as const

export function evaluateConsensus(
  signals: readonly WaggleConsensusSignal[],
): WaggleConsensusCheckResult {
  const strongest = signals.reduce<WaggleConsensusSignal | null>((best, signal) => {
    if (!best || signal.confidence > best.confidence) {
      return signal
    }
    return best
  }, null)

  if (!strongest) {
    return {
      reached: false,
      confidence: NO_CONFIDENCE,
      reason: 'No consensus signals were observed.',
      signals,
    }
  }

  return {
    reached: strongest.confidence >= CONFIDENCE_THRESHOLD,
    confidence: strongest.confidence,
    reason: strongest.reason,
    signals,
  }
}

export function checkConsensus(
  lastTwoMessages: readonly [string, string],
  totalTurns: number,
  maxTurns: number,
): WaggleConsensusCheckResult {
  const [previousText, currentText] = lastTwoMessages

  if (
    previousText.trim().length < MIN_SUBSTANTIVE_LENGTH ||
    currentText.trim().length < MIN_SUBSTANTIVE_LENGTH
  ) {
    return {
      reached: false,
      confidence: 0,
      reason: 'Insufficient content for consensus check',
      signals: [],
    }
  }

  const signals: WaggleConsensusSignal[] = []

  const explicitSignal = checkExplicitAgreement(currentText)
  if (explicitSignal) {
    signals.push(explicitSignal)
  }

  const similaritySignal = checkContentSimilarity(previousText, currentText)
  if (similaritySignal) {
    signals.push(similaritySignal)
  }

  const shrinkingSignal = checkShrinkingResponse(previousText, currentText)
  if (shrinkingSignal) {
    signals.push(shrinkingSignal)
  }

  if (totalTurns > maxTurns * TURN_LIMIT_ACTIVATION) {
    signals.push({
      type: 'turn-limit',
      confidence: TURN_LIMIT_CONFIDENCE,
      reason: `Approaching turn limit (${String(totalTurns)}/${String(maxTurns)})`,
    })
  }

  if (signals.length === 0) {
    return { reached: false, confidence: 0, reason: 'No consensus signals detected', signals: [] }
  }

  const totalWeight = signals.reduce((sum, signal) => sum + signal.confidence, 0)
  const averageConfidence = totalWeight / signals.length
  const topSignal = signals.reduce((left, right) =>
    left.confidence >= right.confidence ? left : right,
  )
  const reached = averageConfidence >= CONSENSUS_THRESHOLD

  return {
    reached,
    confidence: Math.round(averageConfidence * PERCENT_BASE) / PERCENT_BASE,
    reason: reached ? topSignal.reason : 'Insufficient consensus signals',
    signals,
  }
}

function checkExplicitAgreement(text: string): WaggleConsensusSignal | null {
  const lower = text.toLowerCase()
  for (const phrase of AGREEMENT_PHRASES) {
    if (!lower.includes(phrase)) {
      continue
    }

    const confidence =
      text.trim().length <= AGREEMENT_SHORT_MESSAGE_THRESHOLD
        ? EXPLICIT_AGREEMENT_CONFIDENCE
        : AGREEMENT_LONG_MESSAGE_CONFIDENCE
    return {
      type: 'explicit-agreement',
      confidence,
      reason: `Explicit agreement detected: "${phrase}"`,
    }
  }

  return null
}

function checkContentSimilarity(
  previousText: string,
  currentText: string,
): WaggleConsensusSignal | null {
  const previousSentences = extractSentences(previousText)
  const currentSentences = extractSentences(currentText)
  if (previousSentences.size === 0 || currentSentences.size === 0) {
    return null
  }

  const intersection = new Set(
    [...previousSentences].filter((sentence) => currentSentences.has(sentence)),
  )
  const union = new Set([...previousSentences, ...currentSentences])
  if (union.size === 0) {
    return null
  }

  const jaccard = intersection.size / union.size
  if (jaccard <= JACCARD_SIMILARITY_THRESHOLD) {
    return null
  }

  return {
    type: 'no-new-information',
    confidence: CONTENT_SIMILARITY_CONFIDENCE,
    reason: `High content overlap (Jaccard: ${String(Math.round(jaccard * PERCENT_BASE))}%)`,
  }
}

function checkShrinkingResponse(
  previousText: string,
  currentText: string,
): WaggleConsensusSignal | null {
  const previousLength = previousText.trim().length
  const currentLength = currentText.trim().length
  if (
    previousLength <= SHRINKING_MIN_LENGTH ||
    currentLength <= 0 ||
    currentLength >= previousLength * SHRINKING_RATIO_THRESHOLD
  ) {
    return null
  }

  return {
    type: 'no-new-information',
    confidence: SHRINKING_RESPONSE_CONFIDENCE,
    reason: 'Response significantly shorter than previous turn',
  }
}

function extractSentences(text: string) {
  return new Set(
    text
      .split(/[.!?\n]+/)
      .map((segment) => segment.trim().toLowerCase())
      .filter((segment) => segment.length > MIN_SENTENCE_LENGTH),
  )
}
