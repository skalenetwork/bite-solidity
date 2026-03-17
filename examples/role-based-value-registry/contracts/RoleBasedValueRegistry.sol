// SPDX-License-Identifier: AGPL-3.0-only

/*
    RoleBasedValueRegistry.sol - bite-solidity
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

// cspell:words ECIES

pragma solidity ^0.8.24;

import { BITE, PublicKey } from "@skalenetwork/bite-solidity/contracts/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/contracts/interfaces/IBiteSupplicant.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract RoleBasedValueRegistry is IBiteSupplicant {
    using Address for address payable;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct Role {
        // The public key of this role
        PublicKey publicKey;
        // The role's secret key, encrypted with ECIES for each user
        mapping(address => bytes) userEncryptedSecret;
        // The role's secret key, encryted with TE
        bytes encryptedRoleSecret;
        // A secret visible only for users with this role, encrypted with ECIES using the role's public key
        // Contract can hypothetically be changed to store more values or value mapping
        bytes encryptedValue;
    }

    uint256 public minCallbackGas = 500_000;

    mapping (bytes32 => Role) public rolesData;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    EnumerableSet.Bytes32Set private roleIds;
    mapping (address => bool) private _canCallOnDecrypt;

    event RoleValueChanged(bytes32 indexed roleId, bytes previousEncryptedValue, bytes newEncryptedValue);

    error AccessDenied();
    error CallbackNotRecognized();
    error NotEnoughValueSentForGas();
    error PubKeyMustMatchSender();
    error RoleDoesNotExist();
    error RoleAlreadyExists();
    error UserAlreadyHasRole();

    constructor(
        PublicKey memory adminRolePublicKey,
        PublicKey memory adminPublicKey,
        bytes memory encryptedAdminRoleSecret // Encrypted with TE
    ) payable {
        // Note: Encrypted values are trusted in this example
        // A production-grade implementation should perhaps trigger decryption to verify
        // the encrypted value's integrity before storing it
        _createRole(ADMIN_ROLE, adminRolePublicKey, encryptedAdminRoleSecret);
        require(_pubKeyToAddress(adminPublicKey) == msg.sender, PubKeyMustMatchSender());
        _grantRole(ADMIN_ROLE, adminPublicKey);
    }


    function onDecrypt(bytes[] calldata decryptedArgs, bytes[] calldata plaintextArgs) external override {
        require(_canCallOnDecrypt[msg.sender], AccessDenied());
        // reset permission after handling the callback
        _canCallOnDecrypt[msg.sender] = false;

        if(decryptedArgs.length == 1 && plaintextArgs.length == 2) {
            _handleCreateRoleCallback(decryptedArgs, plaintextArgs);
            return;
        }
        else if(decryptedArgs.length == 1 && plaintextArgs.length == 1) {
            _handleChangeRoleValueCallback(decryptedArgs, plaintextArgs);
            return;
        }
        revert CallbackNotRecognized();
    }

    function encryptForRole(bytes32 roleId, bytes memory encryptedValue) external payable {
        // Allow only users with the role to change the value of the role
        require(_hasRole(roleId, msg.sender), AccessDenied());
        _changeRoleValue(roleId, encryptedValue);
    }

    function createRole(bytes32 roleId, PublicKey memory rolePublicKey, bytes memory encryptedRoleSecret) external payable {
        // Primary check but needs to be checked on callback to avoid "double-spending"
        require(!_roleExists(roleId), RoleAlreadyExists());
        // Allow only Admin for simplicity
        require(_hasRole(ADMIN_ROLE, msg.sender), AccessDenied());

        _createRole(roleId, rolePublicKey, encryptedRoleSecret);
    }

    function grantRole(bytes32 roleId, PublicKey memory userPublicKey) external payable {
        // Allow admins only for simplicity
        require(_hasRole(ADMIN_ROLE, msg.sender) || _hasRole(roleId, msg.sender), AccessDenied());
        _grantRole(roleId, userPublicKey);
    }

    function getValueForRole(bytes32 roleId) external view returns (bytes memory) {
        Role storage role = _getRole(roleId);
        return role.encryptedValue;
    }

    function getMyEncryptedRoleSecret(bytes32 roleId) external view returns (bytes memory) {
        require(_hasRole(roleId, msg.sender), AccessDenied());
        return _getRole(roleId).userEncryptedSecret[msg.sender];
    }

    function _changeRoleValue(bytes32 roleId, bytes memory encryptedValue) private {
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = encryptedValue;
        bytes[] memory plaintextArgs = new bytes[](1);
        plaintextArgs[0] = abi.encode(roleId);

        _createCallback(encryptedArgs, plaintextArgs);
    }

    function _handleChangeRoleValueCallback(bytes[] calldata decryptedArgs, bytes[] calldata plaintextArgs) private {
        bytes32 roleId = abi.decode(plaintextArgs[0], (bytes32));
        Role storage role = _getRole(roleId);
        bytes memory previousEncryptedValue = role.encryptedValue;
        role.encryptedValue = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            decryptedArgs[0],
            role.publicKey
        );

        emit RoleValueChanged(roleId, previousEncryptedValue, role.encryptedValue);
    }

    function _handleCreateRoleCallback(bytes[] memory encryptedArgs, bytes[] memory plaintextArgs) private {
        bytes32 roleId = abi.decode(plaintextArgs[0], (bytes32));
        PublicKey memory userPublicKey = abi.decode(plaintextArgs[1], (PublicKey));
        Role storage role = _getRole(roleId);
        address user = _pubKeyToAddress(userPublicKey);
        require(!_hasRole(roleId, user), UserAlreadyHasRole());
        role.userEncryptedSecret[user] = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            encryptedArgs[0],
            userPublicKey
        );
    }

    // Does not check that the called has permission to grant the role
    // Should be checked by users of this function if required
    function _grantRole(bytes32 roleId, PublicKey memory userPublicKey) private {
        Role storage role = _getRole(roleId);

        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = role.encryptedRoleSecret;
        bytes[] memory plaintextArgs = new bytes[](2);
        plaintextArgs[0] = abi.encode(roleId);
        plaintextArgs[1] = abi.encode(userPublicKey);
        _createCallback(encryptedArgs, plaintextArgs);
    }

    function _createRole(bytes32 roleId, PublicKey memory rolePublicKey, bytes memory encryptedRoleSecret) private {
        Role storage newRole = rolesData[roleId];
        newRole.publicKey = rolePublicKey;
        newRole.encryptedRoleSecret = encryptedRoleSecret;
        require(roleIds.add(roleId), RoleAlreadyExists());
    }

    function _createCallback(bytes[] memory encryptedArgs, bytes[] memory plaintextArgs) private {
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

    function _hasRole(bytes32 roleId, address user) private view returns (bool) {
        return _getRole(roleId).userEncryptedSecret[user].length != 0;
    }

    function _roleExists(bytes32 roleId) private view returns (bool) {
        return roleIds.contains(roleId);
    }

    function _getRole(bytes32 roleId) private view returns (Role storage) {
        require(_roleExists(roleId), RoleDoesNotExist());
        return rolesData[roleId];
    }

    function _pubKeyToAddress(PublicKey memory publicKey) private pure returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(publicKey.x, publicKey.y));
        return address(uint160(uint256(hash)));
    }
}
