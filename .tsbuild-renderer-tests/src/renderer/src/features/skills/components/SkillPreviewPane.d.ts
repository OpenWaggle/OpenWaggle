import type { SkillDiscoveryItem } from '@shared/types/standards';
interface SkillPreviewPaneProps {
    readonly error: string | null;
    readonly selectedSkill: SkillDiscoveryItem | null;
    readonly isPreviewLoading: boolean;
    readonly previewMarkdown: string;
}
export declare function SkillPreviewPane({ error, selectedSkill, isPreviewLoading, previewMarkdown, }: SkillPreviewPaneProps): import("node_modules/@types/react").JSX.Element;
export {};
