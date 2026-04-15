import {
    loadFixture
} from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

const PRECOMPILES = {
    submitCTX: "0x000000000000000000000000000000000000001b",
    encryptECIES: "0x000000000000000000000000000000000000001c",
    encryptTE: "0x000000000000000000000000000000000000001d",
};


const setupBlockHook = async (bite: any) => {
    ethers.provider.on("block", async (blockNumber: number) => {
        if (await bite.callbacksQueued() > 0) {
            await bite.sendAllCallbacksAllowFailures();
            console.log("I sent callbacks");
        }
        console.log("I was here");
    });
}

const deployAndSetupBiteMocks = async () => {
    const {bite} = await deployBiteMocks();
    return bite;
}

const deployBiteMocks = async () => {
    const biteFactory = await ethers.getContractFactory("BiteMock");
    const bite = await biteFactory.deploy();
    const encryptECIESFactory = await ethers.getContractFactory("EncryptECIESMock");
    const encryptECIES = await encryptECIESFactory.deploy(bite);
    const encryptTEFactory = await ethers.getContractFactory("EncryptTEMock");
    const encryptTE = await encryptTEFactory.deploy(bite);
    const submitCTXFactory = await ethers.getContractFactory("SubmitCTXMock");
    const submitCTX = await submitCTXFactory.deploy(bite);

    await ethers.provider.send("hardhat_setCode", [
        PRECOMPILES.submitCTX,
        await ethers.provider.getCode(await submitCTX.getAddress()),
    ]);
    await ethers.provider.send("hardhat_setCode", [
        PRECOMPILES.encryptECIES,
        await ethers.provider.getCode(await encryptECIES.getAddress()),
    ]);
    await ethers.provider.send("hardhat_setCode", [
        PRECOMPILES.encryptTE,
        await ethers.provider.getCode(await encryptTE.getAddress()),
    ]);

    return {
        bite,
        encryptECIES: await ethers.getContractAt("EncryptECIESMock", PRECOMPILES.encryptECIES),
        encryptTE: await ethers.getContractAt("EncryptTEMock", PRECOMPILES.encryptTE),
        submitCTX: await ethers.getContractAt("SubmitCTXMock", PRECOMPILES.submitCTX),
    }
}


export const biteSetup = async () => loadFixture(deployAndSetupBiteMocks);
