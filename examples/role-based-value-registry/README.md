<!-- cspell:words ciphertext ECIES -->

# Role-Based Value Registry

> **Disclaimer:** This example is **not** production-ready. It is provided for educational and demonstration purposes only.

## Overview

This example demonstrates a contract that manages confidential values on a per-role basis.

Each role has:

- a secp256k1 public key used to encrypt the role's shared confidential data,
- a role secret key encrypted with threshold encryption (TE), and
- a per-user copy of that role secret key, encrypted with ECIES so only granted users can read it.

It exercises three core BITE features together:

- **Threshold Encryption (TE):** Role secrets and new role values are submitted to the contract already encrypted with the network threshold key.
- **Conditional Transaction (CTX):** Granting a role or updating a role value triggers a CTX that decrypts the TE payload off-chain and calls back `onDecrypt`.
- **ECIES:** Inside the callback, the decrypted payload is immediately re-encrypted either for an individual user or for the role public key.

## How it works

### 1. Deployment and admin bootstrap

The constructor creates `ADMIN_ROLE` and initiates granting it to the deployer via CTX callback. To do that safely, deployment includes:

1. `adminRolePublicKey`: the public key used to encrypt values for the admin role itself,
2. `adminPublicKey`: the deployer's user public key, and
3. `encryptedAdminRoleSecret`: the admin role secret, already TE-encrypted off-chain.

During deployment the contract submits a CTX so the admin role secret can be decrypted by the BITE network and re-encrypted with ECIES for the deployer.

### 2. Creating a role

An admin can create a new role with `createRole(roleId, rolePublicKey, encryptedRoleSecret)`.

- `rolePublicKey` is the key that will be able to decrypt the confidential value shared by all members of the role.
- `encryptedRoleSecret` is a TE-encrypted secret that will later be re-encrypted for each individual user granted the role.

### 3. Granting a role

When `grantRole` is called:

1. the contract submits a CTX using the stored TE-encrypted role secret,
2. the BITE network decrypts that secret off-chain, and
3. `onDecrypt` re-encrypts it with ECIES for the target user's public key.

The user can later retrieve that encrypted role secret through `getMyEncryptedRoleSecret(roleId)` and decrypt it locally with their private key.

### 4. Publishing a value for a role

Any account that already has a role can call `encryptForRole(roleId, encryptedValue)`.

The `encryptedValue` parameter is expected to already be TE-encrypted off-chain. The contract then:

1. submits a CTX containing that TE-encrypted payload,
2. receives the decrypted bytes in `onDecrypt`, and
3. re-encrypts them with ECIES using the role public key.

The resulting ciphertext is stored in `encryptedValue` for that role and can be fetched with `getValueForRole(roleId)`.

## Contract interface

| Function | Visibility | Description |
|---|---|---|
| `constructor(PublicKey adminRolePublicKey, PublicKey adminPublicKey, bytes encryptedAdminRoleSecret)` | payable | Creates `ADMIN_ROLE` and starts a CTX flow to grant it to the deployer |
| `encryptForRole(bytes32 roleId, bytes encryptedValue)` | payable | Submits a CTX to decrypt a TE-encrypted value and re-encrypt it for the role public key |
| `createRole(bytes32 roleId, PublicKey rolePublicKey, bytes encryptedRoleSecret)` | payable | Creates a new role and stores its TE-encrypted role secret |
| `grantRole(bytes32 roleId, PublicKey userPublicKey)` | payable | Submits a CTX to re-encrypt the role secret for a user |
| `getValueForRole(bytes32 roleId)` | view | Returns the ECIES-encrypted role value |
| `getMyEncryptedRoleSecret(bytes32 roleId)` | view | Returns the caller's ECIES-encrypted role secret |
| `onDecrypt(bytes[] decryptedArgs, bytes[] plaintextArgs)` | external | BITE callback used for both role grants and role value updates |

## Script

The script in [scripts/deployAndTest.ts](scripts/deployAndTest.ts) imports shared helpers (`decrypt`, `privateKeyToPublicKey`) from [../scripts/utils.ts](../scripts/utils.ts) and performs a full end-to-end flow.

This is an example of how to use the contract in practice: it deploys the contract and immediately runs verification steps against real CTX/TE/ECIES interactions.

### Example flow: deploy + verify/test

Before the numbered steps, the script:

1. TE-encrypts `ADMIN_ROLE_PRIVATE_KEY` off-chain — this becomes the admin role secret stored in the contract.
2. ABI-encodes and TE-encrypts `ADMIN_ROLE_VALUE` off-chain.
3. Deploys `RoleBasedValueRegistry` with `adminRolePublicKey`, the deployer's `adminPublicKey`, and the encrypted role secret.
4. Waits briefly, then reads `getMyEncryptedRoleSecret(ADMIN_ROLE)` for the deployer, decrypts the result with the deployer's private key, and asserts it matches `ADMIN_ROLE_PRIVATE_KEY`.
5. Submits a TE-encrypted value for `ADMIN_ROLE` via `encryptForRole`, waits for `getValueForRole(ADMIN_ROLE)` to be populated, decrypts with `ADMIN_ROLE_PRIVATE_KEY`, and asserts it matches `ADMIN_ROLE_VALUE`.

### Step 1 — Create a new user and fund it

Creates a random ephemeral wallet and transfers 0.2 ETH from the deployer to cover the new user's callback fees and gas.

### Step 2 — Grant `ADMIN_ROLE` to the new user and verify

The deployer calls `grantRole(ADMIN_ROLE, newUserPublicKey)`. The script then waits briefly, reads `getMyEncryptedRoleSecret(ADMIN_ROLE)` from the new user's address, decrypts the result with the new user's private key, and asserts it matches `ADMIN_ROLE_PRIVATE_KEY`.

### Step 3 — New user creates `READER_ROLE`

Using the new user account (which now holds `ADMIN_ROLE`), the script calls `createRole(READER_ROLE, readerRolePublicKey, encryptedReaderRoleSecret)`. The reader role secret is `READER_ROLE_PRIVATE_KEY`, TE-encrypted off-chain.

### Step 4 — Grant `READER_ROLE` to the new user and verify

The new user calls `grantRole(READER_ROLE, newUserPublicKey)`. The script then waits briefly, reads `getMyEncryptedRoleSecret(READER_ROLE)`, decrypts with the new user's private key, and asserts it matches `READER_ROLE_PRIVATE_KEY`.

### Step 5 — Set a confidential value for `READER_ROLE` and verify

The new user ABI-encodes the `READER_ROLE_VALUE` string, TE-encrypts it, and calls `encryptForRole(READER_ROLE, ...)`. The script polls `getValueForRole(READER_ROLE)`, decrypts the ECIES ciphertext with `READER_ROLE_PRIVATE_KEY`, ABI-decodes the result, and asserts it matches the original string.

### Step 6 — Return remaining ETH to the deployer

The new user sends its entire remaining balance back to the deployer, reserving exactly 21 000 gas for the transfer. Uses `type: 0` (legacy transaction) to ensure the gas cost calculation is exact.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | yes | — | Deployer private key; its public key is used as `adminPublicKey` |
| `ENDPOINT` | yes | — | RPC endpoint used for both chain access and BITE off-chain encryption |
| `ADMIN_ROLE_PRIVATE_KEY` | no | generated randomly | Private key whose public key becomes the admin role key pair; used to verify decryption of the admin role secret |
| `READER_ROLE_PRIVATE_KEY` | no | generated randomly | Private key whose public key becomes the reader role key pair; used to verify decryption of the reader role secret and value |
| `ADMIN_ROLE_VALUE` | no | `admin confidential value` | Plaintext value published for `ADMIN_ROLE` |
| `READER_ROLE_VALUE` | no | `reader confidential value` | Plaintext value published for `READER_ROLE` |

### Run

```bash
PRIVATE_KEY=0x... ENDPOINT=https://... yarn hardhat run scripts/deployAndTest.ts --network custom
```

> **Note:** If `ADMIN_ROLE_PRIVATE_KEY` or `READER_ROLE_PRIVATE_KEY` are omitted, the script generates new keypairs automatically and logs that they were generated.
