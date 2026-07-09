#!/usr/bin/env bash
#
# Unpack the password-protected tests/samples.zip into tests/samples/.
#
# The real sample listings/traces are kept out of the public repo: only the
# encrypted samples.zip is committed. This script decrypts it before the tests
# run.
#
# Password resolution (first hit wins):
#   1. $ZIP_PASS environment variable      (used in CI)
#   2. ZIP_PASS=... in ../.env (repo root)  (used locally)
#   3. ZIP_PASS=... in ./.env  (tests/)
#
# The archive must contain the `samples/` directory at its top level, e.g.
# created from within tests/ with:
#   7z a -p'SECRET' -mem=AES256 samples.zip samples
# (traditional ZipCrypto via `zip -e` also works).
#
# Exit status: 0 on success, 2 on any setup/extraction error.

set -uo pipefail

cd "$(dirname "$0")" || exit 2   # tests/

ZIP="samples.zip"

if [[ ! -f "$ZIP" ]]; then
  echo "Error: $ZIP not found in $(pwd)" >&2
  exit 2
fi

# --- Resolve the password ------------------------------------------------
read_env_pass() {
  # Extract ZIP_PASS from a dotenv file: strips an optional `export`, surrounding
  # quotes, and a trailing CR (Windows-edited .env files).
  local file="$1" line
  [[ -f "$file" ]] || return 1
  line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?ZIP_PASS[[:space:]]*=' "$file" | tail -n1) || return 1
  [[ -n "$line" ]] || return 1
  line=${line#*=}
  line=${line%$'\r'}
  # Strip matching surrounding quotes.
  if [[ $line == \"*\" ]]; then line=${line#\"}; line=${line%\"}; fi
  if [[ $line == \'*\' ]]; then line=${line#\'}; line=${line%\'}; fi
  printf '%s' "$line"
}

pass="${ZIP_PASS:-}"

if [[ -z "$pass" ]]; then
  for env_file in "../.env" ".env"; do
    if pass=$(read_env_pass "$env_file"); then
      [[ -n "$pass" ]] && break
    fi
  done
fi

if [[ -z "$pass" ]]; then
  echo "Error: no password found. Set ZIP_PASS or add ZIP_PASS=... to .env" >&2
  exit 2
fi

# --- Extract -------------------------------------------------------------
# Remove any previous extraction so stale files can't hide a failure.
rm -rf samples

if command -v 7z >/dev/null 2>&1; then
  7z x -p"$pass" -y -o. "$ZIP" >/dev/null || { echo "Error: 7z extraction failed (wrong password?)" >&2; exit 2; }
elif command -v 7za >/dev/null 2>&1; then
  7za x -p"$pass" -y -o. "$ZIP" >/dev/null || { echo "Error: 7za extraction failed (wrong password?)" >&2; exit 2; }
elif command -v unzip >/dev/null 2>&1; then
  # unzip only supports traditional ZipCrypto, not AES.
  unzip -q -o -P "$pass" "$ZIP" -d . || { echo "Error: unzip failed (wrong password, or AES archive needs 7z)" >&2; exit 2; }
else
  echo "Error: need 7z, 7za, or unzip to extract $ZIP" >&2
  exit 2
fi

if [[ ! -d samples ]]; then
  echo "Error: $ZIP did not contain a top-level samples/ directory" >&2
  exit 2
fi

echo "Extracted $ZIP -> $(pwd)/samples"
