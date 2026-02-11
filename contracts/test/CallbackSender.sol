// SPDX-License-Identifier: AGPL-3.0-only

/*
    CallbackSender.sol - bite-solidity
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

import { ZeroAddress } from "../errors.sol";
import { IBiteSupplicant } from "../interfaces/IBiteSupplicant.sol";


/// @title ICallbackSender
/// @author Dmytro Stebaiev
/// @notice Interface for the CallbackSender contract
interface ICallbackSender {
    /// @notice Fallback function to receive Ether
    receive() external payable;
    /// @notice Locks all ETH held by the contract
    /// @dev Is needed to satisfy slither security warnings
    function freeEth() external;
    /// @notice Sends the decryption callback to the supplicant
    function sendCallback() external;
}

/// @title CallbackSender
/// @author Dmytro Stebaiev
/// @notice Contract to send decryption callbacks to a supplicant
contract CallbackSender is ICallbackSender{

    // slither wants immutable variables to be named in camelCase
    // but we together with solhint prefer UPPER_CASE for immutables
    // slither-disable-start naming-convention

    /// @notice Address of the supplicant contract
    address public immutable SUPPLICANT;

    /// @notice Gas limit for the callback
    uint256 public immutable GAS_LIMIT;

    // slither-disable-end naming-convention

    /// @notice Decrypted arguments to send in the callback
    bytes[] public decryptedArguments;

    /// @notice Plaintext arguments to send in the callback
    bytes[] public plaintextArguments;

    /// @notice Emitted when the contract is funded
    /// @param sender Address of the sender
    /// @param amount Amount of Ether sent
    event AddressFunded(address indexed sender, uint256 indexed amount);

    error InsufficientEth(uint256 required, uint256 available);

    /// @notice Constructor for the CallbackSender contract
    /// @param supplicant Address of the supplicant contract
    /// @param gasLimit Gas limit for the callback
    /// @param decryptedArguments_ Decrypted arguments to send in the callback
    /// @param plaintextArguments_ Plaintext arguments to send in the callback
    constructor(
        address supplicant,
        uint256 gasLimit,
        bytes[] memory decryptedArguments_,
        bytes[] memory plaintextArguments_
    )
    {
        require(supplicant != address(0), ZeroAddress());
        SUPPLICANT = supplicant;
        GAS_LIMIT = gasLimit;
        decryptedArguments = decryptedArguments_;
        plaintextArguments = plaintextArguments_;
    }

    /// @inheritdoc ICallbackSender
    receive() external payable override {
        emit AddressFunded(msg.sender, msg.value);
    }

    /// @inheritdoc ICallbackSender
    function freeEth() external override {
        payable(address(0)).transfer(address(this).balance);
    }

    /// @inheritdoc ICallbackSender
    function sendCallback() external override {
        require(
            // The right side is not constant
            // there is no gas savings
            // solhint-disable-next-line gas-strict-inequalities
            address(this).balance >= GAS_LIMIT * tx.gasprice,
            InsufficientEth(GAS_LIMIT * tx.gasprice, address(this).balance)
        );
        IBiteSupplicant(SUPPLICANT).onDecrypt{ gas: GAS_LIMIT }(
            decryptedArguments,
            plaintextArguments
        );
    }
}
