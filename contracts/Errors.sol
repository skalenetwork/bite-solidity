// SPDX-License-Identifier: AGPL-3.0-only

/**
 *   errors.sol - bite-solidity
 *   Copyright (C) 2026-Present SKALE Labs
 *   @author Dmytro Stebaiev
 *   @author Eduardo Vasques
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

// This file is developed for using with old solidity versions.abi
// solhint-disable compiler-version

pragma solidity >=0.8.4;

/// @title Errors Library
/// @author Eduardo Vasques
/// @author Dmytro Stebaiev
/// @notice Custom errors and handlers for BITE precompiles
library Errors {

    // Common
    error UnknownError(bytes errorData);

    // CTX Precompile
    error CTXInputTooShort(uint256 errorCode);                // 2
    error CTXInvalidDestination(uint256 errorCode);           // 3
    error CTXInvalidGasLimit(uint256 errorCode);              // 4
    error CTXDataOffsetOutOfBounds(uint256 errorCode);        // 5
    error CTXDataTooShort(uint256 errorCode);                 // 6
    error CTXAbiToRlpConversionFailed(uint256 errorCode);     // 7
    error CTXAbiToRlpUnknownError(uint256 errorCode);         // 8
    error CTXInvalidSignature(uint256 errorCode);             // 9
    error CTXInvalidTransaction(uint256 errorCode);           // 10
    error CTXCountNotVerifyTransaction(uint256 errorCode);    // 11
    error CTXUnknownError(uint256 errorCode);                 // --

    // Encrypt Precompiles common

    error UnknownEncryptionError(uint256 errorCode);          // 0 or possibly others
    error InputTooLarge(uint256 errorCode);                   // 1
    error InputTooShort(uint256 errorCode);                   // 2
    error InputNot32ByteAligned(uint256 errorCode);           // 3
    error InvalidDataOffset(uint256 errorCode);               // 4
    error DataLengthMismatch(uint256 errorCode);              // 5
    error TrailingPaddingNotZeros(uint256 errorCode);         // 6

    // ECIES Precompile

    error ECIESInvalidPublicKey(uint256 errorCode);           // 7
    error ECIESEncryptionFailed(uint256 errorCode);           // 8

    // Error handler functions

    // Cost/benefit here of using this pattern is worth the ignore
    /* solhint-disable code-complexity */
    function handleCTXPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        if (errorCode == 2) revert CTXInputTooShort(errorCode);
        if (errorCode == 3) revert CTXInvalidDestination(errorCode);
        if (errorCode == 4) revert CTXInvalidGasLimit(errorCode);
        if (errorCode == 5) revert CTXDataOffsetOutOfBounds(errorCode);
        if (errorCode == 6) revert CTXDataTooShort(errorCode);
        if (errorCode == 7) revert CTXAbiToRlpConversionFailed(errorCode);
        if (errorCode == 8) revert CTXAbiToRlpUnknownError(errorCode);
        if (errorCode == 9) revert CTXInvalidSignature(errorCode);
        if (errorCode == 10) revert CTXInvalidTransaction(errorCode);
        if (errorCode == 11) revert CTXCountNotVerifyTransaction(errorCode);

        revert CTXUnknownError(errorCode);
    }
    /* solhint-enable code-complexity */

    function handleECIESPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        _handleEncryptPrecompileError(errorCode);
        if (errorCode == 7) revert ECIESInvalidPublicKey(errorCode);
        else if (errorCode == 8) revert ECIESEncryptionFailed(errorCode);

        revert UnknownEncryptionError(errorCode);
    }

    function handleTEPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        _handleEncryptPrecompileError(errorCode);

        revert UnknownEncryptionError(errorCode);
    }

    // Private

    function _decodeError(bytes memory output) private pure returns (uint256 errorCode) {
        if (output.length != 32) {
            revert UnknownError(output);
        }
        return abi.decode(output, (uint256));
    }

    function _handleEncryptPrecompileError(uint256 errorCode) private pure {
        if (errorCode == 1) revert InputTooLarge(errorCode);
        else if (errorCode == 2) revert InputTooShort(errorCode);
        else if (errorCode == 3) revert InputNot32ByteAligned(errorCode);
        else if (errorCode == 4) revert InvalidDataOffset(errorCode);
        else if (errorCode == 5) revert DataLengthMismatch(errorCode);
        else if (errorCode == 6) revert TrailingPaddingNotZeros(errorCode);
    }
}
