import { ethers } from "hardhat";
import { biteSetup } from "../../test/fixtures";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

const TOKEN_ID = 1n;
const MINIMUM_BID = ethers.parseEther("100");
const TOP_WINNERS_COUNT = 3n;
const BIDDER_FUND = ethers.parseEther("10000");

const expectedEncryptedBidLength = 323 + 1 + 32;

const encodeBid = (bidder: string, amount: bigint): string =>
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [bidder, amount]);

const deployAuctionFixture = async () => {
    const bite = await biteSetup();
    const [owner, bidderA, bidderB, bidderC, outsider] = await ethers.getSigners();

    const nftFactory = await ethers.getContractFactory("MockERC721");
    const nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    await nft.mint(await owner.getAddress(), TOKEN_ID);

    const currencyFactory = await ethers.getContractFactory("MockERC20");
    const currency = await currencyFactory.deploy();
    await currency.waitForDeployment();

    for (const signer of [owner, bidderA, bidderB, bidderC, outsider]) {
        await currency.mint(await signer.getAddress(), BIDDER_FUND);
    }

    const ownerAddress = await owner.getAddress();
    const deployNonce = await ethers.provider.getTransactionCount(ownerAddress, "pending");
    const predictedAuctionAddress = ethers.getCreateAddress({
        from: ownerAddress,
        nonce: deployNonce + 1,
    });
    await nft.connect(owner).approve(predictedAuctionAddress, TOKEN_ID);

    const auctionFactory = await ethers.getContractFactory("SealedBidAuction");
    const auction = await auctionFactory.connect(owner).deploy(
        await nft.getAddress(),
        TOKEN_ID,
        MINIMUM_BID,
        await currency.getAddress(),
        TOP_WINNERS_COUNT
    );
    await auction.waitForDeployment();

    return {
        bite,
        auction,
        nft,
        currency,
        owner,
        bidderA,
        bidderB,
        bidderC,
        outsider,
    };
};

const startAuction = async (auction: any, owner: any): Promise<bigint> => {
    const gasPrice = await auction.gasPrice();
    const endTime = BigInt((await time.latest()) + 3600);
    await auction.connect(owner).startAuction(endTime, {
        value: 450_000n * gasPrice,
    });
    return endTime;
};

const placeBidAndProcessCallback = async (
    bite: any,
    auction: any,
    bidder: any,
    bidAmount: bigint,
    depositOverride?: bigint,
    bidderOverride?: string
) => {
    const bidderAddress = bidderOverride ?? await bidder.getAddress();
    const encoded = encodeBid(bidderAddress, bidAmount);
    const encrypted = await bite.encryptTE.staticCall(encoded);
    const bidDeposit = depositOverride ?? await auction.minimumDepositPerBid();
    await auction.connect(bidder).sendBid(encrypted, { value: bidDeposit });
    await bite.sendCallback();
    return encrypted;
};

const finalizeAuctionWithBids = async (fixture: Awaited<ReturnType<typeof deployAuctionFixture>>) => {
    const { bite, auction, currency, bidderA, bidderB, bidderC, owner } = fixture;
    await startAuction(auction, owner);
    const auctionAddress = await auction.getAddress();
    for (const bidder of [bidderA, bidderB, bidderC, owner]) {
        await currency.connect(bidder).approve(auctionAddress, MINIMUM_BID);
    }
    await placeBidAndProcessCallback(bite, auction, bidderA, ethers.parseEther("500"));
    await placeBidAndProcessCallback(bite, auction, bidderB, ethers.parseEther("1000"));
    await placeBidAndProcessCallback(bite, auction, bidderC, ethers.parseEther("750"));
    await placeBidAndProcessCallback(bite, auction, owner, ethers.parseEther("1500"));

    await time.increaseTo((await auction.endTime()) + 1n);
    await auction.startProcessingBids();
    await bite.sendCallback();
    expect(await auction.state()).to.equal(3n);
};

describe("SealedBidAuction", () => {
    describe("constructor", () => {
        it("should deploy and transfer NFT custody to the auction", async () => {
            const { auction, nft } = await loadFixture(deployAuctionFixture);
            expect(await auction.topWinnersCount()).to.equal(TOP_WINNERS_COUNT);
            expect(await auction.minimumBid()).to.equal(MINIMUM_BID);
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(await auction.getAddress());
        });

        it("should revert for invalid constructor parameters", async () => {
            const { owner, nft, currency } = await loadFixture(deployAuctionFixture);
            const auctionFactory = await ethers.getContractFactory("SealedBidAuction");

            await expect(
                auctionFactory.connect(owner).deploy(
                    ethers.ZeroAddress,
                    TOKEN_ID,
                    MINIMUM_BID,
                    await currency.getAddress(),
                    TOP_WINNERS_COUNT
                )
            ).to.be.revertedWithCustomError(auctionFactory, "ZeroAddress");

            await expect(
                auctionFactory.connect(owner).deploy(
                    await nft.getAddress(),
                    TOKEN_ID,
                    0n,
                    await currency.getAddress(),
                    TOP_WINNERS_COUNT
                )
            ).to.be.revertedWithCustomError(auctionFactory, "InvalidMinimumBid");

            await expect(
                auctionFactory.connect(owner).deploy(
                    await nft.getAddress(),
                    TOKEN_ID,
                    MINIMUM_BID,
                    ethers.ZeroAddress,
                    TOP_WINNERS_COUNT
                )
            ).to.be.revertedWithCustomError(auctionFactory, "ZeroAddress");

            await expect(
                auctionFactory.connect(owner).deploy(
                    await nft.getAddress(),
                    TOKEN_ID,
                    MINIMUM_BID,
                    await currency.getAddress(),
                    0n
                )
            ).to.be.revertedWithCustomError(auctionFactory, "InvalidTopWinnersCount");
        });

        it("should revert deployment when NFT transfer is not approved", async () => {
            const [owner] = await ethers.getSigners();
            const nftFactory = await ethers.getContractFactory("MockERC721");
            const nft = await nftFactory.deploy();
            await nft.waitForDeployment();
            await nft.mint(await owner.getAddress(), TOKEN_ID);

            const currencyFactory = await ethers.getContractFactory("MockERC20");
            const currency = await currencyFactory.deploy();
            await currency.waitForDeployment();

            const auctionFactory = await ethers.getContractFactory("SealedBidAuction");
            await expect(
                auctionFactory.connect(owner).deploy(
                    await nft.getAddress(),
                    TOKEN_ID,
                    MINIMUM_BID,
                    await currency.getAddress(),
                    TOP_WINNERS_COUNT
                )
            ).to.be.reverted;
        });
    });

    describe("owner controls and lifecycle", () => {
        it("should allow only owner for admin functions", async () => {
            const { auction, outsider } = await loadFixture(deployAuctionFixture);
            const endTime = BigInt((await time.latest()) + 4000);

            await expect(
                auction.connect(outsider).startAuction(endTime, { value: 1n })
            ).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount");

            await expect(
                auction.connect(outsider).cancelAuction()
            ).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount");

            await expect(
                auction.connect(outsider).changeGasPrice((await auction.gasPrice()) + 1n)
            ).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount");

            await expect(
                auction.connect(outsider).unblockNft()
            ).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount");
        });

        it("should start auction with valid preconditions and reject invalid ones", async () => {
            const { auction, owner } = await loadFixture(deployAuctionFixture);
            const gasPrice = await auction.gasPrice();
            const validEndTime = BigInt((await time.latest()) + 7200);

            await expect(
                auction.connect(owner).startAuction(BigInt((await time.latest()) + 30), { value: 450_000n * gasPrice })
            ).to.be.revertedWithCustomError(auction, "InvalidEndTime");

            await expect(
                auction.connect(owner).startAuction(validEndTime, { value: 450_000n * gasPrice - 1n })
            ).to.be.revertedWithCustomError(auction, "NotEnoughDeposit");

            await expect(
                auction.connect(owner).startAuction(validEndTime, { value: 450_000n * gasPrice })
            ).to.emit(auction, "AuctionStarted");

            expect(await auction.state()).to.equal(1n);
            expect(await auction.endTime()).to.equal(validEndTime);

            await expect(
                auction.connect(owner).startAuction(validEndTime + 1n, { value: 450_000n * gasPrice })
            ).to.be.revertedWithCustomError(auction, "InvalidState");
        });

        it("should cancel auction in NOT_STARTED and OPEN states only", async () => {
            const { auction, nft, owner } = await loadFixture(deployAuctionFixture);

            await expect(auction.connect(owner).cancelAuction())
                .to.emit(auction, "AuctionCancelled")
                .withArgs(TOKEN_ID);
            expect(await auction.state()).to.equal(5n);
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(await owner.getAddress());

            const fx = await loadFixture(deployAuctionFixture);
            await startAuction(fx.auction, fx.owner);
            await expect(fx.auction.connect(fx.owner).cancelAuction()).to.emit(fx.auction, "AuctionCancelled");
            expect(await fx.auction.state()).to.equal(5n);
            expect(await fx.nft.ownerOf(TOKEN_ID)).to.equal(await fx.owner.getAddress());

            const fx2 = await loadFixture(deployAuctionFixture);
            await startAuction(fx2.auction, fx2.owner);
            await fx2.currency.connect(fx2.bidderA).approve(await fx2.auction.getAddress(), MINIMUM_BID);
            await placeBidAndProcessCallback(fx2.bite, fx2.auction, fx2.bidderA, ethers.parseEther("500"));
            await time.increaseTo((await fx2.auction.endTime()) + 1n);
            await fx2.auction.startProcessingBids();
            await expect(
                fx2.auction.connect(fx2.owner).cancelAuction()
            ).to.be.revertedWithCustomError(fx2.auction, "InvalidState");
        });

        it("should enforce strictly increasing gas price updates", async () => {
            const { auction, owner } = await loadFixture(deployAuctionFixture);
            const oldGasPrice = await auction.gasPrice();
            const newGasPrice = oldGasPrice + 1n;

            await expect(auction.connect(owner).changeGasPrice(newGasPrice))
                .to.emit(auction, "GasPriceUpdated")
                .withArgs(oldGasPrice, newGasPrice);

            expect(await auction.gasPrice()).to.equal(newGasPrice);

            await expect(
                auction.connect(owner).changeGasPrice(newGasPrice)
            ).to.be.revertedWithCustomError(auction, "GasPriceMustIncrease");
        });
    });

    describe("bid submission and callback validation", () => {
        it("should reject bids outside OPEN state, after end time, with low deposit, wrong length", async () => {
            const { bite, auction, owner, bidderA } = await loadFixture(deployAuctionFixture);
            const minDeposit = await auction.minimumDepositPerBid();
            const validEncrypted = await bite.encryptTE.staticCall(
                encodeBid(await bidderA.getAddress(), ethers.parseEther("500"))
            );

            await expect(
                auction.connect(bidderA).sendBid(validEncrypted, { value: minDeposit })
            ).to.be.revertedWithCustomError(auction, "InvalidState");

            await startAuction(auction, owner);

            await expect(
                auction.connect(bidderA).sendBid("0x1234", { value: minDeposit })
            ).to.be.revertedWithCustomError(auction, "InvalidEncryptedBid");

            await expect(
                auction.connect(bidderA).sendBid(validEncrypted, { value: minDeposit - 1n })
            ).to.be.revertedWithCustomError(auction, "NotEnoughDeposit");

            await time.increaseTo((await auction.endTime()) + 1n);
            await expect(
                auction.connect(bidderA).sendBid(validEncrypted, { value: minDeposit })
            ).to.be.revertedWithCustomError(auction, "AuctionEnded");
        });

        it("should register valid callbacks, lock minimum bid once per bidder, and enforce max bids", async () => {
            const { bite, auction, owner, bidderA, currency } = await loadFixture(deployAuctionFixture);
            const auctionAddress = await auction.getAddress();
            await currency.connect(bidderA).approve(auctionAddress, MINIMUM_BID);
            await startAuction(auction, owner);

            await placeBidAndProcessCallback(bite, auction, bidderA, ethers.parseEther("500"));
            await placeBidAndProcessCallback(bite, auction, bidderA, ethers.parseEther("600"));

            expect(await auction.numBids(await bidderA.getAddress())).to.equal(2n);
            expect(await currency.balanceOf(auctionAddress)).to.equal(MINIMUM_BID);

            for (let i = 0; i < 3; i++) {
                await placeBidAndProcessCallback(
                    bite,
                    auction,
                    bidderA,
                    ethers.parseEther((700 + i).toString())
                );
            }

            expect(await auction.numBids(await bidderA.getAddress())).to.equal(5n);
            const encrypted = await bite.encryptTE.staticCall(
                encodeBid(await bidderA.getAddress(), ethers.parseEther("999"))
            );
            await expect(
                auction.connect(bidderA).sendBid(encrypted, { value: await auction.minimumDepositPerBid() })
            ).to.be.revertedWithCustomError(auction, "MaxBidsPerBidderReached");
        });

        it("should reject unauthorized or malformed callbacks", async () => {
            const { auction, outsider } = await loadFixture(deployAuctionFixture);
            await expect(
                auction.connect(outsider).onDecrypt([], [])
            ).to.be.revertedWithCustomError(auction, "UnauthorizedCTXSender");
        });

        it("should reject bid callbacks with bidder mismatch, low amount, callback-time cap and wrong state", async () => {
            const { bite, auction, owner, bidderA, bidderB, currency } = await loadFixture(deployAuctionFixture);
            const auctionAddress = await auction.getAddress();
            await currency.connect(bidderA).approve(auctionAddress, MINIMUM_BID);
            await currency.connect(bidderB).approve(auctionAddress, MINIMUM_BID);
            await startAuction(auction, owner);

            const mismatched = await bite.encryptTE.staticCall(
                encodeBid(await bidderB.getAddress(), ethers.parseEther("500"))
            );
            await auction.connect(bidderA).sendBid(mismatched, { value: await auction.minimumDepositPerBid() });
            await expect(bite.sendCallback()).to.be.revertedWithCustomError(auction, "BidderAddressMismatch");

            await expect(bite.removeNextCTXIfItReverts()).to.not.be.reverted;

            const lowBid = await bite.encryptTE.staticCall(
                encodeBid(await bidderA.getAddress(), MINIMUM_BID - 1n)
            );
            await auction.connect(bidderA).sendBid(lowBid, { value: await auction.minimumDepositPerBid() });
            await expect(bite.sendCallback()).to.be.revertedWithCustomError(auction, "InsufficientBid");
            await expect(bite.removeNextCTXIfItReverts()).to.not.be.reverted;

            // Queue 6 bids before callbacks: pre-check passes, callback path should fail at 6th.
            for (let i = 0; i < 6; i++) {
                const encrypted = await bite.encryptTE.staticCall(
                    encodeBid(await bidderA.getAddress(), ethers.parseEther((1000 + i).toString()))
                );
                await auction.connect(bidderA).sendBid(encrypted, { value: await auction.minimumDepositPerBid() });
            }
            for (let i = 0; i < 5; i++) {
                await bite.sendCallback();
            }
            await expect(bite.sendCallback()).to.be.revertedWithCustomError(auction, "MaxBidsPerBidderReached");
            await expect(bite.removeNextCTXIfItReverts()).to.not.be.reverted;

            // Valid callback arriving after auction leaves OPEN should revert InvalidState.
            const fresh = await loadFixture(deployAuctionFixture);
            await fresh.currency.connect(fresh.bidderA).approve(await fresh.auction.getAddress(), MINIMUM_BID);
            await startAuction(fresh.auction, fresh.owner);
            const validEncrypted = await fresh.bite.encryptTE.staticCall(
                encodeBid(await fresh.bidderA.getAddress(), ethers.parseEther("500"))
            );
            await fresh.auction.connect(fresh.bidderA).sendBid(validEncrypted, {
                value: await fresh.auction.minimumDepositPerBid(),
            });
            await time.increaseTo((await fresh.auction.endTime()) + 1n);
            await fresh.auction.startProcessingBids();
            expect(await fresh.auction.state()).to.equal(3n);
            await expect(fresh.bite.sendCallback()).to.be.revertedWithCustomError(fresh.auction, "InvalidState");
        });
    });

    describe("processing and leaderboard", () => {
        it("should enforce processing start guards and finalize processed bids", async () => {
            const { bite, auction, owner, bidderA, bidderB, bidderC, currency } = await loadFixture(deployAuctionFixture);
            const auctionAddress = await auction.getAddress();
            for (const bidder of [bidderA, bidderB, bidderC]) {
                await currency.connect(bidder).approve(auctionAddress, MINIMUM_BID);
            }

            await startAuction(auction, owner);
            await expect(auction.startProcessingBids()).to.be.revertedWithCustomError(auction, "AuctionNotEnded");

            await placeBidAndProcessCallback(bite, auction, bidderA, ethers.parseEther("500"));
            await placeBidAndProcessCallback(bite, auction, bidderB, ethers.parseEther("1000"));
            await placeBidAndProcessCallback(bite, auction, bidderC, ethers.parseEther("750"));

            await time.increaseTo((await auction.endTime()) + 1n);
            await auction.startProcessingBids();

            await expect(
                auction.startProcessingBids()
            ).to.be.revertedWithCustomError(auction, "InvalidState");

            await bite.sendCallback();
            expect(await auction.state()).to.equal(3n);
        });

        it("should maintain sorted top leaderboard and expose rankings", async () => {
            const fixture = await loadFixture(deployAuctionFixture);
            await finalizeAuctionWithBids(fixture);
            const { auction, owner, bidderA, bidderB, bidderC } = fixture;

            expect(await auction.rankedTopBidderCount()).to.equal(TOP_WINNERS_COUNT);

            const top0 = await auction.getTopBid(0n);
            const top1 = await auction.getTopBid(1n);
            const top2 = await auction.getTopBid(2n);

            expect(top0[0]).to.equal(await owner.getAddress());
            expect(top0[1]).to.equal(ethers.parseEther("1500"));
            expect(top1[0]).to.equal(await bidderB.getAddress());
            expect(top1[1]).to.equal(ethers.parseEther("1000"));
            expect(top2[0]).to.equal(await bidderC.getAddress());
            expect(top2[1]).to.equal(ethers.parseEther("750"));

            expect(await auction.isRankedTopWinner(await bidderA.getAddress())).to.equal(false);
            expect(await auction.isRankedTopWinner(await bidderB.getAddress())).to.equal(true);

            await expect(
                auction.getTopBid(3n)
            ).to.be.revertedWithCustomError(auction, "IndexOutOfBounds");
        });
    });

    describe("settlement", () => {
        it("should require FINALIZED state before settlement", async () => {
            const { auction } = await loadFixture(deployAuctionFixture);
            await expect(
                auction.settleAuction()
            ).to.be.revertedWithCustomError(auction, "InvalidState");
        });

        it("should disqualify non-paying top bidder and settle with next valid bidder", async () => {
            const fixture = await loadFixture(deployAuctionFixture);
            await finalizeAuctionWithBids(fixture);
            const { auction, nft, currency, owner, bidderB } = fixture;

            const ownerAddress = await owner.getAddress();
            const bidderBAddress = await bidderB.getAddress();
            const auctionAddress = await auction.getAddress();
            const winnerBidAmount = ethers.parseEther("1000");

            await currency.connect(bidderB).approve(auctionAddress, winnerBidAmount - MINIMUM_BID);

            const ownerBalanceBefore = await currency.balanceOf(ownerAddress);
            await expect(auction.settleAuction()).to.emit(auction, "AuctionSettled");

            expect(await auction.state()).to.equal(4n);
            const winner = await auction.winner();
            expect(winner[0]).to.equal(bidderBAddress);
            expect(winner[1]).to.equal(winnerBidAmount);
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(bidderBAddress);

            const ownerBalanceAfter = await currency.balanceOf(ownerAddress);
            const expectedOwnerGain = MINIMUM_BID + winnerBidAmount;
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(expectedOwnerGain);
        });

        it("should return NFT to owner when no ranked bidder can settle", async () => {
            const fixture = await loadFixture(deployAuctionFixture);
            await finalizeAuctionWithBids(fixture);
            const { auction, nft, owner } = fixture;

            await expect(auction.settleAuction())
                .to.emit(auction, "AuctionSettledWithNoWinner");

            expect(await auction.state()).to.equal(4n);
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(await owner.getAddress());
            const winner = await auction.winner();
            expect(winner[0]).to.equal(ethers.ZeroAddress);
            expect(winner[1]).to.equal(0n);
        });
    });

    describe("refunds", () => {
        it("should enforce refund eligibility states and bidder membership", async () => {
            const { auction, bidderA } = await loadFixture(deployAuctionFixture);
            await expect(
                auction.refundBidder(await bidderA.getAddress())
            ).to.be.revertedWithCustomError(auction, "InvalidState");
        });

        it("should refund bidders after settlement and reject duplicate/non-member refunds", async () => {
            const fixture = await loadFixture(deployAuctionFixture);
            await finalizeAuctionWithBids(fixture);
            const { auction, currency, bidderA, bidderB, bidderC, owner } = fixture;
            const auctionAddress = await auction.getAddress();

            // Force bidderB as winner; owner (top rank) stays disqualified due to no extra allowance.
            await currency.connect(bidderB).approve(auctionAddress, ethers.parseEther("1000") - MINIMUM_BID);
            await auction.settleAuction();

            const bidderABefore = await currency.balanceOf(await bidderA.getAddress());
            const bidderCBefore = await currency.balanceOf(await bidderC.getAddress());

            await expect(
                auction.refundBidder(await bidderA.getAddress())
            ).to.emit(auction, "BidderRefunded");
            await expect(
                auction.refundBidder(await bidderC.getAddress())
            ).to.emit(auction, "BidderRefunded");

            expect(await currency.balanceOf(await bidderA.getAddress()) - bidderABefore).to.equal(MINIMUM_BID);
            expect(await currency.balanceOf(await bidderC.getAddress()) - bidderCBefore).to.equal(MINIMUM_BID);

            await expect(
                auction.refundBidder(await bidderA.getAddress())
            ).to.be.revertedWithCustomError(auction, "InvalidBidder");

            // Remaining bidder set should be empty now, so this call sends leftover ETH to owner if any.
            await owner.sendTransaction({ to: await auction.getAddress(), value: ethers.parseEther("0.01") });
            const tx = await auction.refundBidder(await owner.getAddress());
            const receipt = await tx.wait();
            expect(receipt).to.not.equal(null);
            expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0n);
        });

        it("should allow emergency refunds 7 days after end time", async () => {
            const { bite, auction, currency, owner, bidderA } = await loadFixture(deployAuctionFixture);
            await currency.connect(bidderA).approve(await auction.getAddress(), MINIMUM_BID);
            await startAuction(auction, owner);
            await placeBidAndProcessCallback(bite, auction, bidderA, ethers.parseEther("500"));

            await time.increaseTo((await auction.endTime()) + 7n * 24n * 60n * 60n + 1n);

            const before = await currency.balanceOf(await bidderA.getAddress());
            await auction.refundBidder(await bidderA.getAddress());
            const after = await currency.balanceOf(await bidderA.getAddress());
            expect(after - before).to.equal(MINIMUM_BID);
        });
    });

    describe("emergency NFT recovery", () => {
        it("should gate unblockNft by recovery period and NFT custody", async () => {
            const { auction, owner, nft } = await loadFixture(deployAuctionFixture);
            await startAuction(auction, owner);

            await expect(
                auction.unblockNft()
            ).to.be.revertedWithCustomError(auction, "RecoveryPeriodNotElapsed");

            await time.increaseTo((await auction.endTime()) + 7n * 24n * 60n * 60n + 1n);
            await expect(auction.unblockNft())
                .to.emit(auction, "NftReclaimed")
                .withArgs(await owner.getAddress());
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(await owner.getAddress());
        });

        it("should revert unblockNft when NFT is not held by contract", async () => {
            const { auction, owner, nft } = await loadFixture(deployAuctionFixture);
            await startAuction(auction, owner);
            await auction.cancelAuction();

            await time.increaseTo((await auction.endTime()) + 7n * 24n * 60n * 60n + 1n);
            await expect(
                auction.unblockNft()
            ).to.be.revertedWithCustomError(auction, "NftNotHeldByContract");
            expect(await nft.ownerOf(TOKEN_ID)).to.equal(await owner.getAddress());
        });
    });
});
