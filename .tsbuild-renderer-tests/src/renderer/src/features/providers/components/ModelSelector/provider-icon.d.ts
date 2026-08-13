import type { Provider } from '@shared/types/settings';
import { type CSSProperties, type ReactElement } from 'react';
interface ProviderModelIconProps {
    readonly provider: Provider;
    readonly className?: string;
    readonly style?: CSSProperties;
}
export declare function ProviderModelIcon({ provider, className, style, }: ProviderModelIconProps): ReactElement;
export declare function resolveIconColor(provider: Provider): string;
export {};
