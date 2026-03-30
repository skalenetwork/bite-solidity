# bite-solidity

Solidity helpers to interact with BITE protocol features on SKALE networks. It exposes wrappers around the BITE-specific precompiled contracts for threshold encryption (TE), ECIES encryption, and conditional transaction (CTX) submission, plus the callback interface that contracts must implement.

*Note*: For detailed examples and usage, please visit the official repository - it includes a dedicated `examples/` folder.

## Example

```solidity
// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity ^0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { BITE } from "@skalenetwork/bite-solidity/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/interfaces/IBiteSupplicant.sol";

contract Example is IBiteSupplicant {
    using Address for address payable;

    bytes public decryptedMessage;
    bytes public encryptedMessage;
    address public ctxSender;

    error AccessViolation();

    // Input encrypted off-chain using @skalenetwork/bite-ts library, or use `encryptedMessage`
    function decrypt(bytes calldata cipher) external payable {
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = cipher;

        bytes[] memory plaintextArgs = new bytes[](0);

        ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            msg.value / tx.gasprice,
            encryptedArgs,
            plaintextArgs
        );

        payable(ctxSender).sendValue(msg.value);
    }

    function encrypt(bytes memory message) external {
        encryptedMessage = BITE.encryptTE(
            BITE.ENCRYPT_TE_ADDRESS,
            message
        );
    }

    // onDecrypt will usually include sensitive operations
    // It is important to always cross-check the sender is correct
    function onDecrypt(
        bytes[] calldata decryptedArgs,
        bytes[] calldata /* plaintextArgs */
    ) external override {
        require(msg.sender == ctxSender, AccessViolation());
        ctxSender = address(0);

        decryptedMessage = decryptedArgs[0];
    }
}
```
