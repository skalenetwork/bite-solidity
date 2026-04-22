import { ethers } from "hardhat";
import { biteSetup } from "../../test/fixtures";
import { getPublicKey } from "../../test/cryptography";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

// cspell:words ciphertext

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

        // Needs to manually trigger callbacks
        await bite.sendCallback();

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

    it("should reject onDecrypt calls from unauthorized senders", async () => {
        const [, viewer] = await ethers.getSigners();
        const { encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await expect(
            encryptedValueRegistry.connect(viewer).onDecrypt([], [])
        ).to.be.revertedWithCustomError(encryptedValueRegistry, "AccessDenied");
    });

    it("should revert grantAccess before a value is set", async () => {
        const [, viewer] = await ethers.getSigners();
        const { encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await expect(
            encryptedValueRegistry.grantAccess(await getPublicKey(viewer), {
                value: 1_000_000_000_000n,
            })
        ).to.be.reverted;
    });

    it("should enforce callback gas funding boundary conditions", async () => {
        const [, viewer] = await ethers.getSigners();
        const { bite, encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await encryptedValueRegistry.setValue(1337);
        const publicKey = await getPublicKey(viewer);
        const minCallbackGas = await encryptedValueRegistry.minCallbackGas();
        const feeData = await ethers.provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? 1_000_000_000n;

        await expect(
            encryptedValueRegistry.grantAccess(publicKey, {
                value: minCallbackGas * gasPrice,
                gasPrice,
            })
        ).to.be.revertedWithCustomError(encryptedValueRegistry, "NotEnoughValueSentForGas");

        await expect(
            encryptedValueRegistry.grantAccess(publicKey, {
                value: (minCallbackGas + 1n) * gasPrice,
                gasPrice,
            })
        ).not.to.be.reverted;

        await expect(
            bite.sendCallback()
        ).not.to.be.reverted;
    });


    it("should isolate encrypted values per granted viewer", async () => {
        const [, viewerA, viewerB, viewerC] = await ethers.getSigners();
        const { bite, encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);

        await encryptedValueRegistry.setValue(1337);

        await encryptedValueRegistry.grantAccess(await getPublicKey(viewerA), {
            value: 1_000_000_000_000n,
        });
        await bite.sendCallback();

        await encryptedValueRegistry.grantAccess(await getPublicKey(viewerB), {
            value: 1_000_000_000_000n,
        });
        await bite.sendCallback();

        const valueA = await encryptedValueRegistry.connect(viewerA).getEncryptedValue();
        const valueB = await encryptedValueRegistry.connect(viewerB).getEncryptedValue();
        const valueC = await encryptedValueRegistry.connect(viewerC).getEncryptedValue();

        expect(valueA).not.to.equal("0x");
        expect(valueB).not.to.equal("0x");
        expect(valueC).to.equal("0x");
    });

    it("should update viewer ciphertext after owner updates the underlying value", async () => {
        const [, viewer] = await ethers.getSigners();
        const { bite, encryptedValueRegistry } = await loadFixture(deployEncryptedValueRegistry);
        const publicKey = await getPublicKey(viewer);

        await encryptedValueRegistry.setValue(1337);
        await encryptedValueRegistry.grantAccess(publicKey, {
            value: 1_000_000_000_000n,
        });
        await bite.sendCallback();
        const firstCiphertext = await encryptedValueRegistry.connect(viewer).getEncryptedValue();

        await encryptedValueRegistry.setValue(42);
        await encryptedValueRegistry.grantAccess(publicKey, {
            value: 1_000_000_000_000n,
        });
        await bite.sendCallback();
        const secondCiphertext = await encryptedValueRegistry.connect(viewer).getEncryptedValue();

        expect(firstCiphertext).not.to.equal("0x");
        expect(secondCiphertext).not.to.equal("0x");
        expect(secondCiphertext).not.to.equal(firstCiphertext);
    });
});
