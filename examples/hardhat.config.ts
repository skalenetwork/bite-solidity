import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@typechain/hardhat";
import "hardhat-dependency-compiler";
import dotenv from "dotenv"


dotenv.config({ quiet: true });

const config: HardhatUserConfig = {
    networks: {
        hardhat: {
            gasPrice: 1_000_000, // 0.001 gwei (legacy tx default)
            initialBaseFeePerGas: 1_000_000, // for EIP-1559 starting base fee
        },
        custom: {
            url: process.env.ENDPOINT || "http://localhost:8545",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        }
    },
    solidity: {
        version: "0.8.30",
        settings: {
            evmVersion: "istanbul",
            optimizer: {
                enabled: true,
                runs: 200,
            },
        }
    },
    dependencyCompiler: {
        paths: [
            "@skalenetwork/bite-solidity/contracts/BITE.sol",
            "@skalenetwork/bite-solidity/contracts/test/BiteMock.sol",
            "@skalenetwork/bite-solidity/contracts/test/EncryptECIESMock.sol",
            "@skalenetwork/bite-solidity/contracts/test/EncryptTEMock.sol",
            "@skalenetwork/bite-solidity/contracts/test/SubmitCTXMock.sol",
        ],
        keep: true,
    }
};

export default config;
