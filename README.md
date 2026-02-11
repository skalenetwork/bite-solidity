# bite-solidity

Solidity helpers to interact with BITE

## Example

```solidity
// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity ^0.8.24;

import {BITE} from "@skalenetwork/bite-solidity/BITE.sol";
import {IBiteSupplicant} from "../interfaces/bite/IBiteSupplicant.sol";


contract Example is IBiteSupplicant {
    bytes public decryptedMessage;
    address public ctxSender;

    error AccessViolation();

    function decrypt(bytes calldata cipher) external {
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = cipher;

        bytes[] memory plaintextArgs = new bytes[](0);

        ctxSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            1_000_000,
            encryptedArgs,
            plaintextArgs
        );
    }

    function onDecrypt(
        bytes[] calldata decryptedArgs,
        bytes[] calldata /* plaintextArgs */
    ) external override {
        require(msg.sender == ctxSender, AccessViolation());
        decryptedMessage = decryptedArgs[0];
    }
}
```
