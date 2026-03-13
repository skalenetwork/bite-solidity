import { ethers, JsonRpcProvider, SigningKey } from "ethers";
import crypto from "crypto";

const PRIVATE_KEY = "";
const RPC_URL = "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox";
const CONTRACT_ADDRESS = "";

const abi = [
    {
        inputs: [{ internalType: "uint256", name: "_value", type: "uint256" }],
        stateMutability: "nonpayable",
        type: "constructor",
    },
    {
        inputs: [
            {
                components: [
                    { internalType: "bytes32", name: "x", type: "bytes32" },
                    { internalType: "bytes32", name: "y", type: "bytes32" },
                ],
                internalType: "struct PublicKey",
                name: "publicKey",
                type: "tuple",
            },
        ],
        name: "grantAccess",
        outputs: [],
        stateMutability: "payable",
        type: "function",
    },
    {
        inputs: [],
        name: "getEncryptedValue",
        outputs: [{ internalType: "bytes", name: "", type: "bytes" }],
        stateMutability: "view",
        type: "function",
    },
];

const provider = new JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);


function decrypt(privateKey, encryptedHex) {
    const data = Buffer.from(encryptedHex.replace(/^0x/, ""), "hex");

    const iv = data.slice(0, 16);
    const ephPub = data.slice(16, 49);
    const ciphertext = data.slice(49);

    const ecdh = crypto.createECDH("secp256k1");
    ecdh.setPrivateKey(Buffer.from(privateKey.replace(/^0x/, ""), "hex"));

    const sharedSecret = ecdh.computeSecret(ephPub);
    const key = crypto.createHash("sha256").update(sharedSecret).digest();

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function derivePublicKey(privateKey) {
    const signingKey = new SigningKey(privateKey);

    const publicKey = signingKey.publicKey;

    const x = "0x" + publicKey.slice(4, 68);
    const y = "0x" + publicKey.slice(68, 132);

    return { x, y };
}


async function grantAccess() {
    const contractWithSigner = contract.connect(wallet);

    const publicKey = derivePublicKey(PRIVATE_KEY);

    const tx = await contractWithSigner.grantAccess(publicKey, {
        gasLimit: 200000,
        value: 1_000_000_000_000n,
    });

    await tx.wait();

    console.log("Access granted");
}

async function decryptData() {
    const ciphertext = await contract.getEncryptedValue({
        from: wallet.address
    });
    console.log(ciphertext);
    const decrypted = decrypt(PRIVATE_KEY, ciphertext);

    const decryptedValue = BigInt("0x" + decrypted.toString("hex")).toString();

    console.log("Decrypted value:", decryptedValue);
}

async function main() {
    try {
        await grantAccess();
        await decryptData();
    } catch (err) {
        console.error("Error:", err);
    }
}

main();
