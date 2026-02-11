// SPDX-License-Identifier: AGPL-3.0-only

/*
    SubmitCTXMock.sol - bite-solidity
    Copyright (C) 2026-Present SKALE Labs
    @author Dmytro Stebaiev

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

pragma solidity ^0.8.24;

import {BiteMock} from "./BiteMock.sol";
import { PrecompiledMock } from "./PrecompiledMock.sol";


/// @title SubmitCTXMock
/// @notice Mock contract for testing SubmitCTX precompile
/// @author Dmytro Stebaiev
contract SubmitCTXMock is PrecompiledMock {
    // slither wants immutable variables to be named in camelCase
    // but we together with solhint prefer UPPER_CASE for immutables
    // slither-disable-start naming-convention

    /// @notice Bite mock contract
    BiteMock public immutable BITE;

    // slither-disable-end naming-convention

    constructor(BiteMock biteAddress) {
        BITE = biteAddress;
    }

    function _call(bytes calldata callData) internal override returns (bytes memory result) {
        (uint256 gasLimit, bytes memory data) = abi.decode(callData, (uint256, bytes));
        (bytes[] memory encryptedArgs, bytes[] memory plaintextArgs) = abi.decode(data, (bytes[], bytes[]));
        address callbackSender = BITE.submitCTX(msg.sender, gasLimit, encryptedArgs, plaintextArgs);
        return abi.encodePacked(bytes20(uint160(callbackSender)));
    }
}
