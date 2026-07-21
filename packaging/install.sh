#!/bin/sh
set -eu

repository=${AGENVYL_REPOSITORY:-riffi/agenvyl}
requested_version=${AGENVYL_VERSION:-latest}
no_path=${AGENVYL_NO_PATH:-0}
manifest_url=${AGENVYL_MANIFEST_URL:-}

usage() {
  echo 'Usage: install.sh [--version <version>] [--no-path] [--manifest-url <url>] [--install-root <directory>]'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) requested_version=${2:?--version requires a value}; shift 2 ;;
    --no-path) no_path=1; shift ;;
    --manifest-url) manifest_url=${2:?--manifest-url requires a value}; shift 2 ;;
    --install-root) AGENVYL_INSTALL_ROOT=${2:?--install-root requires a value}; export AGENVYL_INSTALL_ROOT; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case $requested_version in *[!0-9A-Za-z._-]*) echo 'Invalid Agenvyl version.' >&2; exit 2;; esac

os=$(uname -s)
machine=$(uname -m)
case $os in Linux) platform=linux ;; Darwin) platform=darwin ;; *) echo "Unsupported operating system: $os" >&2; exit 1 ;; esac
case $machine in x86_64|amd64) architecture=x64 ;; arm64|aarch64) architecture=arm64 ;; *) echo "Unsupported architecture: $machine" >&2; exit 1 ;; esac
target=$platform-$architecture

if [ -z "$manifest_url" ]; then
  if [ "$requested_version" = latest ]; then
    manifest_url="https://github.com/$repository/releases/latest/download/agenvyl-release.txt"
  else
    manifest_url="https://github.com/$repository/releases/download/v$requested_version/agenvyl-release.txt"
  fi
fi

if [ -n "${AGENVYL_INSTALL_ROOT:-}" ]; then
  versions_root=$AGENVYL_INSTALL_ROOT
elif [ "$platform" = darwin ]; then
  versions_root="$HOME/Library/Application Support/Agenvyl/versions"
else
  versions_root="${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl/versions"
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/agenvyl-install.XXXXXX")
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT HUP INT TERM

download() {
  if command -v curl >/dev/null 2>&1; then curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error "$1" --output "$2"
  elif command -v wget >/dev/null 2>&1; then wget --https-only --quiet "$1" -O "$2"
  else echo 'Agenvyl installer requires curl or wget.' >&2; exit 1
  fi
}

index_file=$temporary/agenvyl-release.txt
download "$manifest_url" "$index_file"
[ "$(sed -n '1p' "$index_file")" = 'agenvyl-release-index-v1' ] || { echo 'Unsupported Agenvyl release index.' >&2; exit 1; }

tab=$(printf '\t')
version=
filename=
archive_format=
expected_size=
expected_sha=
archive_url=
while IFS="$tab" read -r kind first second third fourth fifth sixth; do
  case $kind in
    version) version=$first ;;
    target) if [ "$first" = "$target" ]; then filename=$second; archive_format=$third; expected_size=$fourth; expected_sha=$fifth; archive_url=$sixth; fi ;;
  esac
done < "$index_file"
[ -n "$version" ] && [ -n "$filename" ] || { echo "Release does not contain target $target." >&2; exit 1; }
case $version in *[!0-9A-Za-z._-]*) echo 'Release index contains an invalid version.' >&2; exit 1;; esac
case $filename in *[!0-9A-Za-z._-]*) echo 'Release index contains an unsafe filename.' >&2; exit 1;; esac
case $expected_size in ''|*[!0-9]*) echo 'Release index contains an invalid size.' >&2; exit 1;; esac
case $expected_sha in *[!0-9a-f]*|'') echo 'Release index contains an invalid SHA-256.' >&2; exit 1;; esac
[ "${#expected_sha}" -eq 64 ] || { echo 'Release index contains an invalid SHA-256 length.' >&2; exit 1; }
if [ "$requested_version" != latest ] && [ "$requested_version" != "$version" ]; then echo "Requested version $requested_version, index contains $version." >&2; exit 1; fi

archive=$temporary/$filename
download "$archive_url" "$archive"
actual_size=$(wc -c < "$archive" | tr -d ' ')
[ "$actual_size" = "$expected_size" ] || { echo "Archive size mismatch: expected $expected_size, got $actual_size." >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then actual_sha=$(sha256sum "$archive" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then actual_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
else echo 'Agenvyl installer requires sha256sum or shasum.' >&2; exit 1
fi
[ "$actual_sha" = "$expected_sha" ] || { echo 'Archive checksum mismatch.' >&2; exit 1; }

extracted=$temporary/extracted
mkdir -p "$extracted"
case $archive_format in
  tar.xz) tar -xJf "$archive" -C "$extracted" ;;
  zip) command -v unzip >/dev/null 2>&1 || { echo 'Agenvyl installer requires unzip.' >&2; exit 1; }; unzip -q "$archive" -d "$extracted" ;;
  *) echo "Unsupported archive format: $archive_format" >&2; exit 1 ;;
esac
set -- "$extracted"/*
[ "$#" -eq 1 ] && [ -d "$1" ] || { echo 'Unexpected Agenvyl archive layout.' >&2; exit 1; }
bundle=$1
[ -f "$bundle/manifest.json" ] && [ -x "$bundle/bin/agenvyl" ] || { echo 'Agenvyl archive is incomplete.' >&2; exit 1; }

mkdir -p "$versions_root"
destination=$versions_root/$version
staged=$versions_root/.agenvyl-$version-new-$$
previous=$versions_root/.agenvyl-$version-previous-$$
old_bundle=
command_path=${AGENVYL_USER_BIN_DIR:-$HOME/.local/bin}/agenvyl
if [ -f "$command_path" ]; then old_bundle=$(sed -n 's/^# Agenvyl bundle: //p' "$command_path" | sed -n '1p'); fi
mv "$bundle" "$staged"
if [ -e "$destination" ]; then mv "$destination" "$previous"; fi
mv "$staged" "$destination"

path_policy=user
[ "$no_path" = 1 ] && path_policy=none
if ! "$destination/bin/agenvyl" init --locale en --shortcuts recommended --path "$path_policy"; then
  rm -rf "$destination"
  if [ -e "$previous" ]; then mv "$previous" "$destination"; fi
  echo 'Agenvyl initialization failed; the previous installation was restored.' >&2
  exit 1
fi
rm -rf "$previous"

is_owned_version() {
  candidate=$1
  case $candidate in "$versions_root"/*) [ -f "$candidate/manifest.json" ] ;; *) return 1 ;; esac
}
if [ "$path_policy" = user ] && [ -n "$old_bundle" ] && [ "$old_bundle" != "$destination" ] && is_owned_version "$old_bundle"; then rm -rf "$old_bundle"; fi

echo "Agenvyl $version installed at $destination"
if [ "$path_policy" = user ] && ! command -v agenvyl >/dev/null 2>&1; then
  echo "The command shim is at $command_path. Add $(dirname "$command_path") to PATH if your shell does not already include it."
fi
