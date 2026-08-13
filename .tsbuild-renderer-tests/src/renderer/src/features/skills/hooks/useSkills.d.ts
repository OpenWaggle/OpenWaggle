import type { SkillCatalogResult } from '@shared/types/standards';
import { type StandardsStatus } from '@/queries/skills';
interface UseSkillsResult {
    standardsStatus: StandardsStatus | null;
    catalog: SkillCatalogResult | null;
    selectedSkillId: string | null;
    previewMarkdown: string;
    isLoading: boolean;
    isPreviewLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    selectSkill: (skillId: string) => void;
    toggleSkill: (skillId: string, enabled: boolean) => Promise<void>;
}
export declare function useSkills(projectPath: string | null): UseSkillsResult;
export {};
