import { ethers } from "hardhat";
import { BytesLike, Signer } from "ethers";

export const getPublicKey = async (account: Signer): Promise<{x: BytesLike, y: BytesLike}> => {
    const message = "D2 was here";
    const signature = await account.signMessage(message);
    const msgHash = ethers.hashMessage(message);
    const publicKey = ethers.SigningKey.recoverPublicKey(msgHash, signature);
    const px = '0x' + publicKey.slice(4, 68);
    const py = '0x' + publicKey.slice(68);
    return {x: px, y: py};
}
