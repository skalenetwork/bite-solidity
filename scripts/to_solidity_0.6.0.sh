#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

$(./scripts/to_solidity_0.8.0.sh)

rm contracts/VeryVeryLegacyBITE.sol
rm contracts/interfaces/IBiteSupplicant.sol
