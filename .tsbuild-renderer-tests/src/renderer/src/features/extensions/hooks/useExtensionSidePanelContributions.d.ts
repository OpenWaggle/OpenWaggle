import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { UseQueryResult } from '@tanstack/react-query';
interface UseExtensionSidePanelContributionsInput {
    readonly enabled: boolean;
    readonly projectPath: string | null;
    readonly sessionId?: string | null;
}
interface ExtensionSidePanelContributionsResult {
    readonly error: Error | null;
    readonly loading: boolean;
    readonly projectPaths: readonly string[];
    readonly refetch: UseQueryResult<ExtensionContributionRegistryView, Error>['refetch'];
    readonly registry: ExtensionContributionRegistryView | null;
}
export declare function useExtensionSidePanelContributions({ enabled, projectPath, sessionId, }: UseExtensionSidePanelContributionsInput): ExtensionSidePanelContributionsResult;
export {};
