import { ethers } from "hardhat";
import { biteSetup } from "../../test/fixtures";
import { getPublicKey } from "../../test/cryptography";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const READER_ROLE = ethers.id("READER_ROLE");
const WRITER_ROLE = ethers.id("WRITER_ROLE");
const DEFAULT_GAS_PRICE = 1_000_000_000n;

const toHex = (value: Uint8Array): string => ethers.hexlify(value);

const deployRoleBasedValueRegistry = async () => {
    const bite = await biteSetup();
    const [admin, userA, userB, userC] = await ethers.getSigners();
    const adminPublicKey = await getPublicKey(admin);
    const adminRolePublicKey = await getPublicKey(userA);
    const adminRoleSecretPlaintext = ethers.toUtf8Bytes("admin-role-secret");
    const encryptedAdminRoleSecret = await bite.encryptTE.staticCall(adminRoleSecretPlaintext);
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? DEFAULT_GAS_PRICE;
    const callbackValue = (500_000n + 1n) * gasPrice;

    const roleBasedValueRegistryFactory = await ethers.getContractFactory("RoleBasedValueRegistry");
    const roleBasedValueRegistry = await roleBasedValueRegistryFactory.deploy(
        adminRolePublicKey,
        adminPublicKey,
        encryptedAdminRoleSecret,
        {
            value: callbackValue,
            gasPrice,
        }
    );

    return {
        bite,
        roleBasedValueRegistry,
        admin,
        userA,
        userB,
        userC,
        gasPrice,
        callbackValue,
        adminPublicKey,
        adminRolePublicKey,
        adminRoleSecretPlaintext: toHex(adminRoleSecretPlaintext),
    };
};

const deployBootstrappedRoleBasedValueRegistry = async () => {
    const deployment = await deployRoleBasedValueRegistry();
    await deployment.bite.sendCallback();
    return deployment;
};

describe("RoleBasedValueRegistry", () => {
    it("should bootstrap ADMIN_ROLE through callback during deployment", async () => {
        const {
            bite,
            roleBasedValueRegistry,
            admin,
            adminPublicKey,
            adminRoleSecretPlaintext,
        } = await loadFixture(deployRoleBasedValueRegistry);

        await expect(
            roleBasedValueRegistry.getMyEncryptedRoleSecret(ADMIN_ROLE)
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");

        await bite.sendCallback();

        const encryptedSecret = await roleBasedValueRegistry
            .connect(admin)
            .getMyEncryptedRoleSecret(ADMIN_ROLE);
        const adminKey = await bite.pubKeyToUint256(adminPublicKey.x, adminPublicKey.y);
        const decryptedSecret = await bite.decryptECIES.staticCall(encryptedSecret, adminKey);

        expect(decryptedSecret).to.equal(adminRoleSecretPlaintext);
    });

    it("should reject deployment when admin public key does not match sender", async () => {
        const bite = await biteSetup();
        const [admin, userA, userB] = await ethers.getSigners();
        const mismatchedAdminPublicKey = await getPublicKey(userA);
        const adminRolePublicKey = await getPublicKey(userB);
        const encryptedAdminRoleSecret = await bite.encryptTE.staticCall(
            ethers.toUtf8Bytes("admin-role-secret")
        );
        const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? DEFAULT_GAS_PRICE;
        const callbackValue = (500_000n + 1n) * gasPrice;
        const roleBasedValueRegistryFactory = await ethers.getContractFactory("RoleBasedValueRegistry");

        await expect(
            roleBasedValueRegistryFactory.connect(admin).deploy(
                adminRolePublicKey,
                mismatchedAdminPublicKey,
                encryptedAdminRoleSecret,
                {
                    value: callbackValue,
                    gasPrice,
                }
            )
        ).to.be.revertedWithCustomError(roleBasedValueRegistryFactory, "PubKeyMustMatchSender");
    });

    it("should reject onDecrypt calls from unauthorized senders", async () => {
        const { roleBasedValueRegistry, userA } = await loadFixture(deployRoleBasedValueRegistry);

        await expect(
            roleBasedValueRegistry.connect(userA).onDecrypt([], [])
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");
    });

    it("should allow only admins to create roles and reject duplicates", async () => {
        const { bite, roleBasedValueRegistry, userA, userB } = await loadFixture(deployBootstrappedRoleBasedValueRegistry);
        const readerRolePublicKey = await getPublicKey(userA);
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(
            ethers.toUtf8Bytes("reader-role-secret")
        );

        await expect(
            roleBasedValueRegistry.connect(userB).createRole(
                READER_ROLE,
                readerRolePublicKey,
                encryptedReaderRoleSecret
            )
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");

        await expect(
            roleBasedValueRegistry.createRole(
                READER_ROLE,
                readerRolePublicKey,
                encryptedReaderRoleSecret
            )
        ).not.to.be.reverted;

        await expect(
            roleBasedValueRegistry.createRole(
                READER_ROLE,
                readerRolePublicKey,
                encryptedReaderRoleSecret
            )
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "RoleAlreadyExists");
    });

    it("should allow admins to grant roles and users to read their encrypted role secret", async () => {
        const { bite, roleBasedValueRegistry, userA, userB, gasPrice } = await loadFixture(
            deployBootstrappedRoleBasedValueRegistry
        );
        const readerRolePublicKey = await getPublicKey(userA);
        const userPublicKey = await getPublicKey(userB);
        const readerRoleSecretPlaintext = ethers.toUtf8Bytes("reader-role-secret");
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(readerRoleSecretPlaintext);

        await roleBasedValueRegistry.createRole(READER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret);
        await expect(
            roleBasedValueRegistry.connect(userB).grantRole(READER_ROLE, userPublicKey, {
                value: (500_000n + 1n) * gasPrice,
                gasPrice,
            })
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");

        await roleBasedValueRegistry.grantRole(READER_ROLE, userPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        const encryptedUserSecret = await roleBasedValueRegistry.connect(userB).getMyEncryptedRoleSecret(READER_ROLE);
        const userKey = await bite.pubKeyToUint256(userPublicKey.x, userPublicKey.y);
        const decryptedUserSecret = await bite.decryptECIES.staticCall(encryptedUserSecret, userKey);

        expect(decryptedUserSecret).to.equal(toHex(readerRoleSecretPlaintext));
    });

    it("should allow role members to grant that same role", async () => {
        const { bite, roleBasedValueRegistry, userA, userB, userC, gasPrice } = await loadFixture(
            deployBootstrappedRoleBasedValueRegistry
        );
        const readerRolePublicKey = await getPublicKey(userA);
        const userBPublicKey = await getPublicKey(userB);
        const userCPublicKey = await getPublicKey(userC);
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(
            ethers.toUtf8Bytes("reader-role-secret")
        );

        await roleBasedValueRegistry.createRole(READER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret);

        await roleBasedValueRegistry.grantRole(READER_ROLE, userBPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        await expect(
            roleBasedValueRegistry.connect(userB).grantRole(READER_ROLE, userCPublicKey, {
                value: (500_000n + 1n) * gasPrice,
                gasPrice,
            })
        ).not.to.be.reverted;
        await bite.sendCallback();

        const userCSecret = await roleBasedValueRegistry.connect(userC).getMyEncryptedRoleSecret(READER_ROLE);
        expect(userCSecret).not.to.equal("0x");
    });

    it("should reject duplicate role grants during callback processing", async () => {
        const { bite, roleBasedValueRegistry, userA, userB, gasPrice } = await loadFixture(
            deployBootstrappedRoleBasedValueRegistry
        );
        const readerRolePublicKey = await getPublicKey(userA);
        const userPublicKey = await getPublicKey(userB);
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(
            ethers.toUtf8Bytes("reader-role-secret")
        );

        await roleBasedValueRegistry.createRole(READER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret);

        await roleBasedValueRegistry.grantRole(READER_ROLE, userPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });

        await roleBasedValueRegistry.grantRole(READER_ROLE, userPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });

        await bite.sendCallback();

        await expect(
            bite.sendCallback()
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "UserAlreadyHasRole");
    });

    it("should allow only role members to submit and update encrypted role values", async () => {
        const { bite, roleBasedValueRegistry, userA, userB, gasPrice } = await loadFixture(
            deployBootstrappedRoleBasedValueRegistry
        );
        const readerRolePublicKey = await getPublicKey(userA);
        const readerRoleSecret = ethers.toUtf8Bytes("reader-role-secret");
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(readerRoleSecret);
        const userAPublicKey = await getPublicKey(userA);
        const firstPlaintext = ethers.toUtf8Bytes("first confidential reader value");
        const secondPlaintext = ethers.toUtf8Bytes("second confidential reader value");
        const encryptedFirstPlaintext = await bite.encryptTE.staticCall(firstPlaintext);
        const encryptedSecondPlaintext = await bite.encryptTE.staticCall(secondPlaintext);

        await roleBasedValueRegistry.createRole(READER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret);
        await roleBasedValueRegistry.grantRole(READER_ROLE, userAPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        await expect(
            roleBasedValueRegistry.connect(userB).encryptForRole(READER_ROLE, encryptedFirstPlaintext, {
                value: (500_000n + 1n) * gasPrice,
                gasPrice,
            })
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");

        await roleBasedValueRegistry.connect(userA).encryptForRole(READER_ROLE, encryptedFirstPlaintext, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        const roleKey = await bite.pubKeyToUint256(readerRolePublicKey.x, readerRolePublicKey.y);
        const firstStoredValue = await roleBasedValueRegistry.getValueForRole(READER_ROLE);
        const decryptedFirstValue = await bite.decryptECIES.staticCall(firstStoredValue, roleKey);
        expect(decryptedFirstValue).to.equal(toHex(firstPlaintext));

        await roleBasedValueRegistry.connect(userA).encryptForRole(READER_ROLE, encryptedSecondPlaintext, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        const secondStoredValue = await roleBasedValueRegistry.getValueForRole(READER_ROLE);
        const decryptedSecondValue = await bite.decryptECIES.staticCall(secondStoredValue, roleKey);
        expect(secondStoredValue).not.to.equal(firstStoredValue);
        expect(decryptedSecondValue).to.equal(toHex(secondPlaintext));
    });

    it("should enforce callback gas funding boundaries", async () => {
        const { bite, roleBasedValueRegistry, userA, userB, gasPrice } = await loadFixture(
            deployBootstrappedRoleBasedValueRegistry
        );
        const minCallbackGas = await roleBasedValueRegistry.minCallbackGas();
        const userPublicKey = await getPublicKey(userA);
        const encryptedValue = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("admin confidential value"));
        const readerRolePublicKey = await getPublicKey(userB);
        const encryptedReaderRoleSecret = await bite.encryptTE.staticCall(
            ethers.toUtf8Bytes("reader-role-secret")
        );

        await roleBasedValueRegistry.createRole(WRITER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret);
        await roleBasedValueRegistry.grantRole(WRITER_ROLE, userPublicKey, {
            value: (500_000n + 1n) * gasPrice,
            gasPrice,
        });
        await bite.sendCallback();

        await expect(
            roleBasedValueRegistry.grantRole(ADMIN_ROLE, userPublicKey, {
                value: minCallbackGas * gasPrice,
                gasPrice,
            })
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "NotEnoughValueSentForGas");

        await expect(
            roleBasedValueRegistry.connect(userA).encryptForRole(WRITER_ROLE, encryptedValue, {
                value: minCallbackGas * gasPrice,
                gasPrice,
            })
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "NotEnoughValueSentForGas");

        await expect(
            roleBasedValueRegistry.grantRole(ADMIN_ROLE, userPublicKey, {
                value: (minCallbackGas + 1n) * gasPrice,
                gasPrice,
            })
        ).not.to.be.reverted;

        await expect(
            bite.sendCallback()
        ).not.to.be.reverted;
    });

    it("should revert on unknown roles and unauthorized secret reads", async () => {
        const { roleBasedValueRegistry, userA } = await loadFixture(deployBootstrappedRoleBasedValueRegistry);

        await expect(
            roleBasedValueRegistry.getValueForRole(READER_ROLE)
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "RoleDoesNotExist");

        await expect(
            roleBasedValueRegistry.connect(userA).getMyEncryptedRoleSecret(ADMIN_ROLE)
        ).to.be.revertedWithCustomError(roleBasedValueRegistry, "AccessDenied");
    });
});
