/**
 * Provider icons sourced from svg-logos/ (committed to repo).
 * Source of truth: src/renderer/src/assets/provider-logos/
 * Original SVGs from https://lobehub.com/icons
 */
import AnthropicSvg from '@/assets/provider-logos/anthropic.svg?react'
import ClaudeCodeSvg from '@/assets/provider-logos/claude-code.svg?react'
import CodexSvg from '@/assets/provider-logos/codex.svg?react'
import GeminiSvg from '@/assets/provider-logos/gemini.svg?react'
import GrokSvg from '@/assets/provider-logos/grok.svg?react'
import OllamaSvg from '@/assets/provider-logos/ollama.svg?react'
import OpenAISvg from '@/assets/provider-logos/openai.svg?react'
import OpenRouterSvg from '@/assets/provider-logos/openrouter.svg?react'

interface IconProps {
  className?: string
  style?: React.CSSProperties
}

// --- API Key provider icons ---

export function OpenAIIcon({ className, style }: IconProps) {
  return <OpenAISvg className={className} style={style} aria-hidden="true" />
}

export function AnthropicIcon({ className, style }: IconProps) {
  return <AnthropicSvg className={className} style={style} aria-hidden="true" />
}

export function GeminiIcon({ className, style }: IconProps) {
  return <GeminiSvg className={className} style={style} aria-hidden="true" />
}

export function GrokIcon({ className, style }: IconProps) {
  return <GrokSvg className={className} style={style} aria-hidden="true" />
}

export function OpenRouterIcon({ className, style }: IconProps) {
  return <OpenRouterSvg className={className} style={style} aria-hidden="true" />
}

export function OllamaIcon({ className, style }: IconProps) {
  return <OllamaSvg className={className} style={style} aria-hidden="true" />
}

// --- Subscription icons ---

export function CodexIcon({ className, style }: IconProps) {
  return <CodexSvg className={className} style={style} aria-hidden="true" />
}

export function ClaudeCodeIcon({ className, style }: IconProps) {
  return <ClaudeCodeSvg className={className} style={style} aria-hidden="true" />
}
