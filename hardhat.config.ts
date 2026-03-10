import { HardhatUserConfig } from "hardhat/config";
import { SolidityUserConfig } from "hardhat/types";

const COMPILER_VERSION = process.env.SOLC_VERSION || "0.8.33";

const getSolidityConfig = (): SolidityUserConfig => {
  if (process.env.SOLC_VERSION) {
    return process.env.SOLC_VERSION;
  } else {
    return {
      compilers: [
        {
          version: '0.8.33'
        },
        {
          version: '0.5.17'
        }
      ]
    };
  }
}

const config: HardhatUserConfig = {
  solidity: getSolidityConfig(),
};

export default config;
