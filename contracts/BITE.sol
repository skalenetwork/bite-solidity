// SPDX-License-Identifier: AGPL-3.0-only

/*
    BITE.sol - confidential-token
    Copyright (C) 2026-Present SKALE Labs
    @author Dmytro Stebaiev

    confidential-token is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    confidential-token is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with confidential-token.  If not, see <https://www.gnu.org/licenses/>.
*/

// cspell:words ECIES

pragma solidity ^0.8.24;

import { PublicKey } from "./types.sol";


/**
 * @title BITE Library
 * @author Dmytro Stebaiev
 * @notice Library for interacting with SKALE-specific precompiles of BITE
 */
library BITE {

    /// @notice Address of the EncryptECIES precompiled contract
    address public constant ENCRYPT_ECIES_ADDRESS = address(0x1C);

    /// @notice Address of the EncryptTE precompiled contract
    address public constant ENCRYPT_TE_ADDRESS = address(0x1D);

    /// @notice Address of the submitCTX precompiled contract
    address public constant SUBMIT_CTX_ADDRESS = address(0x1B);

    /// @notice Minimum return size of ThresholdEncryption precompile - 1
    /// @dev 292 (min from crypto scheme) + 32 (min encoded size of input) - 1
    uint256 constant internal TE_RETURN_SIZE_THRESHOLD = 323;

    /// @notice Minimum return size of ECIES precompile - 1
    /// @dev 65 (min from crypto scheme) + 32 (min encoded size of input) - 1
    uint256 constant internal ECIES_RETURN_SIZE_THRESHOLD = 96;
    /// @notice Emitted when a CTX is successfully submitted
    /// @param callbackSender The address that will send the callback
    event CTXSubmitted(address indexed callbackSender);

    error PrecompiledCallFailed(address precompiledContract);
    error EmptyReturnData(address precompiledContract);
    error IncorrectReturnDataLength(address precompiledContract, uint256 expected, uint256 actual);
    error InvalidReturnDataSize(address precompiledContract, uint256 expectedMin, uint256 actual);

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

    /// @notice Calls the EncryptTE precompiled contract
    /// @param encryptTEaddress The address of the EncryptTE precompiled contract
    /// @param text The plaintext data to encrypt
    /// @return cipherText The encrypted data returned by the precompiled contract
    function encryptTE(address encryptTEaddress, bytes memory text) internal view returns (bytes memory cipherText) {
        cipherText = _staticcallPrecompiled(
            encryptTEaddress,
            abi.encode(text)
        );
        require(cipherText.length != 0, EmptyReturnData(encryptTEaddress));
        require(
            cipherText.length > TE_RETURN_SIZE_THRESHOLD,
            InvalidReturnDataSize(encryptTEaddress, TE_RETURN_SIZE_THRESHOLD + 1, cipherText.length)
        );
    }

    /// @notice Calls the EncryptECIES precompiled contract
    /// @param encryptECIESaddress The address of the EncryptECIES precompiled contract
    /// @param text The plaintext data to encrypt
    /// @param publicKey The public key to use for encryption
    /// @return cipherText The encrypted data returned by the precompiled contract
    function encryptECIES(
        address encryptECIESaddress,
        bytes memory text,
        PublicKey memory publicKey
    )
        internal
        view
        returns (bytes memory cipherText)
    {
        cipherText = _staticcallPrecompiled(
            encryptECIESaddress,
            abi.encode(
                text,
                publicKey.x,
                publicKey.y
            )
        );
        require(cipherText.length != 0, EmptyReturnData(encryptECIESaddress));
        require(
            cipherText.length > ECIES_RETURN_SIZE_THRESHOLD,
            InvalidReturnDataSize(encryptECIESaddress, ECIES_RETURN_SIZE_THRESHOLD + 1, cipherText.length)
        );
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

    /**
     * @notice Calls a precompiled contract using staticcall
     * @param precompiledContract The address of the precompiled contract
     * @param input The input data to pass to the precompiled contract
     * @return output The output data from the precompiled contract
     */
    function _staticcallPrecompiled(
        address precompiledContract,
        bytes memory input
    )
        private
        view
        returns (bytes memory output)
    {
        // Have to use low-level calls
        // because it's the only way to call precompiled contracts
        // slither-disable-next-line low-level-calls
        (
            bool success,
            bytes memory out
        ) = precompiledContract.staticcall(input); // solhint-disable-line avoid-low-level-calls
        require(success, PrecompiledCallFailed(precompiledContract));
        return out;
    }
}
