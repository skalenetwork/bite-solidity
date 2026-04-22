<!-- cspell:words ciphertext ciphertexts ECIES leaderboard -->

# Sealed-Bid Auction

> **Disclaimer:** This example is **not** production-ready. It is provided for educational and demonstration purposes only.

## Overview

This example demonstrates a fully on-chain sealed-bid auction for an ERC-721 token. Bidders submit encrypted bids so that no one — including the contract — can see the bid amounts until after the auction closes. When the auction ends, the contract decrypts all bids through a **recursive CTX chain**, ranks them in a leaderboard, and settles with the highest bidder who can cover their bid.

It exercises three core BITE features together:

- **Threshold Encryption (TE):** Each bid is encrypted client-side with the network's threshold key before being sent on-chain. The plaintext amount is never visible in transaction data or contract storage.
- **Conditional Transaction (CTX):** Two distinct CTX flows are used. The first decrypts and validates each individual bid at submission time. The second decrypts the full batch of stored bids during the processing phase.
- **Self-referential CTX chains:** When processing bids, `onDecrypt` can re-invoke `_processBids`, which submits a new CTX from within the callback itself. This allows the contract to process arbitrarily large bid sets across multiple rounds without requiring a single transaction to have enough gas for the entire set.

## How it works

### 1. Deployment

The deployer calls the constructor with the NFT contract, token ID, minimum bid amount, ERC-20 payment currency, and the maximum number of top winners to track. The constructor immediately calls `nft.transferFrom` to take custody of the token, so the NFT must be approved before deployment.

The predicted deployment address can be computed via `getCreateAddress` from the deployer nonce, allowing a single approve→deploy flow.

### 2. Starting the auction

The owner calls `startAuction(endTime)` and sends enough gas Tokens to cover the gas cost of at least one batch-processing callback. The auction transitions to `OPEN` state and the bidding window is set.

### 3. Placing a sealed bid

A bidder calls `sendBid(encryptedBid)` with:

- `encryptedBid` — their bid ABI-encoded as `(address bidder, uint256 amount)` and TE-encrypted off-chain. The expected size is enforced on-chain.
- `msg.value` — gas Tokens deposit covering the gas cost of both the per-bid CTX callback and a share of the batch-processing phase.

Internally:

1. The contract submits a CTX carrying `encryptedBid` as the encrypted argument and `(msg.sender, encryptedBid)` as plaintext arguments, so the callback can verify the bidder's identity without storing plaintext.
2. The returned `ctxSender` address is whitelisted and funded for the callback.

### 4. Bid registration callback (`onDecrypt` — bid path)

When BITE decrypts the per-bid CTX, it calls `onDecrypt`. The contract recognizes the bid path by `decryptedArgs.length == 1 && plaintextArgs.length == 2` and:

1. Decodes the bidder address from `plaintextArgs[0]` and the decrypted `Bid` struct from `decryptedArgs[0]`.
2. Asserts `bid.bidder == bidder` — the encrypted bid must claim the same sender as the original transaction (prevents spoofing another account's identity).
3. Checks `bid.amount >= minimumBid` and the per-bidder cap.
4. Pushes the raw ciphertext into `encryptedBids[]` for the processing phase.
5. On the first valid bid from a given address, locks `minimumBid` ERC-20 tokens via `transferFrom` as a commitment deposit.
6. Emits `BidPlaced`.

### 5. Processing bids — recursive CTX chain

After the auction closes, anyone can call `startProcessingBids()`. This marks the state as `PROCESSING`, emits `BidProcessingStarted`, and calls the internal `_processBids`.

`_processBids` submits a CTX for the next batch (up to 5 bids at a time), passing the raw ciphertexts as encrypted arguments with no plaintext arguments. When the callback fires, the contract decodes each `Bid` struct and updates the `TopUniqueBids` leaderboard, then calls `_processBids` again to schedule the next batch.

This creates a **self-referential CTX chain**: `_processBids → CTX → onDecrypt → _processBids → …` The chain terminates naturally when all bids have been processed and the state advances to `FINALIZED`.

If a callback runs low on gas before it can issue the next CTX, `_allowResume` is set to `true`. A keeper can then call `startProcessingBids()` again to resume from where the chain left off, emitting `BidProcessingResumed`.

### 6. Settling the auction

Once `FINALIZED`, anyone can call `settleAuction()`. The contract iterates the leaderboard from highest to lowest and:

- **Disqualifies** a bidder if their ERC-20 balance plus locked deposit is insufficient or their allowance for the remaining amount is too low. Their locked `minimumBid` is forfeited to the owner as a penalty for not having the funds available.
- **Accepts** the first bidder who can pay in full: pulls `bid.amount - minimumBid` additional ERC-20 from them, forwards the full `bid.amount` to the owner, and transfers the NFT to the winner.
- If no bidder qualifies, the NFT is returned to the owner.

After settlement, any remaining gas Tokens are divided equally among the remaining bidders as their gas refund share (`_refundGas`). Usually this amount will be zero or very close to zero.

### 7. Refunds

Once the state is `SETTLED` or `CANCELLED`, each non-winning bidder calls `refundBidder(address)` to recover their locked `minimumBid` ERC-20 and their remaining gas share.

When all bidders have been refunded (`_bidders` is empty), the next call to `refundBidder` forwards any remaining contract gas Tokens to the owner.

In case the auction gets permanently stuck, an emergency path allows refunds 7 days after `endTime` regardless of state. Additionally, the owner can reclaim the NFT via `unblockNft()` after the same 7-day window if it is still held by the contract.

## Contract interface

| Function | Visibility | Description |
|---|---|---|
| `constructor(nft, tokenId, minimumBid, currency, topWinnersCount)` | — | Takes custody of the NFT and initializes auction parameters |
| `startAuction(endTime)` | `external payable onlyOwner` | Opens the auction; requires gas Tokens for initial processing gas |
| `cancelAuction()` | `external onlyOwner` | Cancels from `NOT_STARTED` or `OPEN`; returns NFT to owner |
| `sendBid(encryptedBid)` | `external payable` | Submits an encrypted bid and funds the per-bid CTX callback |
| `startProcessingBids()` | `external` | Starts or resumes the recursive batch-decryption CTX chain |
| `settleAuction()` | `external` | Iterates the leaderboard and transfers the NFT to the first qualified winner |
| `refundBidder(bidder)` | `external` | Returns a bidder's locked ERC-20 and gas Tokens share; drains leftover gas Tokens to the owner when the set is empty |
| `changeGasPrice(gasPrice)` | `external onlyOwner` | Raises the tracked gas price for CTX funding (safety measure for network-wide increases) |
| `unblockNft()` | `external onlyOwner` | Emergency NFT recovery after 7 days past `endTime` |
| `getTopBid(index)` | `external view` | Returns the bid at leaderboard rank `index` (0 = highest) |
| `rankedTopBidderCount()` | `external view` | Number of entries currently in the leaderboard |
| `isRankedTopWinner(bidder)` | `external view` | Whether an address is currently in the top-N leaderboard |
| `onDecrypt(decryptedArgs, plaintextArgs)` | `external` | BITE callback — handles both the per-bid path and the batch-processing path |

## `TopUniqueBids` library

The `TopUniqueBids` library (`contracts/libraries/TopUniqueBids.sol`) maintains a descending-sorted leaderboard of at most `cap` bids with **unique bidders**. If the same bidder submits a higher bid, the old entry is replaced in-place. Bids at or below the current last place are dropped when the leaderboard is full - first bids have priority on ties.

It is a pure in-storage sorted insert — no off-chain sort is needed. It is recommended to store a low amount of top bidders, for gas costs.Gas configs were not tested for numbers higher than 3.

## Script

The script in [scripts/deployAndTest.ts](scripts/deployAndTest.ts) performs a full end-to-end flow against a live BITE chain:

1. Deploys `MockERC721` and `MockERC20`, mints tokens, and funds four bidder wallets (Deployer, A, B, C).
2. Predicts the auction address via deployer nonce, approves the NFT, and deploys `SealedBidAuction`.
3. Each bidder approves `minimumBid` ERC-20 to the auction contract, then calls `startAuction`.
4. Each bidder TE-encrypts their bid off-chain with `bite.encryptMessageForCTX` and calls `sendBid`.
5. Polls until all bid callbacks have landed (`numBids >= 1` for each bidder).
6. Waits for the auction `endTime`, then calls `startProcessingBids`.
7. Polls until the contract reaches `FINALIZED` state.
8. Verifies the leaderboard order and boundary conditions (`getTopBid`, `isRankedTopWinner`, out-of-range revert).
9. **Settlement:** The rank-0 bidder (Deployer, 1500 tokens) has no extra ERC-20 allowance and is disqualified. The rank-1 bidder (Bidder B, 1000 tokens) approves the remaining `bid.amount - minimumBid` and wins the NFT. The owner receives both the forfeited `minimumBid` from the disqualified bidder and the full winning bid.
10. **Refunds:** All non-winning, non-disqualified bidders (A and C) reclaim their locked `minimumBid` ERC-20.
11. **Owner Gas claim:** Once the bidder set is empty, the owner reclaims any remaining contract gas Tokens via `refundBidder`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | yes | Deployer private key |
| `ENDPOINT` | yes | RPC endpoint used for both chain access and BITE off-chain encryption |

### Run

```bash
PRIVATE_KEY=0x... ENDPOINT=https://... yarn hardhat run scripts/deployAndTest.ts --network custom
```
