#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

rm -r contracts/test

sed -i '/^\s*error /! s/IncorrectReturnDataLength(.*)/"&"/' contracts/BITE.sol
sed -i 's/PrecompiledCallFailed(precompiledContract)/"PrecompiledCallFailed(precompiledContract)"/g' contracts/BITE.sol

sed -i 's/@skalenetwork/bite-solidity/@skalenetwork/bite-solidity-0.8.5/g' package.json
