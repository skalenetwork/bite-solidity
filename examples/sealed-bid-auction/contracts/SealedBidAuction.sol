// SPDX-License-Identifier: AGPL-3.0-only

/*
    SealedBidAuction.sol - bite-solidity
    Copyright (C) 2026-Present SKALE Labs
    @author Eduardo Vasques

    bite-solidity is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    bite-solidity is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with bite-solidity.  If not, see <https://www.gnu.org/licenses/>.
*/

// cspell:words ECIES

pragma solidity ^0.8.27;

import { BITE, PublicKey } from "@skalenetwork/bite-solidity/contracts/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/contracts/interfaces/IBiteSupplicant.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { TopUniqueBids } from "./libraries/TopUniqueBids.sol";
import { Bid } from "./types.sol";

contract SealedBidAuction is IBiteSupplicant, Ownable2Step {
    using Address for address payable;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.AddressSet;
    using TopUniqueBids for TopUniqueBids.Leaderboard;

    enum AuctionState {
        NOT_STARTED,
        OPEN,
        PROCESSING,
        FINALIZED,
        SETTLED,
        CANCELLED
    }

    uint256 public immutable topWinnersCount;
    Bid public winner;

    // Stuff we will bid
    IERC721 public immutable nft;
    uint256 public immutable tokenId;
    uint256 public immutable minimumBid;
    IERC20 public immutable currency;

    // Auction state
    uint256 public endTime;
    AuctionState public state = AuctionState.NOT_STARTED;

    // Bids
    bytes[] public encryptedBids;
    Bid [] public bids;
    mapping(address bidder => uint256 numBids) public numBids; // Stage OPEN
    uint256 public immutable maxBidsPerBidder = 5;

    // Payment of decryption
    uint256 public gasPrice = tx.gasprice;
    uint256 public immutable gasForBid = 500_000;            // This usually cost around 390-450k gas
    uint256 public immutable gasForProcessingBids = 300_000; // This is usually enough
    // Adding 300_00 buffer to avoid gas limit errors
    uint256 public immutable minimumDepositPerBid = (gasForBid + gasForProcessingBids) * gasPrice;


    // Private state
    EnumerableSet.AddressSet private _bidders;
    mapping(address ctxSender => bool authorized) private _authorizedCtxSenders;
    TopUniqueBids.Leaderboard private _topWinners;
    uint256 private _refundGas;
    bool private _allowResume = false;

    event AuctionStarted(uint256 indexed tokenId);
    event AuctionCancelled(uint256 indexed tokenId);
    event AuctionFinalized(uint256 totalBids);
    event AuctionSettled(address indexed winner, uint256 amount);
    event AuctionSettledWithNoWinner();
    event BidPlaced(address indexed bidder, uint256 numBids);
    event BidProcessingStarted(uint256 totalBids);
    event BidProcessingResumed(uint256 processedSoFar, uint256 totalBids);
    event BidderRefunded(address indexed bidder, uint256 currencyAmount, uint256 ethAmount);
    event BidderDisqualified(address indexed bidder);
    event GasPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event NftReclaimed(address indexed recipient);

    error ZeroAddress();
    error InvalidEndTime();
    error InvalidMinimumBid();
    error NotOwnerOfToken();
    error InvalidState(AuctionState current);
    error InvalidEncryptedBid(uint256 length, uint256 expected);
    error MaxBidsPerBidderReached();
    error NotEnoughDeposit();
    error AuctionEnded();
    error UnauthorizedCTXSender();
    error DuplicateCTXSender();
    error CallbackNotRecognized();
    error InvalidBidder();
    error BidderAddressMismatch(address sender, address inBid);
    error InsufficientBid(uint256 amount, uint256 minimum);
    error AuctionNotEnded();
    error GasPriceMustIncrease(uint256 current, uint256 provided);
    error InvalidTopWinnersCount();
    error IndexOutOfBounds();
    error RecoveryPeriodNotElapsed();
    error NftNotHeldByContract();

    // Allow receiving ETH for emergency callBack gas requirements
    receive() external payable {}

    constructor(
        IERC721 nft_,
        uint256 tokenId_,
        uint256 minimumBid_,
        IERC20 currency_,
        uint256 topWinnersCount_
    ) Ownable(msg.sender) {
        require(address(nft_) != address(0), ZeroAddress());
        require(minimumBid_ > 0, InvalidMinimumBid());
        require(address(currency_) != address(0), ZeroAddress());
        require(topWinnersCount_ > 0, InvalidTopWinnersCount());
        nft = nft_;
        tokenId = tokenId_;
        minimumBid = minimumBid_;
        currency = currency_;
        topWinnersCount = topWinnersCount_;
        nft.transferFrom(msg.sender, address(this), tokenId_);
    }

    /// @notice Change the gas price for the CTXs
    /// @dev This will cause the gas in the contract to not be enough, so it requires to deposit more gas tokens by the owner
    /// @dev This is only a safety measure in case of a network-wide gas price increase (rare on SKALE)
    function changeGasPrice(uint256 gasPrice_) external onlyOwner {
        require(gasPrice_ > gasPrice, GasPriceMustIncrease(gasPrice, gasPrice_));
        emit GasPriceUpdated(gasPrice, gasPrice_);
        gasPrice = gasPrice_;
    }

    function unblockNft() external onlyOwner {
        require(block.timestamp > endTime + 7 days, RecoveryPeriodNotElapsed());
        require(nft.ownerOf(tokenId) == address(this), NftNotHeldByContract());
        address recipient = owner();
        nft.transferFrom(address(this), recipient, tokenId);
        emit NftReclaimed(recipient);
    }

    function refundBidder(address bidder) external {
        require(
            state == AuctionState.SETTLED ||
            state == AuctionState.CANCELLED ||
            block.timestamp > endTime + 7 days, // Allow to refund 7 days after the auction end date - in case of stuck bids
            InvalidState(state)
        );
        if(_bidders.length() == 0 && address(this).balance > 0) {
            // Send gas left in the contract to the owner
            payable(owner()).sendValue(address(this).balance);
            return;
        }
        require(_bidders.remove(bidder), InvalidBidder());
        currency.transfer(bidder, minimumBid);
        payable(bidder).sendValue(_refundGas);
        emit BidderRefunded(bidder, minimumBid, _refundGas);
    }

    function settleAuction() external {
        require(state == AuctionState.FINALIZED, InvalidState(state));
        state = AuctionState.SETTLED;
        for(uint256 i = 0; i < _topWinners.length(); i++){
            Bid storage bid = _topWinners.at(i);
            if(
                currency.balanceOf(bid.bidder) + minimumBid < bid.amount ||
                currency.allowance(bid.bidder, address(this)) < bid.amount - minimumBid
            ) {
                _bidders.remove(bid.bidder); // Becomes unable to claim refunds
                currency.transfer(owner(), minimumBid); // Owner automatically gets the minimumBid value
                emit BidderDisqualified(bid.bidder);
                continue;
            }
            _bidders.remove(bid.bidder);
            currency.transferFrom(bid.bidder, address(this), bid.amount - minimumBid);
            currency.transfer(owner(), bid.amount);
            nft.transferFrom(address(this), bid.bidder, tokenId);
            winner = bid;
            if(_bidders.length() > 0){
                _refundGas = address(this).balance / _bidders.length();
            }
            emit AuctionSettled(bid.bidder, bid.amount);
            return;
        }
        // No winner available, return the NFT to the owner
        nft.transferFrom(address(this), owner(), tokenId);
        if(_bidders.length() > 0){
            _refundGas = address(this).balance / _bidders.length();
        }
        emit AuctionSettledWithNoWinner();
    }

    function onDecrypt(bytes[] calldata decryptedArgs, bytes[] calldata plaintextArgs) external override {
        require(_authorizedCtxSenders[msg.sender], UnauthorizedCTXSender());
        _authorizedCtxSenders[msg.sender] = false;
        if(decryptedArgs.length == 1 && plaintextArgs.length == 2) {
            _handleBidCallback(decryptedArgs, plaintextArgs);
            return;
        }
        require(plaintextArgs.length == 0, CallbackNotRecognized());
        require(state == AuctionState.PROCESSING, InvalidState(state));

        for(uint256 i = 0; i < decryptedArgs.length; i++){
            Bid memory bid = abi.decode(decryptedArgs[i], (Bid));
            bids.push(bid);
            _updateWinner(bid);
        }
        if(gasleft() < 250_000) {
            _allowResume = true;
            return;
        }
        _processBids();
    }

    function startProcessingBids() external {
        require(block.timestamp >= endTime, AuctionNotEnded());
        require(state == AuctionState.OPEN || (state == AuctionState.PROCESSING && _allowResume), InvalidState(state));
        bool isResume = _allowResume;
        _allowResume = false;
        state = AuctionState.PROCESSING;
        if(isResume) {
            emit BidProcessingResumed(bids.length, encryptedBids.length);
        } else {
            emit BidProcessingStarted(encryptedBids.length);
        }
        // Start recursive processing of bids
        _processBids();
    }

    function sendBid(bytes calldata encryptedBid) external payable {
        require(block.timestamp < endTime, AuctionEnded());
        require(state == AuctionState.OPEN, InvalidState(state));
        require(msg.value >= minimumDepositPerBid, NotEnoughDeposit());
        require(numBids[msg.sender] < maxBidsPerBidder, MaxBidsPerBidderReached());
        uint256 expectedLength = BITE.TE_RETURN_SIZE_THRESHOLD + 1 + 32;
        require(encryptedBid.length == expectedLength, InvalidEncryptedBid(encryptedBid.length, expectedLength));
        // Send CTX to decrypt the bid
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = encryptedBid;

        bytes[] memory plaintextArgs = new bytes[](2);
        plaintextArgs[0] = abi.encodePacked(msg.sender);
        plaintextArgs[1] = encryptedBid;

        address payable ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            gasForBid,
            encryptedArgs,
            plaintextArgs
        );
        require(!_authorizedCtxSenders[ctxSender], DuplicateCTXSender());
        _authorizedCtxSenders[ctxSender] = true;

        // We assume constant gas price on SKALE
        ctxSender.sendValue(gasForBid * gasPrice);
    }

    function cancelAuction() external onlyOwner {
        require(state == AuctionState.NOT_STARTED || state == AuctionState.OPEN, InvalidState(state));
        if(_bidders.length() > 0) {
            _refundGas = address(this).balance / _bidders.length();
        }
        state = AuctionState.CANCELLED;
        emit AuctionCancelled(tokenId);
        nft.transferFrom(address(this), owner(), tokenId);
    }

    function startAuction(uint256 endTime_) external payable onlyOwner {
        require(state == AuctionState.NOT_STARTED, InvalidState(state));
        require(nft.ownerOf(tokenId) == address(this), NotOwnerOfToken());
        require(endTime_ > block.timestamp + 1 minutes, InvalidEndTime()); // min 1 minute

        // Must send some amount of gas tokens to cover base CTX of processing low amount of bids per callback
        require(msg.value >= 450_000 * gasPrice, NotEnoughDeposit());
        endTime = endTime_;
        state = AuctionState.OPEN;
        emit AuctionStarted(tokenId);
    }

    /// @notice Rank `index` after finalization: 0 = highest, up to `topWinnersCount - 1`.
    function getTopBid(uint256 index) external view returns (Bid memory bid) {
        require(index < _topWinners.length(), IndexOutOfBounds());
        return _topWinners.at(index);
    }

    function rankedTopBidderCount() external view returns (uint256) {
        return _topWinners.length();
    }

    /// @notice Whether `bidder` currently appears in the top-`topWinnersCount` leaderboard.
    function isRankedTopWinner(address bidder) external view returns (bool) {
        return _topWinners.contains(bidder);
    }

    function _updateWinner(Bid memory bid) private {
        _topWinners.insertUnique(
            topWinnersCount,
            Bid({ bidder: bid.bidder, amount: bid.amount })
        );
    }

    function _processBids() private {
        if(bids.length >= encryptedBids.length) {
            state = AuctionState.FINALIZED;
            emit AuctionFinalized(bids.length);
            return;
        }

        uint256 missingBids = encryptedBids.length - bids.length;
        if(missingBids > 5){
            missingBids = 5;
        }
        bytes[] memory encryptedArgs = new bytes[](missingBids);
        for(uint256 i = 0; i < missingBids; i++){
            encryptedArgs[i] = encryptedBids[bids.length + i];
        }
        bytes[] memory plaintextArgs = new bytes[](0);
        uint256 gasNeeded = gasForProcessingBids * missingBids;
        if(missingBids < 5) {
            gasNeeded += 350_000; // For final bids, in case only few are sent.
        }
        address payable ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            gasNeeded,
            encryptedArgs,
            plaintextArgs
        );
        _authorizedCtxSenders[ctxSender] = true;
        ctxSender.sendValue(gasNeeded * gasPrice);
    }

    function _handleBidCallback(bytes[] calldata decryptedArgs, bytes[] calldata plaintextArgs) private {
        require(state == AuctionState.OPEN, InvalidState(state)); // Make sure to send bids on-time, before the settlement starts
        address bidder = address(bytes20(plaintextArgs[0]));
        Bid memory bid = abi.decode(decryptedArgs[0], (Bid));
        require(bid.bidder == bidder, BidderAddressMismatch(bidder, bid.bidder));
        require(bid.amount >= minimumBid, InsufficientBid(bid.amount, minimumBid));
        require(numBids[bidder] < maxBidsPerBidder, MaxBidsPerBidderReached());

        encryptedBids.push(plaintextArgs[1]);
        numBids[bidder]++;
        if(_bidders.add(bidder)) {
            // Must lock at least the minimumBid amount in this contract
            currency.transferFrom(bidder, address(this), minimumBid);
        }
        // TODO: We could add here the ECIES-encrypted amount
        emit BidPlaced(bidder, numBids[bidder]);
    }
}


