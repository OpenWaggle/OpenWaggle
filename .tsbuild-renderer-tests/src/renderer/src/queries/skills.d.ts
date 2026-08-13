import type { AgentsInstructionStatus, SkillCatalogResult } from '@shared/types/standards';
import { queryKeys } from './query-keys';
import type { OpenWaggleQueryOptions } from './query-options';
export interface StandardsStatus {
    readonly agents: AgentsInstructionStatus;
    readonly agentsPath: string;
    readonly error?: string;
}
export interface SkillResourcesResult {
    readonly standardsStatus: StandardsStatus;
    readonly catalog: SkillCatalogResult;
}
export declare function fetchSkillResources(projectPath: string): Promise<{
    standardsStatus: {
        agents: AgentsInstructionStatus;
        agentsPath: string;
        error?: string;
    };
    catalog: SkillCatalogResult;
}>;
export declare function fetchSkillPreview(projectPath: string, skillId: string): Promise<{
    markdown: string;
}>;
type SkillPreviewResult = Awaited<ReturnType<typeof fetchSkillPreview>>;
export declare function skillResourcesQueryOptions(projectPath: string | null): OpenWaggleQueryOptions<SkillResourcesResult, Error, SkillResourcesResult, ReturnType<typeof queryKeys.skills>>;
export declare function skillPreviewQueryOptions(projectPath: string | null, skillId: string | null, enabled?: boolean): OpenWaggleQueryOptions<SkillPreviewResult, Error, SkillPreviewResult, ReturnType<typeof queryKeys.skillPreview>>;
export {};
