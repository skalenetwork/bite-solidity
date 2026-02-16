import { HardhatUserConfig } from "hardhat/config";

const COMPILER_VERSION = process.env.SOLC_VERSION || "0.8.33";

console.log(`Using Solidity version: ${COMPILER_VERSION}`);

const config: HardhatUserConfig = {
  solidity: COMPILER_VERSION,
};

export default config;
