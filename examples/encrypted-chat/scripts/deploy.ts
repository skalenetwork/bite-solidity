import { Wallet } from "ethers";
import { ethers } from "hardhat";
import { verify } from "@skalenetwork/upgrade-tools";
import { BITE } from "@skalenetwork/bite";
import { privateKeyToPublicKey } from "../../scripts/utils";

const getRequiredEnv = (name: string): string => {
	if (!process.env[name]) {
		throw new Error(`Missing required env var: ${name}`);
	}
	return process.env[name]!;
};

const waitForSession = async (
	contract: { sessionExists: (user1: string, user2: string) => Promise<boolean> },
	user1: string,
	user2: string,
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<void> => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const exists: boolean = await contract.sessionExists(user1, user2);
		if (exists) return;
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	throw new Error("Timed out waiting for session creation callback");
};

const main = async () => {
	const [deployer] = await ethers.getSigners();
	const deployerAddress = await deployer.getAddress();

	console.log(`Deployer: ${deployerAddress}`);

	const factory = await ethers.getContractFactory("EncryptedMessenger");
	const messenger = await factory.connect(deployer).deploy();

	await messenger.waitForDeployment();
	const messengerAddress = await messenger.getAddress();

	console.log(`EncryptedMessenger deployed at: ${messengerAddress}`);

	await verify("EncryptedMessenger", messengerAddress);
	console.log("EncryptedMessenger verified.");

	// ── Smoke test ──

	console.log("\n--- Smoke Test ---\n");

	const endpoint = getRequiredEnv("ENDPOINT");
	const deployerPrivateKey = getRequiredEnv("PRIVATE_KEY");
	const bite = new BITE(endpoint);

	// 1. Register deployer
	const deployerPublicKey = privateKeyToPublicKey(deployerPrivateKey);
	const regTx1 = await messenger.connect(deployer).registerUser(deployerPublicKey);
	await regTx1.wait();
	console.log("Deployer registered.");

	// 2. Create a random second user and fund it
	const user2Wallet = Wallet.createRandom().connect(ethers.provider);
	const fundTx = await deployer.sendTransaction({
		to: user2Wallet.address,
		value: ethers.parseEther("1"),
	});
	await fundTx.wait();
	console.log(`User2 (${user2Wallet.address}) funded with 1 ETH.`);

	// 3. Register second user
	const user2PublicKey = privateKeyToPublicKey(user2Wallet.privateKey);
	const regTx2 = await messenger.connect(user2Wallet).registerUser(user2PublicKey);
	await regTx2.wait();
	console.log("User2 registered.");

	// Verify registrations
	const [reg1, reg2] = await Promise.all([
		messenger.isRegistered(deployerAddress),
		messenger.isRegistered(user2Wallet.address),
	]);
	if (!reg1 || !reg2) throw new Error("Registration check failed");
	console.log("Both users confirmed registered.");

	// 4. Create session between the two
	const sessionWallet = Wallet.createRandom();
	const sessionPublicKey = privateKeyToPublicKey(sessionWallet.privateKey);
	const encryptedSessionKey = await bite.encryptMessageForCTX(
		sessionWallet.privateKey,
		messengerAddress,
	);

	const sessionCreationGas: bigint = await messenger.sessionCreationGas();
	const feeData = await ethers.provider.getFeeData();
	const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
	const callbackValue = (sessionCreationGas + 1n) * gasPrice * 2n;

	const sessionTx = await messenger.connect(deployer).createSession(
		deployerAddress,
		user2Wallet.address,
		sessionPublicKey,
		ethers.getBytes(encryptedSessionKey),
		{ value: callbackValue, gasLimit: 500_000 },
	);
	await sessionTx.wait();
	console.log("createSession tx confirmed — waiting for callback...");
	await waitForSession(messenger, deployerAddress, user2Wallet.address, 20_000, 2_000);
	console.log("Session created successfully!");
	console.log("\n--- Smoke Test Passed ---\n");
};

if (require.main === module) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
