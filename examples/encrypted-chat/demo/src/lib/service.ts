// Server-only service layer — wraps contract calls for API routes

import { ethers } from "ethers";
import { env } from "./env";
import { getProvider, getWalletForUser, getContract } from "./contract";
import { privateKeyToPublicKey, decrypt } from "./crypto";
import { BITE } from "@skalenetwork/bite";

// ── Read operations ──

export type UserState = {
    address: string;
    balance: string;      // native balance in wei
    deposit: string;      // contract deposit in wei
    isRegistered: boolean;
};

export type DashboardState = {
    user1: UserState;
    user2: UserState;
    sessionExists: boolean;
    contractAddress: string;
};

export const getDashboardState = async (): Promise<DashboardState> => {
    const provider = getProvider();
    const contract = getContract();

    const w1 = getWalletForUser(1);
    const w2 = getWalletForUser(2);
    const addr1 = w1.address;
    const addr2 = w2.address;

    const [
        bal1, bal2,
        dep1, dep2,
        reg1, reg2,
        hasSession,
    ] = await Promise.all([
        provider.getBalance(addr1),
        provider.getBalance(addr2),
        contract.userDeposits(addr1),
        contract.userDeposits(addr2),
        contract.isRegistered(addr1),
        contract.isRegistered(addr2),
        contract.sessionExists(addr1, addr2),
    ]);

    return {
        user1: {
            address: addr1,
            balance: bal1.toString(),
            deposit: dep1.toString(),
            isRegistered: reg1,
        },
        user2: {
            address: addr2,
            balance: bal2.toString(),
            deposit: dep2.toString(),
            isRegistered: reg2,
        },
        sessionExists: hasSession,
        contractAddress: env.CONTRACT_ADDRESS,
    };
};

// ── Message types ──

export type ChatMessage = {
    timestamp: number;      // unix seconds
    sender: string;         // address
    encryptedContent: string;
};

export const getMessages = async (
    offset: number,
    amount: number,
): Promise<{ messages: ChatMessage[]; total: number }> => {
    const contract = getContract();
    const addr1 = getWalletForUser(1).address;
    const addr2 = getWalletForUser(2).address;

    let total: number;
    try {
        total = Number(await contract.getNumberOfMessages(addr1, addr2));
    } catch {
        return { messages: [], total: 0 };
    }

    if (total === 0 || offset >= total) {
        return { messages: [], total };
    }

    const raw: Array<{
        timestamp: bigint;
        sender: string;
        sessionId: bigint;
        encryptedContent: string;
    }> = await contract.getMessages(addr1, addr2, offset, amount);

    const messages: ChatMessage[] = raw.map((m) => ({
        timestamp: Number(m.timestamp),
        sender: m.sender,
        encryptedContent: m.encryptedContent,
    }));

    return { messages, total };
};

// ── Write operations ──

export const registerUser = async (userId: 1 | 2): Promise<string> => {
    const wallet = getWalletForUser(userId);
    const contract = getContract(wallet);

    const isReg: boolean = await contract.isRegistered(wallet.address);
    if (isReg) {
        throw new Error(`User ${userId} is already registered`);
    }

    const privateKey = userId === 1 ? env.USER1_PRIVATE_KEY : env.USER2_PRIVATE_KEY;
    const publicKey = privateKeyToPublicKey(privateKey);

    const tx = await contract.registerUser(publicKey, { gas: 1_000_000 });
    const receipt = await tx.wait();
    return receipt.hash;
};

export const createSession = async (): Promise<string> => {
    const w1 = getWalletForUser(1);
    const w2 = getWalletForUser(2);
    const contract = getContract(w1);

    const [reg1, reg2, hasSession] = await Promise.all([
        contract.isRegistered(w1.address),
        contract.isRegistered(w2.address),
        contract.sessionExists(w1.address, w2.address),
    ]);

    if (!reg1 || !reg2) {
        throw new Error("Both users must be registered before creating a session");
    }
    if (hasSession) {
        throw new Error("Session already exists");
    }

    // Generate a random session key pair
    const sessionWallet = ethers.Wallet.createRandom();
    const sessionPublicKey = privateKeyToPublicKey(sessionWallet.privateKey);

    // Encrypt the session private key via BITE (only the contract can decrypt)
    const bite = new BITE(env.BITE_ENDPOINT);
    const encryptedSessionKey = await bite.encryptMessageForCTX(
        sessionWallet.privateKey,
        env.CONTRACT_ADDRESS,
    );

    console.log("Encrypted session key:", encryptedSessionKey);

    // Use deposited amount for demo
    //const sessionCreationGas = await contract.sessionCreationGas();
    //const feeData = await getProvider().getFeeData();
    //const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
    //const callbackValue = (sessionCreationGas + 1n) * gasPrice * 2n;

    const tx = await contract.createSession(
        w1.address,
        w2.address,
        sessionPublicKey,
        ethers.getBytes(encryptedSessionKey),
        { gas: 2_000_000 },
    );
    const receipt = await tx.wait();

    console.log("Session created with transaction hash:", receipt.hash);
    return receipt.hash;
};

export const sendMessage = async (
    fromUserId: 1 | 2,
    plaintext: string,
): Promise<string> => {
    const fromWallet = getWalletForUser(fromUserId);
    const toWallet = getWalletForUser(fromUserId === 1 ? 2 : 1);
    const contract = getContract(fromWallet);

    // Encrypt the message via BITE (only the contract can decrypt)
    const bite = new BITE(env.BITE_ENDPOINT);
    const plaintextHex = ethers.hexlify(ethers.toUtf8Bytes(plaintext));
    const encryptedContent = await bite.encryptMessageForCTX(
        plaintextHex,
        env.CONTRACT_ADDRESS,
    );

    // Estimate callback funding
    // Use the deposited amount for DEMO
    //const messageSendingGas = await contract.messageSendingGas();
    //const feeData = await getProvider().getFeeData();
    //const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
    //const callbackValue = (messageSendingGas + 1n) * gasPrice * 2n;

    const tx = await contract.sendMessage(
        toWallet.address,
        ethers.getBytes(encryptedContent),
        { gas: 1_000_000 },
        //{ value: callbackValue },
    );
    const receipt = await tx.wait();
    return receipt.hash;
};

export const depositForUser = async (
    userId: 1 | 2,
    amountWei: string,
): Promise<string> => {
    const wallet = getWalletForUser(userId);
    const contract = getContract(wallet);

    const tx = await contract.deposit({ value: BigInt(amountWei) });
    const receipt = await tx.wait();
    return receipt.hash;
};

export const withdrawForUser = async (
    userId: 1 | 2,
): Promise<string> => {
    const wallet = getWalletForUser(userId);
    const contract = getContract(wallet);

    const tx = await contract.withdraw();
    const receipt = await tx.wait();
    return receipt.hash;
};

export const transferCredits = async (
    fromUserId: 1 | 2,
    amountWei: string,
): Promise<string> => {
    const fromWallet = getWalletForUser(fromUserId);
    const toWallet = getWalletForUser(fromUserId === 1 ? 2 : 1);

    const tx = await fromWallet.sendTransaction({
        to: toWallet.address,
        value: BigInt(amountWei),
    });
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction failed");
    return receipt.hash;
};

export const getSessionKeyForUser = async (
    userId: 1 | 2,
): Promise<string> => {
    const contract = getContract();
    const w1 = getWalletForUser(1);
    const w2 = getWalletForUser(2);

    // Compute sessionId the same way the contract does
    const addr1 = w1.address;
    const addr2 = w2.address;
    const [min, max] = addr1.toLowerCase() < addr2.toLowerCase() ? [addr1, addr2] : [addr2, addr1];
    const sessionId = BigInt(ethers.keccak256(ethers.solidityPacked(["address", "address"], [min, max])));

    const userAddr = getWalletForUser(userId).address;
    const encryptedKey: string = await contract.getSessionKeyForUser(sessionId, userAddr);

    const privateKey = userId === 1 ? env.USER1_PRIVATE_KEY : env.USER2_PRIVATE_KEY;
    const decryptedBytes = decrypt(privateKey, encryptedKey);
    return `0x${decryptedBytes.toString("hex")}`;
};

export const decryptMessage = (
    encryptedContentHex: string,
    sessionPrivateKeyHex: string,
): string => {
    const decryptedBytes = decrypt(sessionPrivateKeyHex, encryptedContentHex);
    // Contract does: encryptECIES(abi.encode(decryptedContent), sessionKey)
    // So after ECIES decrypt we get abi.encode(bytes) — decode it
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["bytes"],
        `0x${decryptedBytes.toString("hex")}`,
    );
    // The inner bytes are the original plaintext hex
    const innerHex = decoded[0] as string;
    return ethers.toUtf8String(innerHex);
};
