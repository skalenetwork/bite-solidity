import { ethers } from "hardhat";
import { biteSetup } from "../../test/fixtures";
import { getPublicKey } from "../../test/cryptography";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

const CALLBACK_FUND = 1_000_000_000_000n;

const deployEncryptedMessenger = async () => {
    const bite = await biteSetup();
    const encryptedMessengerFactory = await ethers.getContractFactory("EncryptedMessenger");
    const encryptedMessenger = await encryptedMessengerFactory.deploy();
    const [user1, user2, user3] = await ethers.getSigners();

    return {
        bite,
        encryptedMessenger,
        user1,
        user2,
        user3,
    };
};

const sessionIdFor = (a: string, b: string): bigint => {
    const [min, max] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return BigInt(ethers.keccak256(ethers.solidityPacked(["address", "address"], [min, max])));
};

const buildPseudoRandomText = (wordCount: number): string => {
    const dictionary = [
        "amber", "binary", "cipher", "delta", "ember", "forest", "galaxy", "harbor",
        "island", "jungle", "kernel", "lattice", "matrix", "nebula", "oracle", "plasma",
        "quantum", "rocket", "signal", "tensor", "uplink", "vector", "whisper", "xenon",
        "yonder", "zenith",
    ];

    const words: string[] = [];
    for (let i = 0; i < wordCount; i++) {
        const idx = (i * 17 + 11) % dictionary.length;
        words.push(dictionary[idx]);
    }
    return words.join(" ");
};

describe("EncryptedMessenger", () => {
    it("should register users and track explicit deposit + withdraw", async () => {
        const { encryptedMessenger, user1 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const depositAmount = ethers.parseEther("0.1");

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey, {
            value: depositAmount,
        });

        expect(await encryptedMessenger.isRegistered(await user1.getAddress())).to.equal(true);
        expect(await encryptedMessenger.userDeposits(await user1.getAddress())).to.equal(depositAmount);

        await expect(encryptedMessenger.connect(user1).withdraw())
            .to.emit(encryptedMessenger, "Withdrawal")
            .withArgs(await user1.getAddress(), depositAmount);

        expect(await encryptedMessenger.userDeposits(await user1.getAddress())).to.equal(0n);
    });

    it("should support funding with receive() and reject empty withdrawals", async () => {
        const { encryptedMessenger, user1 } = await loadFixture(deployEncryptedMessenger);
        const depositAmount = ethers.parseEther("0.05");

        await user1.sendTransaction({
            to: await encryptedMessenger.getAddress(),
            value: depositAmount,
        });

        expect(await encryptedMessenger.userDeposits(await user1.getAddress())).to.equal(depositAmount);

        await encryptedMessenger.connect(user1).withdraw();

        await expect(
            encryptedMessenger.connect(user1).withdraw()
        ).to.be.revertedWith("No funds to withdraw");
    });

    it("should reject unauthorized onDecrypt calls", async () => {
        const { encryptedMessenger, user1 } = await loadFixture(deployEncryptedMessenger);

        await expect(
            encryptedMessenger.connect(user1).onDecrypt([], [])
        ).to.be.revertedWithCustomError(encryptedMessenger, "AccessDenied");
    });

    it("should create a session and distribute user-specific encrypted session keys", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const sessionSecret = ethers.toUtf8Bytes("session-secret");
        const encryptedSessionSecret = await bite.encryptTE.staticCall(sessionSecret);

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);
        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);

        await expect(
            encryptedMessenger.connect(user3).createSession(
                await user1.getAddress(),
                await user2.getAddress(),
                sessionPublicKey,
                encryptedSessionSecret,
                {
                    value: CALLBACK_FUND,
                }
            )
        ).to.be.revertedWithCustomError(encryptedMessenger, "AccessDenied");

        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret,
            {
                value: CALLBACK_FUND,
            }
        );

        expect(
            await encryptedMessenger.sessionExists(await user1.getAddress(), await user2.getAddress())
        ).to.equal(false);

        await bite.sendCallback();

        const sessionId = sessionIdFor(await user1.getAddress(), await user2.getAddress());
        const encryptedForUser1 = await encryptedMessenger.getSessionKeyForUser(sessionId, await user1.getAddress());
        const encryptedForUser2 = await encryptedMessenger.getSessionKeyForUser(sessionId, await user2.getAddress());
        const user1Key = await bite.pubKeyToUint256(user1PublicKey.x, user1PublicKey.y);
        const user2Key = await bite.pubKeyToUint256(user2PublicKey.x, user2PublicKey.y);
        const decryptedForUser1 = await bite.decryptECIES.staticCall(encryptedForUser1, user1Key);
        const decryptedForUser2 = await bite.decryptECIES.staticCall(encryptedForUser2, user2Key);

        expect(
            await encryptedMessenger.sessionExists(await user1.getAddress(), await user2.getAddress())
        ).to.equal(true);
        expect(decryptedForUser1).to.equal(ethers.hexlify(sessionSecret));
        expect(decryptedForUser2).to.equal(ethers.hexlify(sessionSecret));

        await expect(
            encryptedMessenger.connect(user3).getSessionKeyForUser(sessionId, await user3.getAddress())
        ).to.be.revertedWithCustomError(encryptedMessenger, "AccessDenied");
    });

    it("should enforce session creation prerequisites and uniqueness", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const encryptedSessionSecret = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("session-secret"));

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);

        await expect(
            encryptedMessenger.connect(user1).createSession(
                await user1.getAddress(),
                await user2.getAddress(),
                sessionPublicKey,
                encryptedSessionSecret,
                {
                    value: CALLBACK_FUND,
                }
            )
        ).to.be.revertedWithCustomError(encryptedMessenger, "UserNotRegistered");

        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);

        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret,
            {
                value: CALLBACK_FUND,
            }
        );
        await bite.sendCallback();

        await expect(
            encryptedMessenger.connect(user1).createSession(
                await user1.getAddress(),
                await user2.getAddress(),
                sessionPublicKey,
                encryptedSessionSecret,
                {
                    value: CALLBACK_FUND,
                }
            )
        ).to.be.revertedWithCustomError(encryptedMessenger, "SessionAlreadyExistsForUsers");
    });

    it("should send messages through callback and keep stored ciphertext private", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const encryptedSessionSecret = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("session-secret"));

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);
        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);
        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret,
            {
                value: CALLBACK_FUND,
            }
        );
        await bite.sendCallback();

        const plaintextMessage = ethers.toUtf8Bytes("hello encrypted world");
        const encryptedMessage = await bite.encryptTE.staticCall(plaintextMessage);

        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedMessage, {
            value: CALLBACK_FUND,
        });

        expect(
            await encryptedMessenger.getNumberOfMessages(await user1.getAddress(), await user2.getAddress())
        ).to.equal(0n);

        await bite.sendCallback();

        expect(
            await encryptedMessenger.getNumberOfMessages(await user1.getAddress(), await user2.getAddress())
        ).to.equal(1n);

        const messages = await encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 0n, 10n);
        expect(messages.length).to.equal(1);
        expect(messages[0].sender).to.equal(await user1.getAddress());
        expect(messages[0].encryptedContent).not.to.equal("0x");

        const sessionKey = await bite.pubKeyToUint256(sessionPublicKey.x, sessionPublicKey.y);
        const decryptedContent = await bite.decryptECIES.staticCall(messages[0].encryptedContent, sessionKey);
        const decodedContent = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], decryptedContent)[0] as string;

        expect(decodedContent).to.equal(ethers.hexlify(plaintextMessage));
    });

    it("should enforce message/session query guards and pagination edge cases", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const encryptedSessionSecret = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("session-secret"));

        await expect(
            encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 0n, 1n)
        ).to.be.revertedWithCustomError(encryptedMessenger, "NoSessionForUsers");
        await expect(
            encryptedMessenger.getNumberOfMessages(await user1.getAddress(), await user2.getAddress())
        ).to.be.revertedWithCustomError(encryptedMessenger, "NoSessionForUsers");
        await expect(
            encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), "0x")
        ).to.be.revertedWithCustomError(encryptedMessenger, "NoSessionForUsers");

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);
        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);
        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret,
            {
                value: CALLBACK_FUND,
            }
        );
        await bite.sendCallback();

        const encryptedOne = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("m1"));
        const encryptedTwo = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("m2"));
        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedOne, {
            value: CALLBACK_FUND,
        });
        await bite.sendCallback();
        await encryptedMessenger.connect(user2).sendMessage(await user1.getAddress(), encryptedTwo, {
            value: CALLBACK_FUND,
        });
        await bite.sendCallback();

        expect(
            await encryptedMessenger.getNumberOfMessages(await user1.getAddress(), await user2.getAddress())
        ).to.equal(2n);

        const none = await encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 2n, 10n);
        expect(none.length).to.equal(0);

        await expect(
            encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 3n, 1n)
        ).to.be.revertedWithCustomError(encryptedMessenger, "WrongQuery");

        await expect(
            encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 0n, 0n)
        ).to.be.revertedWithCustomError(encryptedMessenger, "WrongQuery");

        const capped = await encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 0n, 201n);
        expect(capped.length).to.equal(2);
    });

    it("should use deposited funds for callbacks", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const encryptedSessionSecret = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("session-secret"));

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);
        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);

        await expect(
            encryptedMessenger.connect(user1).createSession(
                await user1.getAddress(),
                await user2.getAddress(),
                sessionPublicKey,
                encryptedSessionSecret
            )
        ).to.be.revertedWithCustomError(encryptedMessenger, "NotEnoughFundsForCallback");

        await encryptedMessenger.connect(user1).deposit({
            value: CALLBACK_FUND * 2n,
        });

        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret
        );
        await bite.sendCallback();


        const encryptedMessage = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("m1"));
        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedMessage);
        await bite.sendCallback();
        expect(
            await encryptedMessenger.getNumberOfMessages(await user1.getAddress(), await user2.getAddress())
        ).to.equal(1n);
    });

    it("should allow empty, small, and large messages", async () => {
        const { bite, encryptedMessenger, user1, user2, user3 } = await loadFixture(deployEncryptedMessenger);
        const user1PublicKey = await getPublicKey(user1);
        const user2PublicKey = await getPublicKey(user2);
        const sessionPublicKey = await getPublicKey(user3);
        const encryptedSessionSecret = await bite.encryptTE.staticCall(ethers.toUtf8Bytes("session-secret"));

        await encryptedMessenger.connect(user1).registerUser(user1PublicKey);
        await encryptedMessenger.connect(user2).registerUser(user2PublicKey);
        await encryptedMessenger.connect(user1).createSession(
            await user1.getAddress(),
            await user2.getAddress(),
            sessionPublicKey,
            encryptedSessionSecret,
            {
                value: CALLBACK_FUND,
            }
        );
        await bite.sendCallback();

        const emptyMessage = ethers.toUtf8Bytes("");
        const smallMessage = ethers.toUtf8Bytes("hi");
        const largeMessageText = buildPseudoRandomText(500);
        const largeMessage = ethers.toUtf8Bytes(largeMessageText);

        const encryptedEmpty = await bite.encryptTE.staticCall(emptyMessage);
        const encryptedSmall = await bite.encryptTE.staticCall(smallMessage);
        const encryptedLarge = await bite.encryptTE.staticCall(largeMessage);

        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedEmpty, {
            value: CALLBACK_FUND,
        });
        await bite.sendCallback();

        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedSmall, {
            value: CALLBACK_FUND,
        });
        await bite.sendCallback();

        // Very expensive message
        await encryptedMessenger.connect(user1).sendMessage(await user2.getAddress(), encryptedLarge, {
            value: CALLBACK_FUND * 10n,
        });
        await bite.sendCallback();

        const messages = await encryptedMessenger.getMessages(await user1.getAddress(), await user2.getAddress(), 0n, 10n);
        expect(messages.length).to.equal(3);

        const sessionKey = await bite.pubKeyToUint256(sessionPublicKey.x, sessionPublicKey.y);
        const decodeStoredMessage = async (encryptedContent: string): Promise<string> => {
            const decryptedContent = await bite.decryptECIES.staticCall(encryptedContent, sessionKey);
            return ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], decryptedContent)[0] as string;
        };

        const decodedEmpty = await decodeStoredMessage(messages[0].encryptedContent);
        const decodedSmall = await decodeStoredMessage(messages[1].encryptedContent);
        const decodedLarge = await decodeStoredMessage(messages[2].encryptedContent);

        expect(decodedEmpty).to.equal("0x");
        expect(decodedSmall).to.equal(ethers.hexlify(smallMessage));
        expect(decodedLarge).to.equal(ethers.hexlify(largeMessage));
    });
});
