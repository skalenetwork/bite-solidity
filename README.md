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

### Clone with submodules

```bash
git clone --recurse-submodules https://github.com/skalenetwork/bite-solidity.git
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### Prerequisites

- Node.js 22+
- Yarn 4+

### Install dependencies

```bash
yarn install
```

### Use as a package dependency

Add to your own Hardhat or Foundry project:

```bash
yarn add @skalenetwork/bite-solidity
# or
npm install @skalenetwork/bite-solidity
```

## Usage

### Overview

BITE 2 blockchains expose three precompiled contracts that enable confidential computation:

| Precompile | Address | Description |
|---|---|---|
| `SubmitCTX` | `0x1B` | Submits a conditional transaction for threshold decryption and callback |
| `EncryptECIES` | `0x1C` | Encrypts data with a specific recipient's secp256k1 public key (ECIES) |
| `EncryptTE` | `0x1D` | Encrypts data with the network's shared threshold encryption key |

The general flow for using a CTX is:

1. Encrypt sensitive data on-chain using `BITE.encryptTE()` or `BITE.encryptECIES()`.
2. Submit the encrypted payload as a CTX via `BITE.submitCTX()`. The call returns a `callbackSender` address — fund it with enough ETH to cover the callback gas.
3. Implement `IBiteSupplicant` in your contract. When the BITE node finishes decryption it will call `onDecrypt()` from that address.

**Important:** For now, we recommend compiling contracts that interact with BITE precompiles using EVM version `istanbul` (for example, `evmVersion: "istanbul"`). Compatibility with newer hardforks is still in progress.

Hardhat example:

```ts
export default {
    solidity: {
        version: "0.8.27",
        settings: {
            evmVersion: "istanbul"
        }
    }
};
```

Foundry example (`foundry.toml`):

```toml
[profile.default]
evm_version = "istanbul"
```

### Basic example — Threshold Encryption CTX

The simplest integration: a contract that accepts an already-TE-encrypted ciphertext, submits it as a CTX, and stores the decrypted result when the callback arrives at block N+1.

**NOTE:** This contract allows only for 1 call to `decrypt` per block - do not use this pattern for production-grade contracts due to how ctxSender is stored.

```solidity
// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity ^0.8.27;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { BITE } from "@skalenetwork/bite-solidity/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/interfaces/IBiteSupplicant.sol";

contract Example is IBiteSupplicant {
    using Address for address payable;

    bytes public decryptedMessage;
    address public ctxSender;

    error AccessViolation();

    /// @notice Encrypt plaintext with BITE threshold encryption.
    /// @param plaintext UTF-8 string to encrypt.
    /// @return cipher TE-encrypted bytes.
    function encrypt(string calldata plaintext) external view returns (bytes memory cipher) {
        return BITE.encryptTE(BITE.ENCRYPT_TE_ADDRESS, bytes(plaintext));
    }

    /// @notice Submit a TE-encrypted ciphertext for decryption.
    /// @param cipher Ciphertext produced by BITE.encryptTE() (on- or off-chain).
    /// @dev msg.value must cover the callback gas cost: gasLimit * tx.gasprice
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

    /// @inheritdoc IBiteSupplicant
    function onDecrypt(
        bytes[] calldata decryptedArgs,
        bytes[] calldata /* plaintextArgs */
    ) external override {
        require(msg.sender == ctxSender, AccessViolation());
        decryptedMessage = decryptedArgs[0];
    }
}
```

To produce ciphertext before calling `decrypt()`, either call `encrypt(plaintext)` on this contract, or directly use the TE precompile.

### ECIES encryption

ECIES encrypts data for a single recipient identified by their secp256k1 public key. Use the `PublicKey` struct from `types.sol`:

```solidity
import { BITE } from "@skalenetwork/bite-solidity/BITE.sol";
import { PublicKey } from "@skalenetwork/bite-solidity/types.sol";

PublicKey memory recipientKey = PublicKey({ x: keyX, y: keyY });
bytes memory cipher = BITE.encryptECIES(BITE.ENCRYPT_ECIES_ADDRESS, plaintext, recipientKey);
```

## Testing locally with mocks

The `contracts/test/` folder provides mock contracts that simulate the BITE precompiles in a standard testing environment, so you can write unit tests without a live BITE 2 node.

Deploy the mocks and wire them in place of the real precompile addresses:

```typescript
const BiteMock = await ethers.getContractFactory("BiteMock");
const bite = await BiteMock.deploy();

const SubmitCTXMock = await ethers.getContractFactory("SubmitCTXMock");
const submitCTXMock = await SubmitCTXMock.deploy(await bite.getAddress());

const EncryptTEMock = await ethers.getContractFactory("EncryptTEMock");
const encryptTEMock = await EncryptTEMock.deploy(await bite.getAddress());

// Pass mock addresses to your contract instead of the real precompile addresses
const myContract = await MyContract.deploy(
    await encryptTEMock.getAddress(),
    await submitCTXMock.getAddress()
);

// After a CTX is submitted, manually trigger the decryption callbackHardhat
// On a real BITE 2 network, this happens automaticaly
await bite.sendCallback();
```

> **Note:** `BiteMock` uses a fixed `MOCK_TE_KEY` for TE and a deterministic XOR-based scheme for ECIES. These mocks are for development and testing purposes only and provide absolutely no cryptographic guarantees.

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

## More examples

See the [examples/](examples/) folder for additional usage patterns:

| Example | Description | Key features |
|---|---|---|


Additionally, for a larger real-world example, see the [SKALE confidential-token repository](https://github.com/skalenetwork/confidential-token) and how it leverages `bite-solidity`.


## References & Useful Links

- [SKALE Network Documentation](https://docs.skale.network/)
- [BITE V2 Protocol Documentation](https://forum.skale.network/t/bite-phase-2-extended-architecture-specification/737)


## License

AGPL-3.0-only

This project is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](LICENSE) for full terms.

