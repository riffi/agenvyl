#!/bin/sh
set -eu
bundle_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s' 'This will permanently delete Agenvyl and all user data. Continue? [y/N] '
read -r answer
case "$answer" in y|Y|yes|YES) exec "$bundle_root/bin/agenvyl" uninstall --purge --yes;; *) exit 0;; esac
