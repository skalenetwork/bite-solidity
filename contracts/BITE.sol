// SPDX-License-Identifier: AGPL-3.0-only

/*
    BITE.sol - bite-solidity
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


/**
 * @title BITE Library
 * @author Dmytro Stebaiev
 * @notice Library for interacting with SKALE-specific precompiles of BITE
 */
library BITE {

    /// @notice Address of the submitCTX precompiled contract
    address public constant SUBMIT_CTX_ADDRESS = address(0x1B);

    /// @notice Emitted when a CTX is successfully submitted
    /// @param callbackSender The address that will send the callback
    event CTXSubmitted(address indexed callbackSender);

    error PrecompiledCallFailed(address precompiledContract);
    error IncorrectReturnDataLength(address precompiledContract, uint256 expected, uint256 actual);

    /// @notice Calls the SubmitCTX precompiled contract
    /// @param submitCTXAddress The address of the SubmitCTX precompiled contract
    /// @param gasLimit The gas limit for the callback
    /// @param encryptedArguments The encrypted arguments to pass to the precompiled contract
    /// @param plaintextArguments The plaintext arguments to pass to the precompiled contract
    /// @return callbackSender The address that will send the callback
    function submitCTX(
        address submitCTXAddress,
        uint256 gasLimit,
        bytes[] memory encryptedArguments,
        bytes[] memory plaintextArguments
    )
        internal
        returns (address payable callbackSender)
    {
        bytes memory addressBytes = _callPrecompiled(
            submitCTXAddress,
            abi.encode(
                gasLimit,
                abi.encode(
                    encryptedArguments,
                    plaintextArguments
                )
            )
        );
        require(
            addressBytes.length == 20,
            IncorrectReturnDataLength(submitCTXAddress, 20, addressBytes.length)
        );
        callbackSender = payable(address(bytes20(addressBytes)));
        // The system precompiled contract is called.
        // It's trusted and doesn't perform any external calls,
        // so reentrancy is not an issue here.
        // slither-disable-next-line reentrancy-events
        emit CTXSubmitted(callbackSender);
    }

    // Private

    /**
     * @notice Calls a precompiled contract with the given input
     * @param precompiledContract The address of the precompiled contract
     * @param input The input data to pass to the precompiled contract
     * @return output The output data from the precompiled contract
     */
    function _callPrecompiled(
        address precompiledContract,
        bytes memory input
    )
        private
        returns (bytes memory output)
    {
        // Have to use low-level calls
        // because it's the only way to call precompiled contracts
        // slither-disable-next-line low-level-calls
        (
            bool success,
            bytes memory out
        ) = precompiledContract.call(input); // solhint-disable-line avoid-low-level-calls
        require(success, PrecompiledCallFailed(precompiledContract));
        return out;
    }
}
