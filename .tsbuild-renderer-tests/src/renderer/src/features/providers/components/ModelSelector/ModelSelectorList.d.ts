import type { FlatModel } from './types';
interface ModelSelectorListProps {
    readonly models: readonly FlatModel[];
    readonly selectedModel: FlatModel | undefined;
    readonly onSelectModel: (model: FlatModel) => void;
}
export declare function ModelSelectorList({ models, selectedModel, onSelectModel, }: ModelSelectorListProps): import("node_modules/@types/react").JSX.Element;
export {};
