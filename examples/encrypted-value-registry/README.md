<!-- cspell:words ciphertext ECIES -->


# Encrypted Value Registry

> **Disclaimer:** This example is **not** production-ready. It is provided for educational and demonstration purposes only.

## Overview

This example demonstrates a contract that stores a confidential `uint256` value on-chain and lets the owner selectively grant read access to specific accounts — without the owner ever being able to view the value themselves, and without the access list being publicly readable.

It exercises three core BITE 2 features together:

- **Threshold Encryption (TE):** The value is encrypted at construction time with the network's threshold key. No single party can decrypt it.
- **Conditional Transaction (CTX):** When access is granted, a CTX is submitted. The BITE network decrypts the TE-encrypted value off-chain and calls back `onDecrypt`.
- **ECIES:** Inside the callback, the decrypted value is immediately re-encrypted with the viewer's secp256k1 public key, so only they can read it.

## How it works

### 1. Deployment

The deployer deploys the contract (no constructor arguments). The secret value is then set by calling `setValue` in a separate **encrypted transaction** via the `@skalenetwork/bite` library. This ensures the plaintext value is never exposed on-chain — the BITE node receives and processes the encrypted transaction before any state is written.

### 2. Granting access

Only the contract owner can call `grantAccess`. It takes the viewer's secp256k1 public key (`PublicKey { x, y }`) and requires enough ETH to cover the BITE callback gas. Internally:

1. A CTX is submitted with the TE-encrypted value as the encrypted argument and the viewer's public key as the plaintext argument.
2. The `ctxSender` address returned by `submitCTX` is whitelisted so it can later call `onDecrypt`.
3. The provided ETH is forwarded to `ctxSender` to fund the callback.

### 3. Callback

When the BITE network finishes decryption, it calls `onDecrypt` from `ctxSender`:

1. The decrypted `uint256` is ABI-decoded from `decryptedArgs[0]`.
2. The viewer's public key is ABI-decoded from `plaintextArgs[0]`.
3. The value is re-encrypted with `BITE.encryptECIES` using the viewer's public key.
4. The result is stored in `_accessList[viewer address]`.

The viewer's address in the access list is derived deterministically from their public key (`keccak256(x || y)`), not from a transaction sender — so the mapping is not trivially linkable on-chain.

### 4. Reading the value

The viewer calls `getEncryptedValue()`, which returns the bytes stored for `msg.sender`. The viewer decrypts this ECIES ciphertext off-chain using their private key.

## Contract interface

| Function | Visibility | Description |
|---|---|---|
| `constructor()` | — | Sets the deployer as owner |
| `setValue(uint256 _value)` | `onlyOwner` | Encrypts `_value` with TE and stores it — must be called as an encrypted transaction for full confidentiality |
| `grantAccess(PublicKey publicKey)` | `payable onlyOwner` | Submits a CTX to re-encrypt the value for the given viewer |
| `onDecrypt(bytes[] decryptedArgs, bytes[] plaintextArgs)` | external | BITE callback — stores the ECIES-encrypted value for the viewer |
| `getEncryptedValue()` | view | Returns the ECIES-encrypted value stored for `msg.sender` |

## Scripts

Both scripts import shared helpers (`decrypt`, `privateKeyToPublicKey`, `PublicKey`) from `examples/scripts/utils.ts` to avoid duplication across examples.

### `hardhatRunner.ts` — Hardhat integrated, end-to-end

This script is intended to be run inside a **Hardhat v2 project** with a configured network and signer. It uses `ethers` from `hardhat` and the `@skalenetwork/bite` library and handles the full lifecycle: deploy → set value (encrypted) → grant access (encrypted) → poll for the BITE callback → decrypt → verify.

**Environment variables**

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | yes | — | Deployer and default viewer private key |
| `ENDPOINT` | yes | — | endpoint URL used to get public TE key from SKALE Network |
| `ECIES_PRIVATE_KEY` | no | same as `PRIVATE_KEY` | Use a different private key for the viewer |
| `INITIAL_VALUE` | no | `1337` | The secret `uint256` to store |

**Run**

```bash
PRIVATE_KEY=0x... ENDPOINT=https://... yarn hardhat run scripts/hardhatRunner.ts --network custom
```

**What it does**

1. Deploys `EncryptedValueRegistry` (no constructor arguments).
2. Sends `setValue(INITIAL_VALUE)` as an **encrypted transaction** via `bite.encryptTransaction()`.
3. Derives the viewer's public key from `ECIES_PRIVATE_KEY` (or `PRIVATE_KEY`).
4. Queries `minCallbackGas` and the current gas price to calculate the required ETH for the callback.
5. Sends `grantAccess` as an **encrypted transaction** via `bite.encryptTransaction()`.
6. Polls `getEncryptedValue` every 2 seconds (up to 120 seconds) until the BITE callback lands.
7. Decrypts the ECIES ciphertext using the viewer's private key.
8. Asserts that the decoded value matches `INITIAL_VALUE`.

---

### `runner.ts` — Standalone ethers.js

This script uses **ethers.js** and the `@skalenetwork/bite` library (no Hardhat dependency). It is aimed at interacting with an **already-deployed** contract. It loads configuration from environment variables via `dotenv`.

**Environment variables**

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | yes | — | Deployer/owner private key |
| `ENDPOINT` | recommended | `https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox` | RPC endpoint used both for chain access and BITE transaction encryption |
| `CONTRACT_ADDRESS` | yes | — | Address of a deployed `EncryptedValueRegistry` |

You can provide them either in your shell, in a local `.env` file, or hardcode them in the script.

**Run**

```bash
PRIVATE_KEY=0x... ENDPOINT=https://... CONTRACT_ADDRESS=0x... npx ts-node scripts/runner.ts
```

or with a `.env` file or with hardcoded values simply:

```bash
npx ts-node scripts/runner.ts
```

**What it does**

1. Derives the wallet's own public key from `PRIVATE_KEY`.
2. Sends `grantAccess` as an **encrypted transaction** via `bite.encryptTransaction()` (i.e., grants the deployer access to their own value).
3. Polls `getEncryptedValue` every 2 seconds (up to 30 seconds) until the BITE callback lands and the ECIES ciphertext is available.
4. Decrypts the ECIES ciphertext and prints the decoded `uint256`.

> **Note:** The caller must be the contract owner because only the owner can add new viewers, or the `onlyOwner` check in `grantAccess` will revert. For this example we use the owner as the viewer, but another address/account could be used. Contract allows infinite viewers.
