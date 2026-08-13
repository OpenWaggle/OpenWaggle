import { jsx as _jsx } from "react/jsx-runtime";
import { ExtensionAgentLoopSurface } from '@/features/extensions';
export function CustomMessageRow({ row, extensions, }) {
    return (_jsx(ExtensionAgentLoopSurface, { input: {
            surface: 'custom-message',
            message: { name: row.event.name, value: row.event.value ?? null },
        }, projectPaths: extensions.projectPaths, registry: extensions.registry }));
}
