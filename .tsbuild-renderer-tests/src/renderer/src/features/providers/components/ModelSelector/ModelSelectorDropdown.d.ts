import type { RefObject } from 'react';
import type { FlatModel } from './types';
interface ModelSelectorDropdownProps {
    readonly dropdownRef: RefObject<HTMLDivElement | null>;
    readonly models: readonly FlatModel[];
    readonly selectedModel: FlatModel | undefined;
    readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    readonly onSelectModel: (model: FlatModel) => void;
}
export declare function ModelSelectorDropdown({ dropdownRef, models, selectedModel, onKeyDown, onSelectModel, }: ModelSelectorDropdownProps): import("node_modules/@types/react").JSX.Element;
export {};
