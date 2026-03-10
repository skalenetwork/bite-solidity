#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

$(./scripts/to_solidity_0.8.4.sh)

rm contracts/VeryLegacyBITE.sol
rm contracts/errors.sol
