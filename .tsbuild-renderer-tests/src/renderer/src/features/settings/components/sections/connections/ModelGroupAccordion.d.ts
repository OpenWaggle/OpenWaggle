import type { Provider } from '@shared/types/settings';
import type { ModelGroup } from '@/features/providers/model';
interface ModelGroupAccordionProps {
    readonly group: ModelGroup;
    readonly state: {
        readonly isExpanded: boolean;
        readonly isLast: boolean;
        readonly enabledSet: ReadonlySet<string>;
    };
    readonly actions: {
        readonly onToggleExpand: (key: string) => void;
        readonly onToggleModel: (provider: Provider, modelRef: string, enabled: boolean) => void;
        readonly onSelectAll: (group: ModelGroup) => void;
        readonly onClear: (group: ModelGroup) => void;
    };
}
export declare function ModelGroupAccordion({ group, state, actions }: ModelGroupAccordionProps): import("node_modules/@types/react").JSX.Element;
export {};
