// cspell:words ciphertext

import { AbiCoder, Wallet, id } from "ethers";
import { ethers } from "hardhat";
import { BITE } from "@skalenetwork/bite";
import { decrypt, privateKeyToPublicKey } from "../../scripts/utils";
import { RoleBasedValueRegistry } from "../typechain-types";
import { verify } from "@skalenetwork/upgrade-tools"

const DEFAULT_CALLBACK_GAS = 500_000n;
const ADMIN_ROLE = id("ADMIN_ROLE");

const getRequiredEnvironmentVariable = (name: string): string => {
    if (!process.env[name]) {
        throw new Error(`Please set value for ${name} environment variable`);
    }
    return process.env[name]!;
};

const getOrGeneratePrivateKey = (envName: string): { privateKey: string; generated: boolean } => {
    const value = process.env[envName];
    if (value) {
        return { privateKey: value, generated: false };
    }
    return { privateKey: Wallet.createRandom().privateKey, generated: true };
};

const waitForBytes = async (
    getter: () => Promise<string>,
    timeoutMs: number,
    pollIntervalMs: number,
    label: string
): Promise<string> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
        const value = await getter();
        if (value !== "0x") {
            return value;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timed out waiting for ${label}`);
};

const sleep = async (delayMs: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const decodeAbiString = (privateKey: string, encryptedHex: string): string => {
    const decryptedBytes = decrypt(privateKey, encryptedHex);
    const decryptedHex = `0x${decryptedBytes.toString("hex")}`;
    return AbiCoder.defaultAbiCoder().decode(["string"], decryptedHex)[0] as string;
};

const main = async () => {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    const endpoint = getRequiredEnvironmentVariable("ENDPOINT");
    const adminPrivateKey = getRequiredEnvironmentVariable("PRIVATE_KEY");
    const adminRoleKeyInfo = getOrGeneratePrivateKey("ADMIN_ROLE_PRIVATE_KEY");
    const readerRoleKeyInfo = getOrGeneratePrivateKey("READER_ROLE_PRIVATE_KEY");
    const adminRolePrivateKey = adminRoleKeyInfo.privateKey;
    const readerRolePrivateKey = readerRoleKeyInfo.privateKey;

    const adminRoleValue = process.env.ADMIN_ROLE_VALUE || "admin confidential value";

    const bite = new BITE(endpoint);

    const adminPublicKey = privateKeyToPublicKey(adminPrivateKey);
    const adminRolePublicKey = privateKeyToPublicKey(adminRolePrivateKey);
    const readerRolePublicKey = privateKeyToPublicKey(readerRolePrivateKey);

    const feeData = await ethers.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
    const callbackValue = (DEFAULT_CALLBACK_GAS + 1n) * gasPrice * 2n;

    console.log(`Deployer:           ${deployerAddress}`);
    console.log(`ADMIN role key:     ${adminRoleKeyInfo.generated ? "generated" : "from env"}`);
    console.log(`READER role key:    ${readerRoleKeyInfo.generated ? "generated" : "from env"}`);
    console.log(`READER role pubkey: ${readerRolePublicKey.x}/${readerRolePublicKey.y}`);
    console.log(`Initial gasPrice:   ${gasPrice.toString()}`);
    console.log(`Initial callback value: ${callbackValue.toString()}`);

    const encodedAdminRoleValue = AbiCoder.defaultAbiCoder().encode(["string"], [adminRoleValue]);
    const encryptedAdminRoleSecret = await bite.encryptMessage(adminRolePrivateKey);
    const encryptedAdminRoleValue = await bite.encryptMessage(encodedAdminRoleValue);

    const factory = await ethers.getContractFactory("RoleBasedValueRegistry");
    const registry = await factory.connect(deployer).deploy(
        adminRolePublicKey,
        adminPublicKey,
        encryptedAdminRoleSecret,
        {
            value: callbackValue,
            gasLimit: 1_900_000,
        }
    ) as RoleBasedValueRegistry;

    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();

    await verify("RoleBasedValueRegistry", registryAddress);

    console.log(`RoleBasedValueRegistry deployed at: ${registryAddress}`);

    // Deployment complete, testing

    const deployedMinCallbackGas = await registry.minCallbackGas();
    const deployedCallbackValue = (deployedMinCallbackGas + 1n) * gasPrice * 2n;
    console.log(`minCallbackGas:     ${deployedMinCallbackGas.toString()}`);
    console.log(`Callback value:     ${deployedCallbackValue.toString()}`);

    await sleep(2_000);
    const encryptedAdminSecretForUser = await registry.getMyEncryptedRoleSecret.staticCall(ADMIN_ROLE, {
        from: deployerAddress,
    });
    const decryptedAdminRoleSecretBytes = decrypt(adminPrivateKey, encryptedAdminSecretForUser);
    const decryptedAdminRoleSecret = `0x${decryptedAdminRoleSecretBytes.toString("hex")}`;
    console.log(`Admin role secret (private key match): ${decryptedAdminRoleSecret === adminRolePrivateKey}`);

    if (decryptedAdminRoleSecret !== adminRolePrivateKey) {
        throw new Error("Decrypted admin role secret does not match adminRolePrivateKey");
    }

    await (await registry.encryptForRole(ADMIN_ROLE, encryptedAdminRoleValue, {
        value: deployedCallbackValue,
    })).wait();
    console.log("Submitted encrypted value for ADMIN_ROLE");

    const encryptedValueForRole = await waitForBytes(
        () => registry.getValueForRole(ADMIN_ROLE),
        120_000,
        2_000,
        "admin role value callback"
    );
    const decodedRoleValue = decodeAbiString(adminRolePrivateKey, encryptedValueForRole);
    const expectedRoleValue = adminRoleValue;
    console.log(`ADMIN role value:   ${decodedRoleValue}`);
    console.log(`length of decoded:  ${decodedRoleValue.length}`);
    console.log(`length of original: ${expectedRoleValue.length}`);
    if (decodedRoleValue !== expectedRoleValue) {
        throw new Error("Decrypted ADMIN_ROLE value does not match the expected plaintext");
    }

    console.log("Success: ADMIN_ROLE was bootstrapped, value was set, and decryption matched.");

    // ── Step 1: Creating a new user, and transfering 0.2 ETH (Credits) ──

    const newUserWallet = Wallet.createRandom().connect(ethers.provider);
    const newUserAddress = newUserWallet.address;
    const newUserPrivateKey = newUserWallet.privateKey;
    const newUserPublicKey = privateKeyToPublicKey(newUserPrivateKey);
    const transferAmount = ethers.parseEther("0.2");

    await (await deployer.sendTransaction({
        to: newUserAddress,
        value: transferAmount,
    })).wait();

    console.log(`\n── Step 1 ──`);
    console.log(`New user created:   ${newUserAddress}`);
    console.log(`Transferred:        0.2 ETH`);

    // ── Step 2: Grant ADMIN_ROLE to the new user, and verify it can decrypt the role Secret key ──

    await (await registry.grantRole(ADMIN_ROLE, newUserPublicKey, {
        value: deployedCallbackValue,
    })).wait();

    console.log(`\n── Step 2 ──`);
    console.log(`grantRole(ADMIN_ROLE) submitted for new user`);

    await sleep(2_000);
    const encryptedAdminSecretForNewUser = await registry.connect(newUserWallet).getMyEncryptedRoleSecret.staticCall(ADMIN_ROLE, {
        from: newUserAddress,
    });
    const decryptedNewUserAdminSecretBytes = decrypt(newUserPrivateKey, encryptedAdminSecretForNewUser);
    const decryptedNewUserAdminSecret = `0x${decryptedNewUserAdminSecretBytes.toString("hex")}`;
    console.log(`New user admin secret matches: ${decryptedNewUserAdminSecret === adminRolePrivateKey}`);

    if (decryptedNewUserAdminSecret !== adminRolePrivateKey) {
        throw new Error("New user's decrypted ADMIN_ROLE secret does not match adminRolePrivateKey");
    }

    // ── Step 3: With the new user account, create the READER_ROLE ──
    // It requires a new Public/Private key pair for the role.

    const READER_ROLE = id("READER_ROLE");
    const encryptedReaderRoleSecret = await bite.encryptMessage(readerRolePrivateKey);
    const newUserRegistry = registry.connect(newUserWallet) as RoleBasedValueRegistry;

    await (await newUserRegistry.createRole(
        READER_ROLE,
        readerRolePublicKey,
        encryptedReaderRoleSecret,
    )).wait();

    console.log(`\n── Step 3 ──`);
    console.log(`READER_ROLE created by new user`);

    // ── Step 4: Grant READER_ROLE to the new user, and verify it can decrypt the role Secret Key ──

    await (await newUserRegistry.grantRole(READER_ROLE, newUserPublicKey, {
        value: deployedCallbackValue,
    })).wait();

    console.log(`\n── Step 4 ──`);
    console.log(`grantRole(READER_ROLE) submitted for new user`);

    await sleep(2_000);
    const encryptedReaderSecretForNewUser = await newUserRegistry.getMyEncryptedRoleSecret.staticCall(READER_ROLE, {
        from: newUserAddress,
    });
    const decryptedNewUserReaderSecretBytes = decrypt(newUserPrivateKey, encryptedReaderSecretForNewUser);
    const decryptedNewUserReaderSecret = `0x${decryptedNewUserReaderSecretBytes.toString("hex")}`;
    console.log(`New user reader secret matches: ${decryptedNewUserReaderSecret === readerRolePrivateKey}`);

    if (decryptedNewUserReaderSecret !== readerRolePrivateKey) {
        throw new Error("New user's decrypted READER_ROLE secret does not match readerRolePrivateKey");
    }

    // ── Step 5: With the new user account, set a hidden value for the READER_ROLE ──
    // Verify decryption with the role private key.

    const readerRoleValue = process.env.READER_ROLE_VALUE || "reader confidential value";
    const encodedReaderRoleValue = AbiCoder.defaultAbiCoder().encode(["string"], [readerRoleValue]);
    const encryptedReaderRoleValue = await bite.encryptMessage(encodedReaderRoleValue);

    await (await newUserRegistry.encryptForRole(READER_ROLE, encryptedReaderRoleValue, {
        value: deployedCallbackValue,
    })).wait();

    console.log(`\n── Step 5 ──`);
    console.log(`Submitted encrypted value for READER_ROLE`);

    const encryptedReaderValue = await waitForBytes(
        () => registry.getValueForRole(READER_ROLE),
        120_000,
        2_000,
        "reader role value callback"
    );
    const decodedReaderRoleValue = decodeAbiString(readerRolePrivateKey, encryptedReaderValue);
    console.log(`READER role value:  ${decodedReaderRoleValue}`);

    if (decodedReaderRoleValue !== readerRoleValue) {
        throw new Error("Decrypted READER_ROLE value does not match expected plaintext");
    }

    console.log(`READER_ROLE value verified successfully.`);

    // ── Step 6: Send the remainder ETH (Credits) back to the deployer account ──

    const newUserBalance = await ethers.provider.getBalance(newUserAddress);
    const returnGasLimit = 21_000n;
    const currentGasPrice = (await ethers.provider.getFeeData()).gasPrice ?? gasPrice;
    const returnGasCost = returnGasLimit * currentGasPrice;
    const returnAmount = newUserBalance - returnGasCost;
    console.log(`User Final Balance in wei except gas cost: ${returnAmount}`);
    if (returnAmount > 0n) {
        await (await newUserWallet.sendTransaction({
            to: deployerAddress,
            value: returnAmount,
            gasLimit: returnGasLimit,
            gasPrice: currentGasPrice, // Fixed on SKALE
            type: 0,
        })).wait();
        console.log(`\n── Step 6 ──`);
        console.log(`Returned ${ethers.formatEther(returnAmount)} ETH to deployer`);
    } else {
        console.log(`\n── Step 6 ──`);
        console.log(`New user has insufficient balance to return funds`);
    }

    const finalNewUserBalance = await ethers.provider.getBalance(newUserAddress);
    console.log(`New user final balance: ${ethers.formatEther(finalNewUserBalance)} ETH`);

    console.log("\nAll steps completed successfully.");
};

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
