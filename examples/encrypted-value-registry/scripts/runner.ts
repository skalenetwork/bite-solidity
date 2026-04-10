// cspell:words ciphertext
import { ethers, JsonRpcProvider } from "ethers";
import { BITE } from "@skalenetwork/bite";
import { decrypt, privateKeyToPublicKey } from "../../scripts/utils";

import dotenv from "dotenv"
dotenv.config({ quiet: true });

// should be the deployer's private key
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
// should be BITE 2 chain
const RPC_URL = process.env.ENDPOINT ||"https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox";
// should be the address of the deployed EncryptedValueRegistry contract
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";

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
    {
        inputs: [],
        name: "owner",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
];

const provider = new JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const bite = new BITE(RPC_URL);


async function waitForEncryptedValue(
    timeoutMs: number,
    pollIntervalMs: number
): Promise<string> {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
        const encryptedValue = await contract.getEncryptedValue({
            from: wallet.address
        }) as string;
        if (encryptedValue !== "0x") {
            return encryptedValue;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error("Timed out waiting for callback to populate encrypted value");
}




async function grantAccess() {
    const contractWithSigner = contract.connect(wallet) as any;

    const publicKey = privateKeyToPublicKey(PRIVATE_KEY);
    const owner = await contractWithSigner.owner();

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error("Only the contract owner can grant access.");
    }

    const grantTx = await contractWithSigner.grantAccess.populateTransaction(publicKey, {
        value: 1_000_000_000_000n,
    });
    const encryptedGrantTx = await bite.encryptTransaction({...grantTx, gasLimit: "300000"});
    const txResponse = await wallet.sendTransaction(encryptedGrantTx);
    await txResponse.wait();

    console.log(`grantAccess tx hash: ${txResponse.hash}`);
    console.log("Access granted");
}

async function decryptData() {
    // Wait up to 30s for the BITE callback to land (block N+1)
    const ciphertext = await waitForEncryptedValue(30_000, 2_000);
    console.log(`Encrypted value after callback: ${ciphertext}`);
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
