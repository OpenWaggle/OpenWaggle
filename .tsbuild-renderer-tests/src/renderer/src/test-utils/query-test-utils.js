import { jsx as _jsx } from "react/jsx-runtime";
import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import { createRendererQueryClient } from '@/queries/query-client';
function QueryWrapper({ children, client }) {
    const queryClient = client ?? createRendererQueryClient();
    return _jsx(QueryClientProvider, { client: queryClient, children: children });
}
export function renderWithQueryClient(ui, client = createRendererQueryClient()) {
    return {
        client,
        ...render(_jsx(QueryWrapper, { client: client, children: ui })),
    };
}
export function renderHookWithQueryClient(renderCallback, options) {
    const client = options?.client ?? createRendererQueryClient();
    return {
        client,
        ...renderHook(renderCallback, {
            initialProps: options?.initialProps,
            wrapper: ({ children }) => (_jsx(QueryWrapper, { client: client, children: children })),
        }),
    };
}
