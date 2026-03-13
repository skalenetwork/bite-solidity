pragma solidity ^0.8.24;

import { BITE, PublicKey } from "@skalenetwork/bite-solidity/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/interfaces/IBiteSupplicant.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

contract EncryptedValueRegistry is IBiteSupplicant {
    using Address for address payable;

    bytes private encryptedValue;
    mapping (address => bytes) private accessList;

    constructor(uint256 _value) {
        encryptedValue = BITE.encryptTE(
            BITE.ENCRYPT_TE_ADDRESS,
            abi.encode(_value)
        );
    }

    function grantAccess(PublicKey memory publicKey) external payable {
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = encryptedValue;

        bytes[] memory plaintextArgs = new bytes[](1);
        plaintextArgs[0] = abi.encode(publicKey);

        address payable ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            2500000,
            encryptedArgs,
            plaintextArgs
        );

        ctxSender.sendValue(msg.value);
    }

    function onDecrypt(
        bytes[] calldata decryptedArgs,
        bytes[] calldata plaintextArgs
    ) external override {
        uint256 decryptedValue = abi.decode(decryptedArgs[0], (uint256));
        PublicKey memory ownerPublicKey = abi.decode(plaintextArgs[0], (PublicKey));
        address owner = pubKeyToAddress(ownerPublicKey);
        bytes memory newEncryptedValue = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            abi.encode(decryptedValue),
            ownerPublicKey
        );
        accessList[owner] = newEncryptedValue;
    }

    function getEncryptedValue() external view returns (bytes memory) {
        return accessList[msg.sender];
    }

    function pubKeyToAddress(PublicKey memory publicKey) private pure returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(publicKey.x, publicKey.y));
        return address(uint160(uint256(hash)));
    }
}
