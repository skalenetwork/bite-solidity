// SPDX-License-Identifier: AGPL-3.0-only

/**
 *   IBiteSupplicant.sol - bite-solidity
 *   Copyright (C) 2026-Present SKALE Labs
 *   @author Dmytro Stebaiev
 *
 *   bite-solidity is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Affero General Public License as published
 *   by the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   bite-solidity is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Affero General Public License for more details.
 *
 *   You should have received a copy of the GNU Affero General Public License
 *   along with bite-solidity.  If not, see <https://www.gnu.org/licenses/>.
 */

pragma solidity ^0.8.24;


/// @title IBiteSupplicant
/// @author Dmytro Stebaiev
/// @notice Interface for contracts that can handle decrypted data from BITE
interface IBiteSupplicant {
    /// @notice Called by the DecryptAndExecute precompiled contract after decryption
    /// @param decryptedArguments The decrypted arguments
    /// @param plaintextArguments The plaintext arguments
    function onDecrypt(
        bytes[] calldata decryptedArguments,
        bytes[] calldata plaintextArguments
    ) external;
}
