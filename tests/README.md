# Tests

`run-tests.js` is an end-to-end parse test for SPL Mapper. It loads the real
parsing logic from `../script.js` (inside a Node `vm` sandbox with stubbed
browser globals, so no code duplication), runs it against a listing + trace
pair, and compares the results against reference output files.

## Requirements

Node.js (uses only built-in modules — `fs`, `path`, `vm`). No install step.
Extraction needs `7z`/`7za` (any encryption) or `unzip` (traditional ZipCrypto
only) on `PATH`.

## Sample fixtures

The real listings/traces are **not** committed. Only
the password-protected `tests/samples.zip` is in the repo.

`run.sh` decrypts the archive automatically (via `extract-samples.sh`) before
running. The password is read from, in order:

1. the `ZIP_PASS` environment variable (used by CI), then
2. `ZIP_PASS=...` in the repo-root `.env`.

The archive must contain `samples/` at its top level. To (re)create it from
within `tests/`:

```
7z a -p'YOUR_PASSWORD' -mem=AES256 samples.zip samples   # AES (recommended)
# or, traditional ZipCrypto:
zip -e -r samples.zip samples
```

Include everything the tests need — listings, traces, expected outputs, and any
per-case `args` files — since the whole `samples/` tree is rebuilt from the zip.

To extract manually without running the tests:

```
ZIP_PASS='YOUR_PASSWORD' bash tests/extract-samples.sh
```

## Run all sample cases

`run.sh` extracts `samples.zip`, discovers every case under `samples/`, and
prints a summary.

```
bash tests/run.sh
```

A case is a directory `samples/<arch>/<name>/` containing `1.lst`, `2.trace`,
`3.txt` (expected full map) and `4.txt` (expected source lines). `<arch>` (the
parent folder name) must be `s390` or `x86`. To add a case, drop in a new
folder (inside the zip) — no need to edit `run.sh`.

Per-case flags go in an optional `args` file inside the case directory, e.g.
`samples/s390/1/args` containing `--module PLMAP@@@`. The runner exits `0` only
if every case passes, `1` if any fails, `2` on a setup error.

## Run a single case

```
node tests/run-tests.js [--arch s390|x86] [--module NAME] [--normalize-eol] [--verbose] \
    <listing> <trace> <expected-full-map> <expected-source-lines>
```

The four positional files, in order:

1. **listing** — assembler listing file
2. **trace** — runtime trace file
3. **expected full map** — a reference "Save Map" output
4. **expected source lines** — a reference "Save Source Trace" output

The tool parses files 1 and 2, builds the mapping, and checks it against
files 3 and 4.

### Options

| Option            | Description                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `--arch`          | Instruction set of the listing: `s390` (default) or `x86`.         |
| `--module NAME`   | Module name for the trace parse. Defaults to the name auto-detected from the listing. |
| `--normalize-eol` | Compare with `CRLF`/`CR` normalized to `LF`. Use when the expected files were saved with Windows line endings. |
| `--verbose`       | Show `script.js`'s internal parser debug logging (muted by default). |

### Exit code

`0` if both comparisons pass, `1` otherwise. On failure it prints the line
number, character offset, and the differing expected/actual lines.

## Example

```
node tests/run-tests.js --arch s390 samples/1.lst samples/2.trace samples/3.full.txt samples/4.cmds.txt
```

## Continuous integration

`.github/workflows/tests.yml` runs `tests/run.sh` on every push to `main`
(including branch/PR merges into `main`). The archive password is supplied to
the job as the `ZIP_PASS` environment variable, sourced from a repository
secret of the same name.

Set it once under **Settings → Secrets and variables → Actions → New repository
secret**, name `ZIP_PASS`, value = the `samples.zip` password.

## Note on the mapping join

The trace→mapping join is inlined inside `script.js`'s `.open_trace` click
handler and cannot be called directly, so it is mirrored in `buildMapping()`
in `run-tests.js`. If that handler changes, update `buildMapping()` to match.
