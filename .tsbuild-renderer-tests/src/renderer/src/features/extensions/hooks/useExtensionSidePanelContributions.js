import { useQuery } from '@tanstack/react-query';
import { extensionContributionsQueryOptions } from '@/queries/extensions';
function activeProjectPaths(projectPath) {
    return projectPath ? [projectPath] : [];
}
export function useExtensionSidePanelContributions({ enabled, projectPath, sessionId, }) {
    const projectPaths = activeProjectPaths(projectPath);
    const queryOptions = extensionContributionsQueryOptions(projectPaths, { sessionId });
    const query = useQuery({
        ...queryOptions,
        enabled,
    });
    return {
        error: query.error,
        loading: query.isPending,
        projectPaths,
        refetch: query.refetch,
        registry: query.data ?? null,
    };
}
