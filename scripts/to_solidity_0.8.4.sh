#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

$(./scripts/to_solidity_0.8.5.sh)

rm contracts/LegacyBITE.sol
