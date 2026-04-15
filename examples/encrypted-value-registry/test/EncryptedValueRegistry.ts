import { ethers } from "hardhat";
import { biteSetup } from "../../test/fixtures";
import { getPublicKey } from "../../test/cryptography";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

const deployEncryptedValueRegistry = async () => {
    const bite = await biteSetup();
    const encryptedValueRegistry = await ethers.getContractFactory("EncryptedValueRegistry");
    return {bite, encryptedValueRegistry: await encryptedValueRegistry.deploy()};
}


describe("EncryptedValueRegistry", () => {

    it("should deploy and set value", async () => {
        const [, viewer] = await ethers.getSigners();
        const {bite, encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);
        await encryptedValueRegistry.setValue(1337);
        const before = await encryptedValueRegistry.connect(viewer).getEncryptedValue();

        await encryptedValueRegistry.grantAccess(await getPublicKey(viewer), {
            value: 1_000_000_000_000n,
        });

        // Needs to manualy trigger callbacks
        await bite.sendAllCallbacksAllowFailures();

        const after = await encryptedValueRegistry.connect(viewer).getEncryptedValue();

        expect(after).not.to.equal(before);
    });

    it("should only allow owner to set values and grant access", async () => {
        const [, viewer] = await ethers.getSigners();
        const { encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await expect(
            encryptedValueRegistry.connect(viewer).setValue(42)
        ).to.be.revertedWithCustomError(encryptedValueRegistry, "OwnableUnauthorizedAccount");

        await expect(
            encryptedValueRegistry.connect(viewer).grantAccess(await getPublicKey(viewer), {
                value: 1_000_000_000_000n,
            })
        ).to.be.revertedWithCustomError(encryptedValueRegistry, "OwnableUnauthorizedAccount");
    });

    it("should revert grantAccess when callback gas funding is too low", async () => {
        const [, viewer] = await ethers.getSigners();
        const { encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await encryptedValueRegistry.setValue(1337);

        await expect(
            encryptedValueRegistry.grantAccess(await getPublicKey(viewer), {
                value: 1n,
            })
        ).to.be.revertedWithCustomError(encryptedValueRegistry, "NotEnoughValueSentForGas");
    });
});
