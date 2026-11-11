import ElectrobunEvent from "./event";
type IdData = {
    id: number;
};
type ResizeData = {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
};
type MoveData = {
    id: number;
    x: number;
    y: number;
};
type KeyData = {
    id: number;
    keyCode: number;
    modifiers: number;
    isRepeat: boolean;
};
declare const _default: {
    close: (data: IdData) => ElectrobunEvent<IdData, {}>;
    willClose: (data: IdData) => ElectrobunEvent<IdData, {
        allow: boolean;
    }>;
    resize: (data: ResizeData) => ElectrobunEvent<ResizeData, {}>;
    move: (data: MoveData) => ElectrobunEvent<MoveData, {}>;
    focus: (data: IdData) => ElectrobunEvent<IdData, {}>;
    blur: (data: IdData) => ElectrobunEvent<IdData, {}>;
    keyDown: (data: KeyData) => ElectrobunEvent<KeyData, {}>;
    keyUp: (data: KeyData) => ElectrobunEvent<KeyData, {}>;
};
export default _default;
