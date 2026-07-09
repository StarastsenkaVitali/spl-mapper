#!/usr/bin/env node
/*
 * SPL Mapper — end-to-end parse test.
 *
 * Runs the REAL parsing logic from ../script.js against a listing + trace pair
 * and compares the produced full map and source-lines output against expected
 * example files.
 *
 * script.js is a browser file (it touches the DOM and the File System Access
 * API at load time), so we load it inside a Node `vm` sandbox with stubbed
 * browser globals. That lets its function declarations (getStatments390,
 * getStatments86, getCommands, ...) run unmodified. The small trace→mapping
 * join is inlined inside script.js's `.open_trace` click handler and cannot be
 * called directly, so it is mirrored here (see buildMapping) — keep it in sync
 * with script.js if that handler changes.
 *
 * Usage:
 *   node tests/run-tests.js [--arch s390|x86] [--module NAME] [--normalize-eol] \
 *       <listing> <trace> <expected-full-map> <expected-source-lines>
 *
 * Files (positional, in order):
 *   1. listing               assembler listing file
 *   2. trace                 runtime trace file
 *   3. expected full map     reference output of "Save Map"
 *   4. expected source lines reference output of "Save Source Trace"
 *
 * Options:
 *   --arch <s390|x86>   instruction set of the listing (default: s390)
 *   --module <NAME>     module name used to parse the trace
 *                       (default: module name auto-detected from the listing)
 *   --normalize-eol     compare with CRLF/CR normalized to LF (use when the
 *                       expected files were saved with Windows line endings)
 *
 * Exit code: 0 if all comparisons pass, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------------------ *
 * Argument parsing
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const opts = { arch: 's390', module: undefined, normalizeEol: false, verbose: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arch') opts.arch = argv[++i];
    else if (a === '--module') opts.module = argv[++i];
    else if (a === '--normalize-eol') opts.normalizeEol = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) fail(`Unknown option: ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

function fail(msg) {
  console.error(`Error: ${msg}\n`);
  console.error(
    'Usage: node tests/run-tests.js [--arch s390|x86] [--module NAME] [--normalize-eol]\n' +
    '       <listing> <trace> <expected-full-map> <expected-source-lines>');
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Load script.js in a DOM-stubbed sandbox and return its functions
 * ------------------------------------------------------------------ */
function loadScript(scriptPath, verbose) {
  // A universal fake DOM node: every property access / method call is a
  // harmless no-op, and querySelector-family calls return another fake node.
  const makeNode = () => ({
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeNode(); },
    querySelectorAll() { return []; },
    click() {},
  });

  const documentStub = {
    querySelector() { return makeNode(); },
    querySelectorAll() { return []; },
    getElementById() { return makeNode(); },
    createElement() { return makeNode(); },
    addEventListener() {},
    body: makeNode(),
  };

  // `window` intentionally lacks showOpenFilePicker/showSaveFilePicker so
  // script.js's `supportsFSA` resolves false at load — harmless here.
  // script.js is chatty (debug console.log in the parsers). Mute it by default
  // so the harness output stays readable; --verbose restores it.
  const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

  const sandbox = {
    console: verbose ? console : quietConsole,
    document: documentStub,
    window: {},
    setTimeout,
    clearTimeout,
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
  };
  sandbox.globalThis = sandbox;

  const code = fs.readFileSync(scriptPath, 'utf8');
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: scriptPath });

  const required = ['getStatments390', 'getStatments86', 'getCommands'];
  for (const name of required) {
    if (typeof sandbox[name] !== 'function') {
      fail(`script.js did not expose ${name}() — did the source change?`);
    }
  }
  return sandbox;
}

/* ------------------------------------------------------------------ *
 * Mirror of script.js's `.open_trace` join (script.js: build of `mapping`)
 * ------------------------------------------------------------------ */
function buildMapping(statements, commands) {
  const stmts = [];
  const mapping = commands.map((cmd) => {
    const stmt = statements.sourceStatements.find((st) => st.addr === cmd.addr);
    if (stmt) stmts.push(stmt.cmd);
    return stmt ? (`${'='.repeat(128)}\n${stmt.cmd}${cmd.cmd}`) : cmd.cmd;
  }).join('');
  return { mapping, sourceLines: stmts.join('') };
}

/* ------------------------------------------------------------------ *
 * Comparison + diff reporting
 * ------------------------------------------------------------------ */
function normalize(s, on) {
  return on ? s.replace(/\r\n?/g, '\n') : s;
}

function firstDiff(expected, actual) {
  const n = Math.min(expected.length, actual.length);
  let i = 0;
  while (i < n && expected[i] === actual[i]) i++;
  if (i === n && expected.length === actual.length) return null; // equal

  // Line/column of the divergence.
  let line = 1;
  for (let j = 0; j < i; j++) if (expected[j] === '\n') line++;
  const lineOf = (s) => {
    const start = s.lastIndexOf('\n', i - 1) + 1;
    let end = s.indexOf('\n', i);
    if (end === -1) end = s.length;
    return s.slice(start, end);
  };
  return {
    index: i,
    line,
    expLine: i <= expected.length ? lineOf(expected) : '<end of file>',
    actLine: i <= actual.length ? lineOf(actual) : '<end of file>',
    expLen: expected.length,
    actLen: actual.length,
  };
}

function compare(label, actual, expected, normalizeEol) {
  const a = normalize(actual, normalizeEol);
  const e = normalize(expected, normalizeEol);
  const diff = firstDiff(e, a);
  if (!diff) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  console.log(`  FAIL  ${label}`);
  console.log(`        lengths: expected ${diff.expLen}, actual ${diff.actLen}`);
  console.log(`        first difference at line ${diff.line} (char offset ${diff.index})`);
  console.log(`        expected: ${JSON.stringify(diff.expLine)}`);
  console.log(`        actual:   ${JSON.stringify(diff.actLine)}`);
  return false;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    fail('showing usage');
  }
  if (opts.files.length !== 4) {
    fail(`expected 4 file arguments, got ${opts.files.length}`);
  }
  if (opts.arch !== 's390' && opts.arch !== 'x86') {
    fail(`--arch must be s390 or x86, got "${opts.arch}"`);
  }

  const [listingPath, tracePath, expectedMapPath, expectedSrcPath] = opts.files;
  for (const p of opts.files) {
    if (!fs.existsSync(p)) fail(`file not found: ${p}`);
  }

  const script = loadScript(path.join(__dirname, '..', 'script.js'), opts.verbose);

  // Read as UTF-8 so an invalid column-1 control byte becomes U+FFFD ('�'),
  // exactly as the browser's File.text() produces it — the parsers depend on
  // that sentinel (see parseSourceLine in script.js).
  const listingText = fs.readFileSync(listingPath, 'utf8');
  const traceText = fs.readFileSync(tracePath, 'utf8');
  const expectedMap = fs.readFileSync(expectedMapPath, 'utf8');
  const expectedSrc = fs.readFileSync(expectedSrcPath, 'utf8');

  const statements = opts.arch === 's390'
    ? script.getStatments390(listingText)
    : script.getStatments86(listingText);

  const moduleName = opts.module || statements.moduleName;
  if (!moduleName) fail('could not determine module name; pass --module NAME');

  const commands = script.getCommands(traceText, moduleName);
  const { mapping, sourceLines } = buildMapping(statements, commands);

  console.log('SPL Mapper test');
  console.log(`  arch:    ${opts.arch}`);
  console.log(`  module:  ${moduleName}`);
  console.log(`  listing: ${listingPath}`);
  console.log(`  trace:   ${tracePath}`);
  console.log(`  parsed:  ${statements.listingStatements.length} addresses, ` +
    `${statements.sourceStatements.length} statements, ${commands.length} trace commands`);
  console.log('');

  let passed = 0;
  if (compare('Full map', mapping, expectedMap, opts.normalizeEol)) passed++;
  if (compare('Source lines', sourceLines, expectedSrc, opts.normalizeEol)) passed++;

  console.log('');
  console.log(`Result: ${passed}/2 passed`);
  process.exit(passed === 2 ? 0 : 1);
}

main();
