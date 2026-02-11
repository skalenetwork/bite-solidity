// SPDX-License-Identifier: AGPL-3.0-only

/*
    BiteMock.sol - bite-solidity
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

// cspell:words deque ECIES

pragma solidity ^0.8.24;

import { DoubleEndedQueue } from "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";

import { CallbackSender } from "./CallbackSender.sol";


/// @title IBiteMock
/// @author Dmytro Stebaiev
/// @notice Interface for BiteMock contract
interface IBiteMock {
    /// @notice Submits a CTX for decryption and execution
    /// @param supplicant Address of the supplicant contract
    /// @param gasLimit Gas limit for the callback
    /// @param encryptedArgs Encrypted arguments
    /// @param plaintextArgs Plaintext arguments
    /// @return callbackSender Address of the CallbackSender contract
    function submitCTX(
        address supplicant,
        uint256 gasLimit,
        bytes[] calldata encryptedArgs,
        bytes[] calldata plaintextArgs
    )
        external
        returns (address callbackSender);

    /// @notice Sends the next queued callback
    function sendCallback() external;

    /// @notice Encrypts a message with TE encryption key
    /// @param message The message to encrypt
    /// @return cypherText The encrypted message
    function encryptTE(bytes memory message) external pure returns (bytes memory cypherText);

    /// @notice Encrypts a message with ECIES encryption key
    /// @param message The message to encrypt
    /// @param keyX The X coordinate of the public key to use for encryption
    /// @param keyY The Y coordinate of the public key to use for encryption
    /// @return cypherText The encrypted message
    function encryptECIES(
        bytes memory message,
        bytes32 keyX,
        bytes32 keyY
    ) external pure returns (bytes memory cypherText);

    /// @notice Decrypts a cypherText with ECIES encryption key
    /// @param cypherText The cypherText to decrypt
    /// @param key The public key used for decryption
    /// @return message The decrypted message
    function decryptECIES(
        bytes memory cypherText,
        uint256 key
    ) external pure returns (bytes memory message);

    /// @notice Decrypts a cypherText with TE encryption key
    /// @param cypherText The cypherText to decrypt
    /// @return message The decrypted message
    function decryptTE(bytes memory cypherText) external pure returns (bytes memory message);

    /// @notice Converts a public key to uint256 representation
    /// @param x The X coordinate of the public key
    /// @param y The Y coordinate of the public key
    /// @return key The uint256 representation of the public key
    function pubKeyToUint256(bytes32 x, bytes32 y) external pure returns (uint256 key);
}

/// @title BiteMock
/// @author Dmytro Stebaiev
/// @notice Mock contract for BITE functionality
contract BiteMock is IBiteMock{
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;

    /// @notice Mock symmetric encryption key
    uint256 public constant MOCK_TE_KEY = 36028797018963913;

    /// @notice TE overhead in bytes
    uint256 public constant TE_OVERHEAD = 292;

    /// @notice ECIES overhead in bytes
    uint256 public constant ECIES_OVERHEAD = 65;

    DoubleEndedQueue.Bytes32Deque private _queue;

    error NoCallbacksQueued();

    /// @inheritdoc IBiteMock
    function submitCTX(
        address supplicant,
        uint256 gasLimit,
        bytes[] calldata encryptedArgs,
        bytes[] calldata plaintextArgs
    )
        external
        override
        returns (address callbackSender)
    {
        uint256 length = encryptedArgs.length;
        bytes[] memory decryptedArgs = new bytes[](length);
        for (uint256 i = 0; i < length; ++i) {
            decryptedArgs[i] = decryptTE(encryptedArgs[i]);
        }
        CallbackSender sender = new CallbackSender(
            supplicant,
            gasLimit,
            decryptedArgs,
            plaintextArgs
        );

        _queue.pushBack(bytes32(uint256(uint160(address(sender)))));

        return address(sender);
    }

    /// @inheritdoc IBiteMock
    function sendCallback() external override {
        require(!_queue.empty(), NoCallbacksQueued());
        address payable senderAddress = payable(address(uint160(uint256(_queue.popFront()))));
        CallbackSender(senderAddress).sendCallback();
    }

    // Public

    /// @inheritdoc IBiteMock
    function encryptECIES(
        bytes memory message,
        bytes32 keyX,
        bytes32 keyY
    )
        public
        pure
        override
        returns (bytes memory cypherText)
    {
        cypherText = _symmetricCipher(message, pubKeyToUint256(keyX, keyY));
        // Append ECIES overhead
        return _addOverhead(cypherText, ECIES_OVERHEAD);
    }

    /// @inheritdoc IBiteMock
    function encryptTE(bytes memory message) public pure override returns (bytes memory cypherText) {
        cypherText = _symmetricCipher(message, MOCK_TE_KEY);
        return _addOverhead(cypherText, TE_OVERHEAD);
    }

    /// @inheritdoc IBiteMock
    function decryptTE(bytes memory cypherText) public pure override returns (bytes memory message) {
        bytes memory stripped = _stripOverhead(cypherText, TE_OVERHEAD);
        message = _symmetricCipher(stripped, MOCK_TE_KEY);
    }

    /// @inheritdoc IBiteMock
    function decryptECIES(
        bytes memory cypherText,
        uint256 key
    )
        public
        pure
        override
        returns (bytes memory message)
    {
        bytes memory stripped = _stripOverhead(cypherText, ECIES_OVERHEAD);
        message = _symmetricCipher(stripped, key);
    }

    /// @inheritdoc IBiteMock
    function pubKeyToUint256(bytes32 x, bytes32 y) public pure override returns (uint256 key) {
        key = uint256(keccak256(abi.encodePacked(x, y)));
    }

    // Private

    /// @notice Strips overhead bytes from the end of data
    /// @param data The data to process
    /// @param overhead The number of overhead bytes to strip
    /// @return result The data without overhead
    function _stripOverhead(
        bytes memory data,
        uint256 overhead
    )
        private
        pure
        returns (bytes memory result)
    {
        uint256 resultLength = data.length - overhead;
        result = new bytes(resultLength);
        for (uint256 i = 0; i < resultLength; ++i) {
            result[i] = data[i];
        }
    }

    /// @notice Adds overhead bytes to the end of data
    /// @param data The data to process
    /// @param overhead The number of overhead bytes to add
    /// @return result The data with overhead
    function _addOverhead(bytes memory data, uint256 overhead) private pure returns (bytes memory result) {
        uint256 dataLength = data.length;
        result = new bytes(dataLength + overhead);
        for (uint256 i = 0; i < dataLength; ++i) {
            result[i] = data[i];
        }
    }

    /// @notice Performs mock symmetric encryption/decryption
    /// @param data The data to process
    /// @param key The symmetric key
    /// @return output The data after symmetric encrypt operation
    function _symmetricCipher(bytes memory data, uint256 key) private pure returns (bytes memory output) {
        uint256 size = data.length;
        output = new bytes(size);
        for (uint256 i = 0; i < size; ++i) {
            bytes32 expansion = keccak256(abi.encodePacked(key, i / 32));
            output[i] = data[i] ^ expansion[i % 32];
        }
    }
}
