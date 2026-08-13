import type { ProviderInfo } from '@shared/types/llm';
interface OAuthProviderRowProps {
    readonly providerInfo: ProviderInfo;
    readonly isLast: boolean;
}
export declare function OAuthProviderRow({ providerInfo, isLast }: OAuthProviderRowProps): import("node_modules/@types/react").JSX.Element;
export {};
