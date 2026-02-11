// SPDX-License-Identifier: AGPL-3.0-only

/*
    EncryptECIESMock.sol - bite-solidity
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

// cspell:words ECIES

pragma solidity ^0.8.24;

import { BiteMock } from "./BiteMock.sol";
import { PrecompiledMock } from "./PrecompiledMock.sol";


/// @title EncryptECIESMock
/// @author Dmytro Stebaiev
/// @notice Mock contract for the EncryptECIES precompiled contract
contract EncryptECIESMock is PrecompiledMock {
    // slither wants immutable variables to be named in camelCase
    // but we together with solhint prefer UPPER_CASE for immutables
    // slither-disable-start naming-convention

    /// @notice Instance of the BiteMock contract
    BiteMock public immutable BITE;

    // slither-disable-end naming-convention

    /// @notice Constructor for the EncryptECIESMock contract
    /// @param biteAddress Address of the BiteMock contract
    constructor(BiteMock biteAddress) {
        BITE = biteAddress;
    }

    /// @notice Internal function to simulate encryption
    /// @param data The calldata passed to the precompiled contract
    /// @return result The encrypted result with ECIES overhead
    function _call(bytes calldata data) internal view override returns (bytes memory result) {
        (bytes memory text, bytes32 pubKeyX, bytes32 pubKeyY) = abi.decode(
            data,
            (bytes, bytes32, bytes32)
        );
        return BITE.encryptECIES(text, pubKeyX, pubKeyY);
    }
}
