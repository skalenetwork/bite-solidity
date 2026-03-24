// Server-only contract integration — provider, wallets, typed contract instance

import { ethers } from "ethers";
import { env } from "./env";

// ABI extracted from compiled artifact — only the functions the demo uses
const MESSENGER_ABI = [
    "function isRegistered(address user) view returns (bool)",
    "function sessionExists(address user1, address user2) view returns (bool)",
    "function userDeposits(address user) view returns (uint256)",
    "function registerUser(tuple(bytes32 x, bytes32 y) publicKey) payable",
    "function createSession(address user1, address user2, tuple(bytes32 x, bytes32 y) sessionKey, bytes encryptedSessionKey) payable",
    "function sendMessage(address to, bytes encryptedContent) payable",
    "function getNumberOfMessages(address user1, address user2) view returns (uint256)",
    "function getMessages(address user1, address user2, uint256 offset, uint256 amount) view returns (tuple(uint256 timestamp, address sender, uint256 sessionId, bytes encryptedContent)[])",
    "function getSessionKeyForUser(uint256 sessionId, address user) view returns (bytes)",
    "function deposit() payable",
    "function withdraw()",
    "function messageSendingGas() view returns (uint256)",
    "function sessionCreationGas() view returns (uint256)",
];

let _provider: ethers.JsonRpcProvider | null = null;
let _wallet1: ethers.Wallet | null = null;
let _wallet2: ethers.Wallet | null = null;

export const getProvider = (): ethers.JsonRpcProvider => {
    if (!_provider) {
        _provider = new ethers.JsonRpcProvider(env.RPC_URL);
    }
    return _provider;
};

export const getWallet1 = (): ethers.Wallet => {
    if (!_wallet1) {
        _wallet1 = new ethers.Wallet(env.USER1_PRIVATE_KEY, getProvider());
    }
    return _wallet1;
};

export const getWallet2 = (): ethers.Wallet => {
    if (!_wallet2) {
        _wallet2 = new ethers.Wallet(env.USER2_PRIVATE_KEY, getProvider());
    }
    return _wallet2;
};

export const getWalletForUser = (userId: 1 | 2): ethers.Wallet => {
    return userId === 1 ? getWallet1() : getWallet2();
};

export const getContract = (signer?: ethers.Wallet): ethers.Contract => {
    return new ethers.Contract(
        env.CONTRACT_ADDRESS,
        MESSENGER_ABI,
        signer ?? getProvider()
    );
};
