import { createElement } from 'react';
import { getProviderIcon } from '@/features/providers/components/provider-icons';
export function ProviderModelIcon({ provider, className, style, }) {
    return createElement(getProviderIcon(provider), { className, style });
}
const PROVIDER_COLOR = {
    anthropic: '#d4a27f',
    openai: '#10a37f',
    'openai-codex': '#7A9DFF',
    'github-copilot': '#7A9DFF',
    google: '#3186FF',
    'google-gemini-cli': '#3186FF',
    'google-antigravity': '#3186FF',
    'google-vertex': '#3186FF',
    deepseek: '#4d6bfe',
    xai: 'currentColor',
    openrouter: '#7c5cfc',
    ollama: 'currentColor',
};
export function resolveIconColor(provider) {
    return PROVIDER_COLOR[provider] ?? 'currentColor';
}
