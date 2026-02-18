#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

rm -r contracts/test
rm contracts/BITE.sol
