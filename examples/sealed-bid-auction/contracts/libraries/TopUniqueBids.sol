// SPDX-License-Identifier: AGPL-3.0-only

/*
    TopUniqueBids.sol - bite-solidity
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

pragma solidity ^0.8.27;

import { Bid } from "../types.sol";

/**
 * @title TopUniqueBids
 * @author Eduardo Vasques
 * @notice Maintains a descending-sorted leaderboard of at most `cap` bids with unique bidders.
 */
library TopUniqueBids {

    struct Leaderboard {
        Bid[] entries;
        /// @dev 0 = not in `entries`; otherwise `entries` index is `ranked[bidder] - 1`.
        mapping(address bidder => uint256 index) ranked;
    }

    error ZeroBidder();

    /// @notice Insert or upgrade `bid`. Same bidder cannot appear twice; higher amount replaces lower.
    function insertUnique(Leaderboard storage lb, uint256 cap, Bid memory bid) internal {
        if (bid.bidder == address(0)) revert ZeroBidder();
        if (cap == 0) return;

        uint256 n = lb.entries.length;

        if (_exists(lb, bid.bidder)) {
            uint256 idx = lb.ranked[bid.bidder] - 1;
            if (bid.amount > lb.entries[idx].amount) {
                _removeAt(lb, idx);
                n = lb.entries.length;
            }
            else return;

        }

        if (n == cap && (bid.amount <= lb.entries[n - 1].amount)) {
            return;
        }

        uint256 pos = _descendingInsertPos(lb.entries, n, bid.amount);

        if (n < cap) {
            lb.entries.push(Bid(address(0), 0));
            for (uint256 i = n; i > pos; ) {
                unchecked {
                    lb.entries[i] = lb.entries[i - 1];
                    lb.ranked[lb.entries[i].bidder] = i + 1;
                    --i;
                }
            }
            lb.entries[pos] = bid;
        } else {
            address evicted = lb.entries[n - 1].bidder;
            lb.ranked[evicted] = 0;
            for (uint256 i = n - 1; i > pos; ) {
                unchecked {
                    lb.entries[i] = lb.entries[i - 1];
                    lb.ranked[lb.entries[i].bidder] = i + 1;
                    --i;
                }
            }
            lb.entries[pos] = bid;
        }

        lb.ranked[bid.bidder] = pos + 1;
    }

    function length(Leaderboard storage lb) internal view returns (uint256) {
        return lb.entries.length;
    }

    function at(Leaderboard storage lb, uint256 index) internal view returns (Bid storage) {
        return lb.entries[index];
    }

    function contains(Leaderboard storage lb, address bidder) internal view returns (bool) {
        return _exists(lb, bidder);
    }

    function _exists(Leaderboard storage lb, address bidder) private view returns (bool) {
        return lb.ranked[bidder] > 0;
    }

    function _removeAt(Leaderboard storage lb, uint256 idx) private {
        uint256 n = lb.entries.length;
        address removed = lb.entries[idx].bidder;
        lb.ranked[removed] = 0;
        for (uint256 i = idx; i + 1 < n; ) {
            unchecked {
                lb.entries[i] = lb.entries[i + 1];
                lb.ranked[lb.entries[i].bidder] = i + 1;
                ++i;
            }
        }
        lb.entries.pop();
    }

    /// @dev `entries` sorted high → low; returns index where `bidAmount` belongs.
    function _descendingInsertPos(
        Bid[] storage entries,
        uint256 n,
        uint256 bidAmount
    ) private view returns (uint256 pos) {
        while (pos < n && bidAmount <= entries[pos].amount) {
            unchecked {
                ++pos;
            }
        }
    }
}
