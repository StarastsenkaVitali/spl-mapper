#!/usr/bin/env bash
#
# Run every SPL Mapper sample test under tests/samples/ and print a summary.
#
# A test case is a directory  samples/<arch>/<name>/  containing:
#   1.lst    listing              3.txt   expected full map
#   2.trace  trace                4.txt   expected source lines
# <arch> (the parent folder name) must be "s390" or "x86" and is passed to
# run-tests.js. An optional "args" file in the case directory supplies extra
# flags verbatim, e.g.  --module PLMAP@@@  or  --normalize-eol
#
# Runs from any working directory. Exit status is 0 only if every case passes,
# 1 if any case fails, 2 on a setup error (no node, no cases).

set -uo pipefail

cd "$(dirname "$0")" || exit 2

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not on PATH" >&2
  exit 2
fi

if [[ ! -f run-tests.js ]]; then
  echo "Error: run-tests.js not found next to run.sh" >&2
  exit 2
fi

# Decrypt the sample files (only the encrypted samples.zip is committed).
if [[ -f samples.zip ]]; then
  bash extract-samples.sh || exit $?
fi

shopt -s nullglob

pass=0
fail=0
total=0
failed_cases=()

for dir in samples/*/*/; do
  dir=${dir%/}
  arch=$(basename "$(dirname "$dir")")
  name=$(basename "$dir")
  label="$arch/$name"

  # Skip anything that isn't a complete case.
  incomplete=0
  for f in 1.lst 2.trace 3.txt 4.txt; do
    if [[ ! -f "$dir/$f" ]]; then
      echo "SKIP  $label  (missing $f)"
      incomplete=1
      break
    fi
  done
  [[ $incomplete -eq 1 ]] && continue

  # Optional per-case extra flags (e.g. --module NAME).
  extra=()
  if [[ -f "$dir/args" ]]; then
    # Word-split the file into individual flags.
    read -r -a extra < "$dir/args"
  fi

  total=$((total + 1))
  echo "=== $label (arch: $arch) ==="
  if node run-tests.js --arch "$arch" "${extra[@]+"${extra[@]}"}" \
      "$dir/1.lst" "$dir/2.trace" "$dir/3.txt" "$dir/4.txt"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failed_cases+=("$label")
  fi
  echo
done

echo "================================================================"
if [[ $total -eq 0 ]]; then
  echo "No test cases found under samples/" >&2
  exit 2
fi
echo "Cases: $total   Passed: $pass   Failed: $fail"
if [[ $fail -gt 0 ]]; then
  printf 'Failed cases: %s\n' "${failed_cases[*]}"
  exit 1
fi
exit 0
