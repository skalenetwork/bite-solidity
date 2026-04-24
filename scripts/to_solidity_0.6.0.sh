#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

rm -r contracts/test
rm contracts/BITE.sol
rm contracts/Errors.sol
rm contracts/interfaces/IBiteSupplicant.sol
rm -r contracts/v0.5
