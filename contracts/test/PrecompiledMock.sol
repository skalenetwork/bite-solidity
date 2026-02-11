// SPDX-License-Identifier: AGPL-3.0-only

/*
    PrecompiledMock.sol - bite-solidity
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


/// @title PrecompiledMock
/// @author Dmytro Stebaiev
/// @notice Base contract for precompiled contract mocks
abstract contract PrecompiledMock {
    /// @notice Fallback function to simulate precompiled contract call
    /// @param data The calldata passed to the precompiled contract
    /// @return result The result returned by the precompiled contract
    fallback(bytes calldata data) external returns (bytes memory result) {
        return _call(data);
    }

    /// @notice Internal function to be implemented by derived contracts
    /// @param data The calldata passed to the precompiled contract
    /// @return result The result returned by the precompiled contract
    function _call(bytes calldata data) internal virtual returns (bytes memory result);
}
