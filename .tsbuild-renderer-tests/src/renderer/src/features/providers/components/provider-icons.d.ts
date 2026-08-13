import type { Provider } from '@shared/types/settings';
export interface IconProps {
    className?: string;
    style?: React.CSSProperties;
}
export type ProviderIconComponent = (props: IconProps) => React.ReactElement;
export declare const OpenAIIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const AnthropicIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const GeminiIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const GroqIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const OpenRouterIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const OllamaIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare const CodexIcon: ({ className, style }: IconProps) => import("node_modules/@types/react").JSX.Element;
export declare function getProviderIcon(provider: Provider): ProviderIconComponent;
