#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

$(./scripts/to_solidity_0.6.0.sh)

rm -r contracts/v0.6
rm contracts/types.sol

git checkout -- contracts/v0.5
