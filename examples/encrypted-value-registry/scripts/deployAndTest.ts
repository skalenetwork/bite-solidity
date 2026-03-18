// cspell:words ciphertext

import { AbiCoder, Wallet } from "ethers";
import { ethers } from "hardhat";
import { BITE } from "@skalenetwork/bite";
import { decrypt, privateKeyToPublicKey, type PublicKey } from "../../scripts/utils";
import { EncryptedValueRegistry } from "../typechain-types";

const getRequiredEnvironmentVariable = (name: string): string => {
    if (!process.env[name]) {
        throw new Error(`Please set value for ${name} environment variable`);
    }
    return process.env[name]!;
};

const waitForEncryptedValue = async (
    registry: { getEncryptedValue: () => Promise<string> },
    timeoutMs: number,
    pollIntervalMs: number
): Promise<string> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
        const encryptedValue = await registry.getEncryptedValue();
        if (encryptedValue !== "0x") {
            return encryptedValue;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error("Timed out waiting for callback to populate encrypted value");
};

const main = async () => {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    const initialValue = process.env.INITIAL_VALUE ? BigInt(process.env.INITIAL_VALUE) : 1337n;
    const defaultPrivateKey = getRequiredEnvironmentVariable("PRIVATE_KEY");
    const endpoint = getRequiredEnvironmentVariable("ENDPOINT");
    const bite = new BITE(endpoint);
    const viewerPrivateKey = process.env.ECIES_PRIVATE_KEY || defaultPrivateKey;
    const viewerPublicKey = privateKeyToPublicKey(viewerPrivateKey);
    const viewer = new Wallet(viewerPrivateKey, ethers.provider);

    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Viewer:   ${viewer.address}`);

    const factory = await ethers.getContractFactory("EncryptedValueRegistry");
    const registry = await factory.connect(deployer).deploy() as EncryptedValueRegistry;

    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`EncryptedValueRegistry deployed at: ${registryAddress}`);

    const setValueTx = await registry.setValue.populateTransaction(initialValue);
    const encryptedSetValueTx = await bite.encryptTransaction({...setValueTx, gasLimit: "300000"});
    await (await deployer.sendTransaction(encryptedSetValueTx)).wait();
    console.log(`setValue tx sent with encrypted data`);

    const minCallbackGas = await registry.minCallbackGas();
    const feeData = await ethers.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
    const callbackValue = (minCallbackGas + 1n) * gasPrice * 2n;

    console.log(`minCallbackGas: ${minCallbackGas.toString()}`);
    console.log(`Using gasPrice: ${gasPrice.toString()}`);
    console.log(`grantAccess msg.value: ${callbackValue.toString()}`);

    const before = await registry.connect(viewer).getEncryptedValue();
    console.log(`Encrypted value before grantAccess: ${before}`);

    const grantTx = await registry.grantAccess.populateTransaction(viewerPublicKey, {
        value: callbackValue,
    });
    const encryptedGrantTx = await bite.encryptTransaction({...grantTx, gasLimit: "300000"});

    const txResponse = await deployer.sendTransaction(encryptedGrantTx);
    await txResponse.wait();
    console.log(`grantAccess tx hash: ${txResponse.hash}`);

    const encryptedValue = await waitForEncryptedValue(
        registry.connect(viewer),
        120_000,
        2_000
    );

    console.log(`Encrypted value after callback: ${encryptedValue}`);

    const decryptedBytes = decrypt(viewerPrivateKey, encryptedValue);
    const decodedValue = AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        `0x${decryptedBytes.toString("hex")}`
    )[0] as bigint;

    console.log(`Decoded uint256: ${decodedValue.toString()}`);

    if (decodedValue !== initialValue) {
        throw new Error(`Decoded value (${decodedValue.toString()}) does not match initial value (${initialValue.toString()})`);
    }

    console.log("Success: decoded value matches constructor value.");
};

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
