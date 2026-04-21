// SPDX-License-Identifier: AGPL-3.0-only

/**
 *   v0.5/Errors.sol - bite-solidity
 *   Copyright (C) 2026-Present SKALE Labs
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

// Disable gas-custom-errors because old versions of Solidity don't support custom errors
// solhint-disable gas-custom-errors

// This file is developed for compatibility with old solidity versions.abi
// solhint-disable compiler-version

pragma solidity >=0.5.0 <0.6.0;

/// @title Very Legacy Errors Library
/// @author Eduardo Vasques
/// @notice revert reasons and error handlers for BITE precompiles, compatible with old solidity versions
/// @dev This should be an exact copy of v0.6/Errors.sol with only the pragma changed
library VeryLegacyErrors {

    // Cost/benefit here of using this pattern is worth the ignore
    /* solhint-disable code-complexity */
    function handleCTXPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        if (errorCode == 2) revert("CTXInputTooShort");
        if (errorCode == 3) revert("CTXInvalidDestination");
        if (errorCode == 4) revert("CTXInvalidGasLimit");
        if (errorCode == 5) revert("CTXDataOffsetOutOfBounds");
        if (errorCode == 6) revert("CTXDataTooShort");
        if (errorCode == 7) revert("CTXAbiToRlpConversionFailed");
        if (errorCode == 8) revert("CTXAbiToRlpUnknownError");
        if (errorCode == 9) revert("CTXInvalidSignature");
        if (errorCode == 10) revert("CTXInvalidTransaction");
        if (errorCode == 11) revert("CTXCountNotVerifyTransaction");

        revert("CTXUnknownError");
    }
    /* solhint-enable code-complexity */

    function handleECIESPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        _handleEncryptPrecompileError(errorCode);
        if (errorCode == 7) revert("ECIESInvalidPublicKey");
        if (errorCode == 8) revert("ECIESEncryptionFailed");

        revert("UnknownEncryptionError");
    }

    function handleTEPrecompileError(bytes memory output) internal pure {
        uint256 errorCode = _decodeError(output);

        _handleEncryptPrecompileError(errorCode);

        revert("UnknownEncryptionError");
    }

    // Private

    function _decodeError(bytes memory output) private pure returns (uint256 errorCode) {
        if (output.length != 32) {
            revert("UnknownError");
        }
        return abi.decode(output, (uint256));
    }

    function _handleEncryptPrecompileError(uint256 errorCode) private pure {
        if (errorCode == 1) revert("InputTooLarge");
        if (errorCode == 2) revert("InputTooShort");
        if (errorCode == 3) revert("InputNot32ByteAligned");
        if (errorCode == 4) revert("InvalidDataOffset");
        if (errorCode == 5) revert("DataLengthMismatch");
        if (errorCode == 6) revert("TrailingPaddingNotZeros");
    }
}
