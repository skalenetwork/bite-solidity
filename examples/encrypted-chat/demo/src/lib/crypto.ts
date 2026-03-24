// Server-only crypto helpers — adapted from examples/scripts/utils.ts
// Uses Node.js crypto (runs only in Next.js server context)

import crypto from "node:crypto";
import { SigningKey } from "ethers";

export type PublicKey = {
    x: string;
    y: string;
};

export const privateKeyToPublicKey = (privateKey: string): PublicKey => {
    const signingKey = new SigningKey(privateKey);
    const publicKey = signingKey.publicKey;

    if (!publicKey.startsWith("0x04") || publicKey.length !== 132) {
        throw new Error("Unexpected public key format");
    }

    return {
        x: `0x${publicKey.slice(4, 68)}`,
        y: `0x${publicKey.slice(68, 132)}`,
    };
};

export const decrypt = (privateKey: string, encryptedHex: string): Buffer => {
    const data = Buffer.from(encryptedHex.replace(/^0x/, ""), "hex");

    const iv = data.subarray(0, 16);
    const ephPub = data.subarray(16, 49);
    const ciphertext = data.subarray(49);

    const ecdh = crypto.createECDH("secp256k1");
    ecdh.setPrivateKey(Buffer.from(privateKey.replace(/^0x/, ""), "hex"));

    const sharedSecret = ecdh.computeSecret(ephPub);
    const key = crypto.createHash("sha256").update(sharedSecret).digest();

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};
