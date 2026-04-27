import { PERCENT_BASE } from '@shared/constants/math'
import { CONSENSUS } from '@shared/constants/text-processing'
import type { WaggleConsensusCheckResult, WaggleConsensusSignal } from '@shared/types/waggle'

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
]

/**
 * Pure heuristic consensus detector — no LLM calls.
 * Checks the last two assistant messages for signs of agreement.
 */

export function checkConsensus(
  lastTwoMessages: readonly [string, string],
  totalTurns: number,
  maxTurns: number,
): WaggleConsensusCheckResult {
  const [previousText, currentText] = lastTwoMessages

  // Guard: don't declare consensus on empty or near-empty messages
  if (
    previousText.trim().length < CONSENSUS.MIN_SUBSTANTIVE_LENGTH ||
    currentText.trim().length < CONSENSUS.MIN_SUBSTANTIVE_LENGTH
  ) {
    return {
      reached: false,
      confidence: 0,
      reason: 'Insufficient content for consensus check',
      signals: [],
    }
  }

  const signals: WaggleConsensusSignal[] = []

  // Layer 1: Explicit agreement phrases
  const explicitSignal = checkExplicitAgreement(currentText)
  if (explicitSignal) signals.push(explicitSignal)

  // Layer 2: No new information (content similarity)
  const similaritySignal = checkContentSimilarity(previousText, currentText)
  if (similaritySignal) signals.push(similaritySignal)

  // Layer 3: Shrinking response heuristic
  const shrinkingSignal = checkShrinkingResponse(previousText, currentText)
  if (shrinkingSignal) signals.push(shrinkingSignal)

  // Layer 4: Turn limit soft signal (only near end)
  if (totalTurns > maxTurns * CONSENSUS.TURN_LIMIT_ACTIVATION) {
    signals.push({
      type: 'turn-limit',
      confidence: CONSENSUS.TURN_LIMIT_CONFIDENCE,
      reason: `Approaching turn limit (${String(totalTurns)}/${String(maxTurns)})`,
    })
  }

  if (signals.length === 0) {
    return { reached: false, confidence: 0, reason: 'No consensus signals detected', signals: [] }
  }

  // Weighted confidence aggregation
  const totalWeight = signals.reduce((sum, s) => sum + s.confidence, 0)
  const avgConfidence = totalWeight / signals.length

  const reached = avgConfidence >= CONSENSUS.THRESHOLD
  const topSignal = signals.reduce((a, b) => (a.confidence >= b.confidence ? a : b))

  return {
    reached,
    confidence: Math.round(avgConfidence * PERCENT_BASE) / PERCENT_BASE,
    reason: reached ? topSignal.reason : 'Insufficient consensus signals',
    signals,
  }
}

function checkExplicitAgreement(text: string): WaggleConsensusSignal | null {
  const lower = text.toLowerCase()
  for (const phrase of AGREEMENT_PHRASES) {
    if (lower.includes(phrase)) {
      // Long messages that happen to contain "I agree" are acknowledging
      // a point while continuing to develop new arguments — not full consensus.
      // Only give high confidence to short messages that are primarily agreement.
      const confidence =
        text.trim().length <= CONSENSUS.AGREEMENT_SHORT_MSG_THRESHOLD
          ? CONSENSUS.EXPLICIT_AGREEMENT_CONFIDENCE
          : CONSENSUS.AGREEMENT_LONG_MSG_CONFIDENCE
      return {
        type: 'explicit-agreement',
        confidence,
        reason: `Explicit agreement detected: "${phrase}"`,
      }
    }
  }
  return null
}

function checkContentSimilarity(text1: string, text2: string): WaggleConsensusSignal | null {
  const sentences1 = extractSentences(text1)
  const sentences2 = extractSentences(text2)

  if (sentences1.size === 0 || sentences2.size === 0) return null

  const intersection = new Set([...sentences1].filter((s) => sentences2.has(s)))
  const union = new Set([...sentences1, ...sentences2])

  if (union.size === 0) return null

  const jaccard = intersection.size / union.size

  if (jaccard > CONSENSUS.JACCARD_SIMILARITY_THRESHOLD) {
    return {
      type: 'no-new-information',
      confidence: CONSENSUS.CONTENT_SIMILARITY_CONFIDENCE,
      reason: `High content overlap (Jaccard: ${String(Math.round(jaccard * PERCENT_BASE))}%)`,
    }
  }
  return null
}

function checkShrinkingResponse(
  previousText: string,
  currentText: string,
): WaggleConsensusSignal | null {
  const prevLen = previousText.trim().length
  const currLen = currentText.trim().length

  // If current response is significantly shorter (< 40% of previous),
  // it suggests winding down
  if (
    prevLen > CONSENSUS.SHRINKING_MIN_LENGTH &&
    currLen > 0 &&
    currLen < prevLen * CONSENSUS.SHRINKING_RATIO_THRESHOLD
  ) {
    return {
      type: 'no-new-information',
      confidence: CONSENSUS.SHRINKING_RESPONSE_CONFIDENCE,
      reason: 'Response significantly shorter than previous turn',
    }
  }
  return null
}

function extractSentences(text: string): Set<string> {
  return new Set(
    text
      .split(/[.!?\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > CONSENSUS.MIN_SENTENCE_LENGTH),
  )
}
