import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/lib/ipc';
import { queryKeys } from './query-keys';
export async function fetchSkillResources(projectPath) {
    const [standardsStatus, catalog] = await Promise.all([
        api.getStandardsStatus(projectPath),
        api.listSkills(projectPath),
    ]);
    return { standardsStatus, catalog };
}
export async function fetchSkillPreview(projectPath, skillId) {
    return api.getSkillPreview(projectPath, skillId);
}
export function skillResourcesQueryOptions(projectPath) {
    return queryOptions({
        queryKey: queryKeys.skills(projectPath),
        enabled: projectPath !== null,
        queryFn: () => {
            if (!projectPath) {
                throw new Error('Project path is required to load skills.');
            }
            return fetchSkillResources(projectPath);
        },
    });
}
export function skillPreviewQueryOptions(projectPath, skillId, enabled = projectPath !== null && skillId !== null) {
    return queryOptions({
        queryKey: queryKeys.skillPreview(projectPath, skillId),
        enabled,
        queryFn: () => {
            if (!projectPath || !skillId) {
                throw new Error('A selected skill is required to load the preview.');
            }
            return fetchSkillPreview(projectPath, skillId);
        },
    });
}
