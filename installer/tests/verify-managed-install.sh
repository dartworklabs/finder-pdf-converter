#!/bin/bash
# Run outcome contracts against the actual managed backend in isolated homes.
set -eu
here=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd)
exec /usr/bin/python3 "$here/verify-managed-contract.py" "${1:-all}"
