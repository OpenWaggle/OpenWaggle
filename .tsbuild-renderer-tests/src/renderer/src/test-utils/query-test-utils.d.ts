import { type QueryClient } from '@tanstack/react-query';
import type { RenderHookResult, RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
export declare function renderWithQueryClient(ui: ReactElement, client?: QueryClient): RenderResult & {
    readonly client: QueryClient;
};
export declare function renderHookWithQueryClient<Result, Props>(renderCallback: (initialProps: Props) => Result, options?: {
    readonly client?: QueryClient;
    readonly initialProps?: Props;
}): RenderHookResult<Result, Props> & {
    readonly client: QueryClient;
};
