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
        custom: {
            url: process.env.ENDPOINT || "http://localhost:8545",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        }
    },
    solidity: {
        version: "0.8.33",
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
        ],
        keep: true,
    }
};

export default config;
