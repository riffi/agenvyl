#!/bin/sh
set -eu
bundle_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$bundle_root/bin/agenvyl" "$@"
