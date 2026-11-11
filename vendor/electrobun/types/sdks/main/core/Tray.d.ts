import { type MenuItemConfig, type Rectangle } from "../proc/native";
export type TrayOptions = {
    title?: string;
    image?: string;
    template?: boolean;
    width?: number;
    height?: number;
};
export declare class Tray {
    id: number;
    visible: boolean;
    title: string;
    image: string;
    template: boolean;
    width: number;
    height: number;
    menu: Array<MenuItemConfig> | null;
    constructor({ title, image, template, width, height, }?: TrayOptions);
    private createNativeTray;
    resolveImagePath(imgPath: string): any;
    setTitle(title: string): void;
    setImage(imgPath: string): void;
    setMenu(menu: Array<MenuItemConfig>): void;
    on(name: "tray-clicked", handler: (event: unknown) => void): void;
    setVisible(visible: boolean): void;
    getBounds(): Rectangle;
    remove(): void;
    static getById(id: number): Tray;
    static getAll(): Tray[];
    static removeById(id: number): void;
}
