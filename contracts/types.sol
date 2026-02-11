// SPDX-License-Identifier: AGPL-3.0-only

/**
 *   types.sol - bite-solidity
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


struct PublicKey {
    bytes32 x;
    bytes32 y;
}
