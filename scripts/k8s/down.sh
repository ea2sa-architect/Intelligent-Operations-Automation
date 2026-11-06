#!/usr/bin/env bash
# Delete the kind cluster. Database data persists in $STATE_DIR/data unless you remove it.
set -euo pipefail
kind delete cluster --name ioa
