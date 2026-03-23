/**
 * Reasoning models (GPT-5 family, o-series) reject temperature/topP parameters.
 */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-4])/.test(model)
}
