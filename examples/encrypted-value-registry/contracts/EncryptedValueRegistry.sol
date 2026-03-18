// SPDX-License-Identifier: AGPL-3.0-only

/*
    EncryptedValueRegistry.sol - bite-solidity
    Copyright (C) 2026-Present SKALE Labs
    @author Eduardo Vasques

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

import { BITE, PublicKey } from "@skalenetwork/bite-solidity/contracts/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/contracts/interfaces/IBiteSupplicant.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract EncryptedValueRegistry is IBiteSupplicant, Ownable {
    using Address for address payable;

    uint256 public minCallbackGas = 300_000;

    bytes private encryptedValue;
    mapping (address => bytes) private _accessList;
    mapping (address => bool) private _canCallOnDecrypt;

    error AccessDenied();
    error NotEnoughValueSentForGas();

    constructor() Ownable(msg.sender) {}

    function setValue(uint256 _value) external onlyOwner {
        encryptedValue = BITE.encryptTE(
            BITE.ENCRYPT_TE_ADDRESS,
            abi.encode(_value)
        );
    }


    // Owner cannot view the value, but can authorize viewers
    function grantAccess(PublicKey memory publicKey) external payable onlyOwner {
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = encryptedValue;

        bytes[] memory plaintextArgs = new bytes[](1);
        plaintextArgs[0] = abi.encode(publicKey);

        // gasprice is fixed on SKALE, so price should be the same at block N+1 as it is now.
        uint256 allowedGas = msg.value / tx.gasprice;
        require(allowedGas > minCallbackGas, NotEnoughValueSentForGas());

        address payable ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            allowedGas,
            encryptedArgs,
            plaintextArgs
        );

        _canCallOnDecrypt[ctxSender] = true;

        ctxSender.sendValue(msg.value);
    }

    function onDecrypt(
        bytes[] calldata decryptedArgs,
        bytes[] calldata plaintextArgs
    ) external override {
        // Ensure that only the random address created by submitCTX can call this function
        require(_canCallOnDecrypt[msg.sender], AccessDenied());
        _canCallOnDecrypt[msg.sender] = false;

        uint256 decryptedValue = abi.decode(decryptedArgs[0], (uint256));
        PublicKey memory ownerPublicKey = abi.decode(plaintextArgs[0], (PublicKey));
        address owner = pubKeyToAddress(ownerPublicKey);
        bytes memory newEncryptedValue = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            abi.encode(decryptedValue),
            ownerPublicKey
        );
        _accessList[owner] = newEncryptedValue;
    }

    function getEncryptedValue() external view returns (bytes memory) {
        return _accessList[msg.sender];
    }

    function pubKeyToAddress(PublicKey memory publicKey) private pure returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(publicKey.x, publicKey.y));
        return address(uint160(uint256(hash)));
    }
}
