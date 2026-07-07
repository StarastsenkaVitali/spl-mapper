# SPL Mapper

A browser-based tool that correlates a mainframe **assembler listing** with a runtime **trace**, producing a line-by-line mapping between machine addresses, the assembler statements at those addresses, and the original source-code statements.

It supports SPL modules in two instruction-set flavors: **s390** and **x86**.

## Requirements

Works in **Google Chrome** or **Microsoft Edge** only. It uses the browser's File System Access API for opening and saving files, which is not available in Firefox or Safari.

No installation, server, or build step is required — the app is plain HTML, CSS, and JavaScript.

## Usage

Open `index.html` in Chrome or Edge, then:

1. **Select architecture type** — choose `s390` or `x86` from the dropdown. This must be set before opening a listing.
2. **Open Listing** — select the assembler listing file. Its addresses and statements are loaded, and the module name is auto-filled.
3. **Check the module name** in the text input, then **Open Trace** — select the trace file to build the mapping.
4. **Save Map** — save the full mapping (addresses + assembler statements + source code).
5. **Save Source Trace** — save only the matched lines of source code.

