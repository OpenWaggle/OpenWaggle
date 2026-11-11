export type EncryptedHostTransportPacket = {
    encryptedData: string;
    iv: string;
    tag: string;
};
export declare const encryptHostTransportPacket: (messageJson: string, secretKey: Uint8Array) => EncryptedHostTransportPacket;
