// cspell:words ciphertext

import { AbiCoder, Signer, Wallet, getCreateAddress } from "ethers";
import { ethers } from "hardhat";
import { BITE } from "@skalenetwork/bite";
import { SealedBidAuction, MockERC20, MockERC721 } from "../typechain-types";

const getRequiredEnvironmentVariable = (name: string): string => {
    if (!process.env[name]) {
        throw new Error(`Please set value for ${name} environment variable`);
    }
    return process.env[name]!;
};

const sleep = async (delayMs: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const waitForCondition = async (
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    pollIntervalMs: number,
    label: string
): Promise<void> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timed out waiting for ${label}`);
};

const main = async () => {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    const endpoint = getRequiredEnvironmentVariable("ENDPOINT");
    const bite = new BITE(endpoint);

    const feeData = await ethers.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 1_000_000_000n;

    console.log(`Deployer:  ${deployerAddress}`);
    console.log(`Gas price: ${gasPrice.toString()}`);

    // ══════════════════════════════════════════════════════════════════
    // ── Deploy mocks and setup ───────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    const TOKEN_ID = 1n;
    const MINIMUM_BID = ethers.parseEther("100");
    const AUCTION_DURATION = 120n; // seconds

    const nftFactory = await ethers.getContractFactory("MockERC721");
    const mockNft = await nftFactory.deploy() as MockERC721;
    await mockNft.waitForDeployment();
    const nftAddress = await mockNft.getAddress();
    console.log(`MockERC721 deployed at: ${nftAddress}`);

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const mockToken = await tokenFactory.deploy() as MockERC20;
    await mockToken.waitForDeployment();
    const tokenAddress = await mockToken.getAddress();
    console.log(`MockERC20 deployed at:  ${tokenAddress}`);

    await (await mockNft.mint(deployerAddress, TOKEN_ID)).wait();
    console.log(`Minted NFT #${TOKEN_ID} to deployer`);

    type BidParticipant = {
        label: string;
        amount: bigint;
        signer: Signer;
        address: string;
    };

    const satelliteBidderConfigs = [
        { amount: ethers.parseEther("500"), label: "Bidder A (500)" },
        { amount: ethers.parseEther("1000"), label: "Bidder B (1000)" },
        { amount: ethers.parseEther("750"), label: "Bidder C (750)" },
    ];

    const satelliteBidders: BidParticipant[] = await Promise.all(
        satelliteBidderConfigs.map(async (config) => {
            const wallet = Wallet.createRandom().connect(ethers.provider);
            return {
                ...config,
                signer: wallet,
                address: await wallet.getAddress(),
            };
        }),
    );

    const deployerBidAmount = ethers.parseEther("1500");
    const bidders: BidParticipant[] = [
        {
            label: "Deployer (1500) — expected winner",
            amount: deployerBidAmount,
            signer: deployer,
            address: deployerAddress,
        },
        ...satelliteBidders,
    ];

    for (const bidder of satelliteBidders) {
        await (await deployer.sendTransaction({
            to: bidder.address,
            value: ethers.parseEther("0.1"),
        })).wait();
        await (await mockToken.mint(bidder.address, ethers.parseEther("10000"))).wait();
        console.log(`Funded ${bidder.label}: ${bidder.address}`);
    }
    await (await mockToken.mint(deployerAddress, ethers.parseEther("10000"))).wait();
    console.log(`Minted ERC20 to deployer for bidding: ${deployerAddress}`);

    // ══════════════════════════════════════════════════════════════════
    // ── Deploy SealedBidAuction ──────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    // The constructor calls nft.transferFrom(msg.sender, address(this), tokenId),
    // so we must approve BEFORE deploying. Predict the deploy address via nonce.
    const pendingNonce = await ethers.provider.getTransactionCount(deployerAddress, "pending");
    const deployNonce = pendingNonce + 1; // +1 for the approve tx below
    const auctionAddress = getCreateAddress({ from: deployerAddress, nonce: deployNonce });
    console.log(`\nPredicted auction address: ${auctionAddress}`);

    await (await mockNft.approve(auctionAddress, TOKEN_ID)).wait();
    console.log(`NFT #${TOKEN_ID} approved for auction contract`);

    const TOP_WINNERS_COUNT = 3n; // Set to 3 Max number of winners

    const auctionFactory = await ethers.getContractFactory("SealedBidAuction");
    const auction = await auctionFactory.deploy(
        nftAddress,
        TOKEN_ID,
        MINIMUM_BID,
        tokenAddress,
        TOP_WINNERS_COUNT,
    ) as SealedBidAuction;
    await auction.waitForDeployment();

    const deployedAddress = await auction.getAddress();
    if (deployedAddress.toLowerCase() !== auctionAddress.toLowerCase()) {
        throw new Error(
            `Predicted address ${auctionAddress} does not match deployed ${deployedAddress}`
        );
    }
    console.log(`SealedBidAuction deployed at: ${deployedAddress}`);

    const nftOwner = await mockNft.ownerOf(TOKEN_ID);
    if (nftOwner.toLowerCase() !== deployedAddress.toLowerCase()) {
        throw new Error("NFT not held by auction contract after deployment");
    }
    console.log(`NFT ownership transferred to contract`);

    // Fund the contract with extra ETH so it can pay for the batch-processing
    // and winner-calculation CTX callbacks that happen after bidding closes.
    //await (await deployer.sendTransaction({
    //    to: deployedAddress,
    //    value: ethers.parseEther("0.1"),
    //})).wait();
    //console.log(`Funded auction contract with 0.1 ETH for CTX processing`);

    const minimumDepositPerBid = await auction.minimumDepositPerBid();
    console.log(`minimumDepositPerBid: ${minimumDepositPerBid.toString()} wei`);

    // Each bidder approves the auction contract to pull minimumBid in ERC20
    // (this transferFrom happens inside the BITE callback, not the bidder's tx)
    for (const bidder of bidders) {
        const token = mockToken.connect(bidder.signer) as MockERC20;
        await (await token.approve(deployedAddress, MINIMUM_BID)).wait();
    }
    console.log(`All bidders approved ERC20 allowance (${ethers.formatEther(MINIMUM_BID)} each)`);

    // ══════════════════════════════════════════════════════════════════
    // ── Start auction and place bids ─────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    const startBlock = await ethers.provider.getBlock("latest");
    const endTime = BigInt(startBlock!.timestamp) + AUCTION_DURATION;
    await (await auction.startAuction(endTime, { value: 450_000n * gasPrice })).wait();
    console.log(`\nAuction started — ends at timestamp ${endTime.toString()} (${AUCTION_DURATION}s from now)`);
    console.log(`Auction state: ${(await auction.state()).toString()} (1 = OPEN)`);

    const depositPerBid = minimumDepositPerBid; // TODO: Optionally add buffer

    for (const bidder of bidders) {
        const encodedBid = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256"],
            [bidder.address, bidder.amount],
        );
        const encryptedBid = await bite.encryptMessageForCTX(encodedBid, deployedAddress);
        console.log(`  ${bidder.label}: encrypted bid (${ethers.dataLength(encryptedBid)} bytes)`);
        const balanceContractBefore = await ethers.provider.getBalance(deployedAddress);
        console.log(`  ${bidder.label}: balance contract before: ${ethers.formatEther(balanceContractBefore)}`);
        const bidAuction = auction.connect(bidder.signer) as SealedBidAuction;
        const bidTx = await bidAuction.sendBid(encryptedBid, {
            value: depositPerBid,
        });
        const bidReceipt = await bidTx.wait();
        if (!bidReceipt) {
            throw new Error(`No receipt for ${bidder.label} sendBid transaction`);
        }
        const tx = await ethers.provider.getTransaction(bidTx.hash);
        const txGasPrice = tx?.gasPrice ?? null;
        console.log(`  ${bidder.label}: tx gasPrice=${bidReceipt.gasPrice?.toString() ?? "n/a"} type=${bidReceipt.type}`);
        if (txGasPrice !== null) {
            const expectedCtxFunding = 500_000n * txGasPrice;
            const expectedNet = depositPerBid - expectedCtxFunding;
            console.log(`  ${bidder.label}: signed tx gasPrice=${txGasPrice.toString()}`);
            console.log(`  ${bidder.label}: expected net deposit delta=${expectedNet.toString()} wei`);
        }
        const balanceContractAfter = await ethers.provider.getBalance(deployedAddress);
        console.log(`  ${bidder.label}: balance contract after: ${ethers.formatEther(balanceContractAfter)}`);
        const difference = balanceContractAfter - balanceContractBefore;
        const toGas = difference / ethers.parseEther("0.0000000000001");

        console.log(`  ${bidder.label}: toGas: ${toGas.toString()}`);
        console.log(`    sendBid confirmed`);
    }

    // ══════════════════════════════════════════════════════════════════
    // ── Wait for bid callbacks ───────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    console.log(`\nWaiting for BITE bid callbacks...`);

    for (const bidder of bidders) {
        await waitForCondition(
            async () => (await auction.numBids(bidder.address)) >= 1n,
            20_000,
            2_000,
            `bid callback for ${bidder.label}`,
        );
        const count = await auction.numBids(bidder.address);
        console.log(`  ${bidder.label}: ${count.toString()} bid(s) registered`);
    }

    // Verify that each unique bidder had minimumBid ERC20 locked
    const lockedTokens = await mockToken.balanceOf(deployedAddress);
    const expectedLocked = MINIMUM_BID * BigInt(bidders.length);
    console.log(`\nERC20 locked in contract: ${ethers.formatEther(lockedTokens)} (expected ${ethers.formatEther(expectedLocked)})`);
    if (lockedTokens !== expectedLocked) {
        throw new Error(
            `Locked token mismatch: got ${lockedTokens.toString()}, expected ${expectedLocked.toString()}`
        );
    }

    // ══════════════════════════════════════════════════════════════════
    // ── Wait for auction end and start processing ────────────────────
    // ══════════════════════════════════════════════════════════════════

    const blockNow = await ethers.provider.getBlock("latest");
    const currentTimestamp = BigInt(blockNow!.timestamp);

    if (currentTimestamp < endTime) {
        const remainingSeconds = Number(endTime - currentTimestamp) + 5; // +5 s buffer
        console.log(`\nWaiting ${remainingSeconds}s for auction end time...`);
        await sleep(remainingSeconds * 1_000);
    }

    const ethBefore = await ethers.provider.getBalance(deployedAddress);
    console.log(`\nContract ETH balance before processing: ${ethers.formatEther(ethBefore)}`);

    await (await auction.startProcessingBids()).wait();
    console.log(`startProcessingBids() submitted`);
    console.log(`Auction state: ${(await auction.state()).toString()} (2 = PROCESSING)`);

    // ══════════════════════════════════════════════════════════════════
    // ── Wait for finalization ────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    const FINALIZED = 3n;
    console.log(`\nPolling for FINALIZED state...`);

    await waitForCondition(
        async () => (await auction.state()) === FINALIZED,
        300_000, // 5-minute timeout for all processing + winner CTX chains
        5_000,
        "auction finalization (state == FINALIZED)",
    );
    console.log(`Auction state: ${(await auction.state()).toString()} (3 = FINALIZED)`);

    // ══════════════════════════════════════════════════════════════════
    // ── Verify results ───────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    const onChainTopN = await auction.topWinnersCount();
    if (onChainTopN !== TOP_WINNERS_COUNT) {
        throw new Error(
            `topWinnersCount: expected ${TOP_WINNERS_COUNT.toString()}, got ${onChainTopN.toString()}`
        );
    }

    const rankedCount = await auction.rankedTopBidderCount();
    const expectedRanked = BigInt(Math.min(bidders.length, Number(TOP_WINNERS_COUNT)));
    if (rankedCount !== expectedRanked) {
        throw new Error(
            `rankedTopBidderCount: expected ${expectedRanked.toString()}, got ${rankedCount.toString()}`
        );
    }

    const expectedLeaderboard = [...bidders]
        .sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0))
        .slice(0, Number(TOP_WINNERS_COUNT));

    // `winner` is only set during settleAuction(); the leaderboard loop below validates rank 0.
    console.log(`\nTop-${TOP_WINNERS_COUNT.toString()} leaderboard (getTopBid):`);
    for (let i = 0; i < expectedLeaderboard.length; i++) {
        const [addr, amt] = await auction.getTopBid(BigInt(i));
        const exp = expectedLeaderboard[i];
        console.log(`  #${i}: ${addr} — ${ethers.formatEther(amt)} (${exp.label})`);
        if (addr.toLowerCase() !== exp.address.toLowerCase()) {
            throw new Error(
                `getTopBid(${i}): expected bidder ${exp.address}, got ${addr}`
            );
        }
        if (amt !== exp.amount) {
            throw new Error(
                `getTopBid(${i}): expected amount ${exp.amount.toString()}, got ${amt.toString()}`
            );
        }
        if (!(await auction.isRankedTopWinner(addr))) {
            throw new Error(`isRankedTopWinner(${addr}) should be true for rank ${i}`);
        }
    }

    if (await auction.isRankedTopWinner(ethers.ZeroAddress)) {
        throw new Error("isRankedTopWinner(zero) should be false");
    }

    let getTopBidOutOfRangeReverted = false;
    try {
        await auction.getTopBid(TOP_WINNERS_COUNT);
    } catch {
        getTopBidOutOfRangeReverted = true;
    }
    if (!getTopBidOutOfRangeReverted) {
        throw new Error(
            `getTopBid(${TOP_WINNERS_COUNT.toString()}) should revert (IndexOutOfBounds)`
        );
    }

    // ══════════════════════════════════════════════════════════════════
    // ── Settle the auction ───────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    // expectedLeaderboard[0] = Deployer (1500): the initial MINIMUM_BID allowance was fully
    // consumed during bid registration, leaving zero extra allowance → will be disqualified.
    // expectedLeaderboard[1] = Bidder B (1000): approves the remaining (bid - minimumBid)
    // before settlement → will win the NFT.
    const disqualifiedBidder = expectedLeaderboard[0];
    const auctionWinner = expectedLeaderboard[1];

    console.log(`\n── Settlement ─────────────────────────────────────────────────`);
    console.log(`Rank 0: ${disqualifiedBidder.label} → no extra allowance → disqualified`);
    console.log(`Rank 1: ${auctionWinner.label} → approves extra allowance → expected winner`);

    // Approve bid.amount - minimumBid (the portion the auction pulls in at settlement).
    // The earlier MINIMUM_BID approval was consumed when the bid was registered.
    const extraAllowance = auctionWinner.amount - MINIMUM_BID;
    const winnerToken = mockToken.connect(auctionWinner.signer) as MockERC20;
    await (await winnerToken.approve(deployedAddress, extraAllowance)).wait();
    console.log(`${auctionWinner.label}: approved ${ethers.formatEther(extraAllowance)} extra ERC20 for settlement`);

    const ownerErc20Before = await mockToken.balanceOf(deployerAddress);
    console.log(`\nBefore settleAuction():`);
    console.log(`  Owner ERC20:  ${ethers.formatEther(ownerErc20Before)}`);
    console.log(`  NFT owner:    ${await mockNft.ownerOf(TOKEN_ID)} (should be auction contract)`);

    await (await auction.settleAuction()).wait();
    console.log(`\nsettleAuction() executed`);
    console.log(`Auction state: ${(await auction.state()).toString()} (4 = SETTLED)`);

    // Verify winner stored on-chain
    const [settledWinnerAddr, settledWinnerAmt] = await auction.winner();
    if (settledWinnerAddr.toLowerCase() !== auctionWinner.address.toLowerCase()) {
        throw new Error(
            `Expected winner ${auctionWinner.label} (${auctionWinner.address}), got ${settledWinnerAddr}`
        );
    }
    console.log(`Winner: ${auctionWinner.label} — ${ethers.formatEther(settledWinnerAmt)} tokens ✓`);

    // Verify NFT was transferred to the winner
    const nftOwnerAfterSettle = await mockNft.ownerOf(TOKEN_ID);
    if (nftOwnerAfterSettle.toLowerCase() !== auctionWinner.address.toLowerCase()) {
        throw new Error(`Expected NFT owner to be ${auctionWinner.label}, got ${nftOwnerAfterSettle}`);
    }
    console.log(`NFT transferred to ${auctionWinner.label} ✓`);

    // Owner receives:
    //   • MINIMUM_BID penalty from the disqualified rank-0 bidder
    //   • full bid amount (bid.amount) from the winner
    const ownerErc20After = await mockToken.balanceOf(deployerAddress);
    const ownerErc20Gained = ownerErc20After - ownerErc20Before;
    const expectedOwnerGain = MINIMUM_BID + auctionWinner.amount;
    console.log(`Owner ERC20 gained: ${ethers.formatEther(ownerErc20Gained)} (expected ${ethers.formatEther(expectedOwnerGain)})`);
    if (ownerErc20Gained !== expectedOwnerGain) {
        throw new Error(
            `Owner ERC20 gain mismatch: expected ${expectedOwnerGain.toString()}, got ${ownerErc20Gained.toString()}`
        );
    }

    // ══════════════════════════════════════════════════════════════════
    // ── Refund non-winning bidders ───────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    // Still in _bidders: bidders who were neither disqualified (deployer) nor the winner.
    // Bidder A was never in the leaderboard but locked minimumBid.
    // Bidder C was rank 2 but the loop stopped at rank 1, so they were never removed.
    const refundableBidders = bidders.filter(
        (b) =>
            b.address.toLowerCase() !== deployerAddress.toLowerCase() &&
            b.address.toLowerCase() !== auctionWinner.address.toLowerCase()
    );

    console.log(`\n── Refunds (${refundableBidders.length} bidder(s)) ──────────────────────────────────────`);
    for (const bidder of refundableBidders) {
        const erc20Before = await mockToken.balanceOf(bidder.address);
        await (await auction.refundBidder(bidder.address)).wait();
        const erc20After = await mockToken.balanceOf(bidder.address);
        const erc20Gained = erc20After - erc20Before;
        console.log(`  ${bidder.label}: ERC20 refunded ${ethers.formatEther(erc20Gained)}`);
        if (erc20Gained !== MINIMUM_BID) {
            throw new Error(
                `${bidder.label}: expected ERC20 refund of ${ethers.formatEther(MINIMUM_BID)}, got ${ethers.formatEther(erc20Gained)}`
            );
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // ── Owner claims remaining ETH ───────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    // Once _bidders is empty, refundBidder() forwards all remaining contract ETH to the owner.
    const contractEthFinal = await ethers.provider.getBalance(deployedAddress);
    console.log(`\nContract remaining ETH: ${ethers.formatEther(contractEthFinal)}`);

    if (contractEthFinal > 0n) {
        const ownerEthBefore = await ethers.provider.getBalance(deployerAddress);
        await (await auction.refundBidder(deployerAddress)).wait();
        const contractEthAfter = await ethers.provider.getBalance(deployedAddress);
        const ownerEthAfter = await ethers.provider.getBalance(deployerAddress);
        console.log(`Owner ETH reclaimed (net of gas): ${ethers.formatEther(ownerEthAfter - ownerEthBefore)}`);
        console.log(`Contract ETH after owner claim:   ${ethers.formatEther(contractEthAfter)}`);
        if (contractEthAfter !== 0n) {
            throw new Error(
                `Expected contract ETH to be 0 after owner claim, got ${contractEthAfter.toString()}`
            );
        }
    } else {
        console.log(`No remaining ETH — nothing to claim.`);
    }

    console.log("\nAll steps completed successfully.");
};

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
