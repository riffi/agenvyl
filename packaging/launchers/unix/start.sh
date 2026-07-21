#!/bin/sh
set -eu
bundle_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$bundle_root/bin/agenvyl" start

if [ "${AGENVYL_NO_OPEN_BROWSER:-0}" != "1" ]; then
  url="http://127.0.0.1:${AGENVYL_PORT:-8791}"
  case "$(uname -s)" in
    Darwin) open "$url" >/dev/null 2>&1 & ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
      fi
      ;;
  esac
fi
