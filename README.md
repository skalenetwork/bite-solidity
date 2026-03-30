<!-- cspell:words ECIES hardforks ciphertext -->
# BITE-solidity

<div align="center">

[![License](https://img.shields.io/github/license/skalenetwork/bite-solidity.svg)](LICENSE)
[![Discord](https://img.shields.io/discord/534485763354787851.svg)](https://discord.gg/skale)
[![Build Status](https://github.com/skalenetwork/bite-solidity/actions/workflows/test.yml/badge.svg)](https://github.com/skalenetwork/bite-solidity/actions)

<p> A Solidity Library for building smart contracts that leverage BITE 2 on SKALE. </p>

</div>

## Introduction

Solidity library for building smart contracts that leverage SKALE's BITE 2 blockchain capabilities. It exposes wrappers around the BITE-specific precompiled contracts for threshold encryption (TE), ECIES encryption, and conditional transaction (CTX) submission, plus the callback interface that contracts must implement.

## Installation

### Use as a package dependency

Add to your own Hardhat or Foundry project:

```bash
yarn add @skalenetwork/bite-solidity
# or
npm install @skalenetwork/bite-solidity
```

## Usage

For detailed usage, integration patterns, and end-to-end examples, see [examples/README.md](examples/README.md). The examples are organized as a Yarn workspaces monorepo — each example is a thin workspace member that reuses shared Hardhat config, TypeScript config, and script utilities from the workspace root.

> **Disclaimer:** Code under `examples/` is **not** production-ready and is provided for educational and demonstration purposes only.

**Important:** If your contract interacts with BITE precompiles, compile with EVM version `istanbul` for now.

## Legacy Solidity support

If your project targets an older Solidity compiler, import the matching legacy file instead of `BITE.sol`:

| File | Minimum Solidity version |
|---|---|
| `BITE.sol` | `>=0.8.27` |
| `LegacyBITE.sol` | `>=0.8.5` |
| `VeryLegacyBITE.sol` | `>=0.8.4` |
| `VeryVeryLegacyBITE.sol` | `>=0.8.0` |
| `VeryVeryVeryLegacyBITE.sol` | `>=0.6.0` |
| `VeryVeryVeryVeryLegacyBITE.sol` | `>=0.5.0 <0.6.0` |

For Solidity `<0.6.0`, also use `LegacyTypes.sol` (which wraps `PublicKey` inside a `Types` library) and `LegacyIBiteSupplicant.sol` instead of their modern counterparts.


Additionally, for a larger real-world example, see the [SKALE confidential-token repository](https://github.com/skalenetwork/confidential-token) and how it leverages `bite-solidity`.


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

## Other References & Useful Links

- [SKALE Network Documentation](https://docs.skale.network/)
- [BITE V2 Protocol Documentation](https://forum.skale.network/t/bite-phase-2-extended-architecture-specification/737)


## License

AGPL-3.0-only

This project is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](LICENSE) for full terms.

