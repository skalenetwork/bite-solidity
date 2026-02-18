#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

$(./scripts/to_solidity_0.6.0.sh)

rm contracts/VeryVeryVeryLegacyBITE.sol
rm contracts/types.sol

git checkout -- contracts/VeryVeryVeryVeryLegacyBITE.sol
