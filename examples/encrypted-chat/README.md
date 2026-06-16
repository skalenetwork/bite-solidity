<!-- cspell:words ciphertext ciphertexts secp256k1 -->


# Encrypted Messenger

> **Disclaimer:** This example is **not** production-ready. It is provided for educational and demonstration purposes only.

## Overview

This example demonstrates a chat-style contract that lets two participants exchange messages on-chain without storing readable plaintext. Instead of writing message contents directly to storage, the contract uses BITE callbacks to transform confidential inputs into ciphertexts that only the intended participants can decrypt off-chain.

It exercises three core BITE features together:

- **Threshold Encryption (TE):** Session secrets and message payloads are supplied to BITE as encrypted arguments, so their plaintext is not exposed in ordinary contract execution.
- **Conditional Transaction (CTX):** Session creation and message sending both submit CTXs. The BITE network decrypts the encrypted inputs off-chain and calls back `onDecrypt`.
- **ECIES:** Inside the callback, the decrypted session secret is re-encrypted for each participant's secp256k1 public key, and decrypted message contents are re-encrypted with the session public key before being stored.

*NOTE*: Users of this or similar contracts must be aware of the fact that messages submitted to the blockchain, even if encrypted, are not guaranteed lifetime secrecy. Issues like user-leaked secrets, dApps wrong doing, advancements in computing power or decryption algorithms, and possibly other external factors may compromise encrypted data.

## How it works

### 1. User registration and callback funding

Each participant first registers a long-term secp256k1 public key by calling `registerUser(PublicKey publicKey)`.

1. The contract derives an address from the public key as and stores that key in `userPublicKeys`.
2. Any ETH sent with the call is added to `userDeposits[msg.sender]`.
3. Deposits can later be used to fund BITE callbacks, so users do not need to attach ETH to every message or session operation.

Users can also send ETH directly to the contract or call `deposit()` explicitly to top up their callback balance, and they can recover unused funds via `withdraw()`.

### 2. Session creation

To open a chat session, a caller invokes:

`createSession(address user1, address user2, PublicKey sessionKey, bytes encryptedSessionKey)`

Internally:

1. The contract checks that both users have registered public keys.
2. It computes a session id as `keccak256(abi.encodePacked(user1, user2))` and requires that no session already exists for that ordered pair.
3. It submits a CTX with:
   - `encryptedSessionKey` as the encrypted argument.
   - `user1`, `user2`, `sessionKey`, and the original `encryptedSessionKey` as plaintext arguments.
4. The `ctxSender` returned by `submitCTX` is whitelisted in `_accessList` and funded with the callback gas budget.

The important idea is that the sensitive session secret is only revealed inside the BITE callback, where it is immediately re-encrypted for the two users.

### 3. Session callback

When BITE finishes processing the session-creation CTX, it calls `onDecrypt` from the authorized `ctxSender`.

The contract recognizes a session callback by the argument shape `encryptedArgs.length == 1` and `plaintextArgs.length == 4`, then:

1. Decodes `user1`, `user2`, `sessionKey`, and the original `encryptedSessionKey` from `plaintextArgs`.
2. Decodes the decrypted session secret from `encryptedArgs[0]`.
3. Re-encrypts that session secret for `user1` using `userPublicKeys[user1]`.
4. Re-encrypts the same session secret for `user2` using `userPublicKeys[user2]`.
5. Stores a `Session` record containing:
   - both participant addresses,
   - the shared `sessionKey` public key,
   - the original encrypted session key blob,
   - an individualized encrypted session key for each participant.

After this step, both users can fetch their own encrypted copy of the session secret and decrypt it locally with their private keys.

### 4. Sending a message

To send a message, a participant calls:

`sendMessage(address to, bytes encryptedContent)`

The contract requires that a session already exists for `keccak256(abi.encodePacked(msg.sender, to))`, then:

1. Packages `encryptedContent` as the encrypted argument.
2. Packages `msg.sender` and `to` as plaintext arguments.
3. Submits another CTX and funds its callback either from `msg.value` or from the sender's deposit.

The expected usage is that the message payload is provided confidentially through BITE, so the plaintext message is only handled inside the callback.

### 5. Message callback and retrieval

When BITE completes the message CTX, it calls `onDecrypt` again.

The contract recognizes a message callback by the argument shape `encryptedArgs.length == 1` and `plaintextArgs.length == 2`, then:

1. Decodes the sender and recipient from `plaintextArgs`.
2. Decodes the decrypted message bytes from `encryptedArgs[0]`.
3. Recomputes the session id.
4. Re-encrypts the message bytes with `BITE.encryptECIES` using the session's `sessionKey` public key.
5. Appends a new `Message` record with timestamp, sender, session id, and encrypted ciphertext.

Participants can then read the stored ciphertexts from `messages[messageId]` and recover the session secret from the relevant `Session` record. Off-chain, each user decrypts their individualized session key first, then uses that session key material to decrypt the stored message ciphertexts.

## Contract interface

| Function | Visibility | Description |
|---|---|---|
| `constructor()` | — | Deploys the contract |
| `receive()` | external payable | Accepts ETH and forwards it to `deposit()` |
| `registerUser(PublicKey publicKey)` | `external payable` | Registers a user's long-term public key and optionally funds their callback deposit |
| `createSession(address user1, address user2, PublicKey sessionKey, bytes encryptedSessionKey)` | `external payable` | Creates a session for an ordered user pair and submits a CTX to redistribute the session secret |
| `sendMessage(address to, bytes encryptedContent)` | `external payable` | Submits a CTX that decrypts a confidential message and stores it encrypted under the session key |
| `deposit()` | `public payable` | Adds ETH to the caller's callback funding balance |
| `withdraw()` | `external` | Withdraws the caller's unused callback deposit |
| `onDecrypt(bytes[] encryptedArgs, bytes[] plaintextArgs)` | `external` | BITE callback entrypoint for both session creation and message delivery |

## Demo UI

A minimal Next.js web app lives in `demo/` and provides a side-by-side chat interface for two server-managed demo accounts. No browser wallet is required — the server signs all transactions using private keys from `.env`.

*NOTE*: The current Demo app does not correctly handle sending too long messages, as the CTX will run out of gas. To support those, either increase the msgGas in the smart-contract (paying more for small messages even), or add the ability to send a custom amount for callback execution. Out of scope for the demo.

### Prerequisites

- Node.js >= 18
- A deployed `EncryptedMessenger` contract (use `yarn hardhat run scripts/deploy.ts --network <network>`)

### Setup

```bash
cd demo
cp .env.example .env
# Edit .env with your values
npm install
```

### Environment variables

| Variable | Description |
|---|---|
| `RPC_URL` | JSON-RPC endpoint for the target chain |
| `BITE_ENDPOINT` | BITE threshold encryption endpoint (usually the same as RPC_URL) |
| `CONTRACT_ADDRESS` | Deployed EncryptedMessenger address |
| `USER1_PRIVATE_KEY` | Private key for demo User 1 |
| `USER2_PRIVATE_KEY` | Private key for demo User 2 |

Make sure both addresses have some gas tokens to transact.

### Run

```bash
npm run dev
```

Open http://localhost:3000. The UI shows two panes with:
- User address and balances (labeled CREDITS)
- Register button (disabled once registered)
- Create Session button (enabled only when both users are registered and no session exists)
- Chat window with 3-second background polling
- Send controls per user

### Security note

This demo is **custodial by design** — the server holds both user private keys and signs transactions on their behalf. It is intended for local testing and demonstrations only.
