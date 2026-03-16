<!-- cspell:words ECIES -->

# Examples

This folder contains standalone usage examples for `bite-solidity`. Each subdirectory is a self-contained project demonstrating a specific set of BITE 2 features.

> **Disclaimer:** Code in this `examples/` directory is **not** production-ready and is provided for educational and demonstration purposes only.

## BITE integration flow

BITE 2 blockchains expose three precompiled contracts for confidential computation:

| Precompile | Address | Description |
|---|---|---|
| `SubmitCTX` | `0x1B` | Submits a conditional transaction for threshold decryption and callback |
| `EncryptECIES` | `0x1C` | Encrypts data for a specific recipient public key |
| `EncryptTE` | `0x1D` | Encrypts data with the network threshold key |

## Compiler compatibility

For contracts that interact with BITE precompiles, we recommend using EVM version `istanbul` for now.

Hardhat:

```ts
export default {
	solidity: {
		version: "0.X.X",
		settings: {
			evmVersion: "istanbul"
		}
	}
};
```

Foundry (`foundry.toml`):

```toml
[profile.default]
evm_version = "istanbul"
```

## Available examples

| Example | Description | Key features |
|---|---|---|
| [Encrypted Value Registry](encrypted-value-registry/README.md) | Stores a value encrypted and reveals it to authorized accounts. Authorized viewers are hidden (encrypted). | CTX, ECIES, TE |

## Local testing with mocks

The `contracts/test/` folder in this repository contains mocks for the BITE precompiles so you can test logic locally in your repository without a live BITE 2 node.

```typescript
const BiteMock = await ethers.getContractFactory("BiteMock");
const bite = await BiteMock.deploy();

const SubmitCTXMock = await ethers.getContractFactory("SubmitCTXMock");
const submitCTXMock = await SubmitCTXMock.deploy(await bite.getAddress());

const EncryptTEMock = await ethers.getContractFactory("EncryptTEMock");
const encryptTEMock = await EncryptTEMock.deploy(await bite.getAddress());

const EncryptECIESMock = await ethers.getContractFactory("EncryptECIESMock");
const encryptECIESMock = await EncryptECIESMock.deploy(await bite.getAddress());


// NOTE: Leverage your local testing network cheat codes. This example uses hardhat node
const runtimeBytecode1 = await ethers.provider.getCode(await submitCTXMock.getAddress());
const runtimeBytecode2 = await ethers.provider.getCode(await encryptTEMock.getAddress());
const runtimeBytecode3 = await ethers.provider.getCode(await encryptECIESMock.getAddress());

await network.provider.send("hardhat_setCode", [
    "0x1B",
    runtimeBytecode1
]);

await network.provider.send("hardhat_setCode", [
    "0x1C",
    runtimeBytecode3
]);

await network.provider.send("hardhat_setCode", [
    "0x1D",
    runtimeBytecode2
]);

// Once setup ready, deploy and use contract that implements BITE.sol
const myContractFactory = await ethers.getContractFactory("MyBiteContract");
const myContract = await myContractFactory.deploy();
await myContract.waitForDeployment();

await myContract.someMethodThatUsesCTX();

// Needs to manually trigger callback stored in BiteMock.sol contract
await bite.sendCallback();
```

`BiteMock` is only for development and testing. It does not provide any real cryptographic security guarantees.

