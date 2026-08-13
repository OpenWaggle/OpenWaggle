import type { FlatModel } from './types';
interface ModelSelectorRowProps {
    readonly model: FlatModel;
    readonly isSelected: boolean;
    readonly onSelect: (model: FlatModel) => void;
}
export declare function ModelSelectorRow({ model, isSelected, onSelect }: ModelSelectorRowProps): import("node_modules/@types/react").JSX.Element;
export {};
