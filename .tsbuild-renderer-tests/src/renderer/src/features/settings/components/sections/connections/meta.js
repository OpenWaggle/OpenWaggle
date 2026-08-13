import { AnthropicIcon, GeminiIcon, GroqIcon, getProviderIcon, OllamaIcon, OpenAIIcon, OpenRouterIcon, } from '@/features/providers/components';
export const PROVIDER_META = {
    openai: {
        icon: OpenAIIcon,
        color: '#10a37f',
    },
    anthropic: {
        icon: AnthropicIcon,
        color: '#d4a27f',
    },
    google: {
        icon: GeminiIcon,
        color: '#4285f4',
    },
    'google-gemini-cli': {
        icon: GeminiIcon,
        color: '#4285f4',
    },
    'google-antigravity': {
        icon: GeminiIcon,
        color: '#4285f4',
    },
    xai: {
        icon: getProviderIcon('xai'),
        color: '#e44d26',
    },
    groq: {
        icon: GroqIcon,
        color: '#e44d26',
    },
    deepseek: {
        icon: getProviderIcon('deepseek'),
        color: '#4d6bfe',
    },
    openrouter: {
        icon: OpenRouterIcon,
        color: '#7c5cfc',
    },
    ollama: {
        icon: OllamaIcon,
        color: '#555d6e',
    },
};
export function getProviderMeta(provider) {
    return (PROVIDER_META[provider] ?? {
        icon: getProviderIcon(provider),
        color: '#8da2c0',
    });
}
