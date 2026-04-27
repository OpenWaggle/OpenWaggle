import AnthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?react'
import AntigravitySvg from '@lobehub/icons-static-svg/icons/antigravity-color.svg?react'
import AzureAiSvg from '@lobehub/icons-static-svg/icons/azureai-color.svg?react'
import BedrockSvg from '@lobehub/icons-static-svg/icons/bedrock-color.svg?react'
import CerebrasSvg from '@lobehub/icons-static-svg/icons/cerebras-color.svg?react'
import CodexSvg from '@lobehub/icons-static-svg/icons/codex-color.svg?react'
import DeepSeekSvg from '@lobehub/icons-static-svg/icons/deepseek-color.svg?react'
import FireworksSvg from '@lobehub/icons-static-svg/icons/fireworks-color.svg?react'
import GeminiSvg from '@lobehub/icons-static-svg/icons/gemini-color.svg?react'
import GeminiCliSvg from '@lobehub/icons-static-svg/icons/geminicli-color.svg?react'
import CopilotSvg from '@lobehub/icons-static-svg/icons/githubcopilot.svg?react'
import GroqSvg from '@lobehub/icons-static-svg/icons/groq.svg?react'
import HuggingFaceSvg from '@lobehub/icons-static-svg/icons/huggingface-color.svg?react'
import KimiSvg from '@lobehub/icons-static-svg/icons/kimi-color.svg?react'
import MiniMaxSvg from '@lobehub/icons-static-svg/icons/minimax-color.svg?react'
import MistralSvg from '@lobehub/icons-static-svg/icons/mistral-color.svg?react'
import OllamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg?react'
import OpenAISvg from '@lobehub/icons-static-svg/icons/openai.svg?react'
import OpenCodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg?react'
import OpenRouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg?react'
import VercelSvg from '@lobehub/icons-static-svg/icons/vercel.svg?react'
import VertexAiSvg from '@lobehub/icons-static-svg/icons/vertexai-color.svg?react'
import XaiSvg from '@lobehub/icons-static-svg/icons/xai.svg?react'
import ZaiSvg from '@lobehub/icons-static-svg/icons/zai.svg?react'
import type { Provider } from '@shared/types/settings'

export interface IconProps {
  className?: string
  style?: React.CSSProperties
}

export type ProviderIconComponent = (props: IconProps) => React.ReactElement
type SvgComponent = React.FunctionComponent<React.SVGProps<SVGSVGElement>>

function createSvgIcon(Svg: SvgComponent): ProviderIconComponent {
  return function LobeProviderIcon({ className, style }: IconProps) {
    return <Svg className={className} style={style} aria-hidden="true" />
  }
}

function FallbackProviderIcon({ className, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        ...style,
        borderRadius: '9999px',
        backgroundColor:
          typeof style?.color === 'string' && style.color !== 'currentColor'
            ? style.color
            : 'currentColor',
      }}
      data-provider-icon-fallback="true"
    />
  )
}

export const OpenAIIcon = createSvgIcon(OpenAISvg)
export const AnthropicIcon = createSvgIcon(AnthropicSvg)
export const GeminiIcon = createSvgIcon(GeminiSvg)
export const GroqIcon = createSvgIcon(GroqSvg)
export const OpenRouterIcon = createSvgIcon(OpenRouterSvg)
export const OllamaIcon = createSvgIcon(OllamaSvg)
export const CodexIcon = createSvgIcon(CodexSvg)
const PROVIDER_ICON_COMPONENTS: Partial<Record<Provider, ProviderIconComponent>> = {
  anthropic: AnthropicIcon,
  'azure-openai-responses': createSvgIcon(AzureAiSvg),
  'amazon-bedrock': createSvgIcon(BedrockSvg),
  cerebras: createSvgIcon(CerebrasSvg),
  deepseek: createSvgIcon(DeepSeekSvg),
  fireworks: createSvgIcon(FireworksSvg),
  'github-copilot': createSvgIcon(CopilotSvg),
  google: GeminiIcon,
  'google-antigravity': createSvgIcon(AntigravitySvg),
  'google-gemini-cli': createSvgIcon(GeminiCliSvg),
  'google-vertex': createSvgIcon(VertexAiSvg),
  groq: GroqIcon,
  huggingface: createSvgIcon(HuggingFaceSvg),
  'kimi-coding': createSvgIcon(KimiSvg),
  minimax: createSvgIcon(MiniMaxSvg),
  'minimax-cn': createSvgIcon(MiniMaxSvg),
  mistral: createSvgIcon(MistralSvg),
  openai: OpenAIIcon,
  'openai-codex': CodexIcon,
  opencode: createSvgIcon(OpenCodeSvg),
  'opencode-go': createSvgIcon(OpenCodeSvg),
  openrouter: OpenRouterIcon,
  ollama: OllamaIcon,
  'vercel-ai-gateway': createSvgIcon(VercelSvg),
  xai: createSvgIcon(XaiSvg),
  zai: createSvgIcon(ZaiSvg),
}

export function getProviderIcon(provider: Provider): ProviderIconComponent {
  return PROVIDER_ICON_COMPONENTS[provider] ?? FallbackProviderIcon
}
