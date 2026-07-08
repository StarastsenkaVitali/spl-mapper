// Handle of the last file touched; used as `startIn` so the pickers reopen
// in the same folder the user last worked in.
let lastHandle = undefined;

// The File System Access API (showOpenFilePicker/showSaveFilePicker) only
// exists in Chromium browsers. Detect once so we can fall back gracefully.
const supportsFSA = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

// Read a picked File as text. Uses UTF-8 (File.text()) deliberately: the
// listing parsers depend on the column-1 control byte being turned into the
// '�' replacement character (see the sentinel check in parseSourceLine),
// which only happens under UTF-8 decoding. Do not swap the decoder without
// making that strip encoding-independent and verifying against real samples.
const readFileText = async (file) => file.text();

// Fallback open for non-Chromium browsers: classic <input type="file">.
const openFileFallback = () => new Promise((resolve, reject) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.addEventListener('change', () => {
    if (input.files[0]) resolve(input.files[0]);
    else reject(Object.assign(new Error('No file selected'), { name: 'AbortError' }));
  });
  // If the dialog is dismissed no 'change' fires; nothing to resolve, which
  // is fine — the user simply gets no further action.
  input.click();
});

const openFile = async () => {
  if (!supportsFSA) return openFileFallback();
  const [handle] = await window.showOpenFilePicker({
    startIn: lastHandle,
    types: [{
      description: 'Listing / Trace',
      accept: { 'text/plain': ['.txt', '.lst', '.list', '.trc', '.trace'] },
    }],
  });
  lastHandle = handle;
  return handle.getFile();
};

// Fallback save for non-Chromium browsers: trigger an anchor download.
const saveFileFallback = (blob, type) => {
  const name = `mapping.${type}.txt`;
  const url = URL.createObjectURL(new Blob([blob], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  // We cannot know the final path the browser chose, so report the name.
  return { name };
};

const saveFile = async (blob, type) => {
  if (!supportsFSA) return saveFileFallback(blob, type);
  try {
    const handle = await window.showSaveFilePicker({
      startIn: lastHandle,
      types: [{
        description: 'Mapping',
        accept: {
          'text/map': [`.${type}.txt`],
        },
      }],
    });

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle;
  } catch (err) {
    // User cancelling the save dialog is a benign no-op.
    if (err.name === 'AbortError') return undefined;
    throw err;
  }
};
let data = '';

function parseSourceLine(line) {
  const cmd = line[0] === '�' ? line.substr(1) : line;
  return {
    num: parseInt(cmd.substr(0, 6)),
    stmt: parseInt(cmd.substr(15, 6)),
    cmd: cmd + '\n'
  }
}

function getStatments390(text) {
  console.log("Reading s390 listing")
  const pages = text.split('SOURCE STATEMENT');
  const pagesTranListing = pages.slice(1);
  const moduleName = pagesTranListing[0].split('\n')[2].split(/\s+/)[3];
  const statementsLines = pagesTranListing.join('').split('\n').filter((s) => s.indexOf(' S_') > 0)
  const listingStatements = statementsLines.map(stmt => {
    const addr = parseInt('0x' + stmt.substr(2, 7))
    return {
      addr: addr ? addr : -1,
      stmt: parseInt(stmt.substr(55, 7).trim())
    }
  }).filter(stmt => stmt.addr !== -1)
  const pagesSourceListing = pages[0].split('****  SOURCE  LISTING  ****').slice(1);
  pagesSourceListing[pagesSourceListing.length - 1] = pagesSourceListing[pagesSourceListing.length - 1].split('****  XREF &ATTR &MAP  ****')[0]
  const sourceLines = pagesSourceListing.join('').split('\n')
  const sourceStatements = [];
  let stCount = 0;
  sourceLines.map((line) => {
    return parseSourceLine(line)
  }).forEach(pline => {
    if (pline.stmt && pline.num) {
      stCount++;
      const ls = listingStatements.find(el => el.stmt === pline.stmt)
      sourceStatements.push({ ...pline, addr: ls ? ls.addr : 'none' })
    }
    else if (pline.num && stCount) sourceStatements[stCount - 1].cmd += pline.cmd
  });
  return { moduleName: moduleName, sourceStatements: sourceStatements, listingStatements: listingStatements }
}

function extractStatmentsAddresses(listingLines) {
  const result = []
  for (let i = 1; i < listingLines.length; i++) {
    const line = listingLines[i];
    const match = line.match(/S_(\d+)/);
    if (match) {
      const statementNumber = parseInt(match[1], 10);
      const nextLine = listingLines[i + 1];
      // Extract first 10 characters from previous line, trim spaces
      const addr = nextLine.slice(0, 10).trim();
      if (addr) {
        result.push({ addr: parseInt('0x' + addr), stmt: statementNumber });
      }
    }
  }
  return result
}

function getStatments86(text) {
  console.log("Reading x86 listing")
  const pages = text.split('SOURCE STATEMENT');
  const pagesTranListing = pages.slice(1);
  const moduleName = pagesTranListing[0].split('\n')[2].split(/\s+/)[3];
  const statementsLines = pagesTranListing.join('').split('\n').filter((s) => s.indexOf(' S_') > 0 || parseInt('0x' + s.substr(2, 7)))

  console.log("Statments Lines:", statementsLines)
  const listingStatements = extractStatmentsAddresses(statementsLines)
  console.log("Statments Addresses:", listingStatements)
  const pagesSourceListing = pages[0].split('****  SOURCE  LISTING  ****').slice(1);
  pagesSourceListing[pagesSourceListing.length - 1] = pagesSourceListing[pagesSourceListing.length - 1].split('****  XREF &ATTR &MAP  ****')[0]
  const sourceLines = pagesSourceListing.join('').split('\n')
  const sourceStatements = [];
  let stCount = 0;
  sourceLines.map((line) => {
    return parseSourceLine(line)
  }).forEach(pline => {
    if (pline.stmt && pline.num) {
      stCount++;
      const ls = listingStatements.find(el => el.stmt === pline.stmt)
      sourceStatements.push({ ...pline, addr: ls ? ls.addr : 'none' })
    }
    else if (pline.num && stCount) sourceStatements[stCount - 1].cmd += pline.cmd
  });
  return { moduleName: moduleName, sourceStatements: sourceStatements, listingStatements: listingStatements }
}

function getCommands(text, moduleName) {
  const traceLines = text.split(/\r?\n/)
  const traceCommands = [];
  let cmdCounter = 0
  const addrPointer = 2 + moduleName.length
  traceLines.map((line) => {
    if (line.startsWith(moduleName, 1)) {
      cmdCounter++;
      traceCommands.push({ addr: parseInt('0x' + line.substr(addrPointer, 5)), cmd: line + '\n' })
    }
    else if (cmdCounter) traceCommands[cmdCounter - 1].cmd += line + '\n'
  })
  return traceCommands
}

let statements = [];
let commands = [];
let mapping = ''
let stmts = [];
const openListingStatus = document.querySelector('.listing_status');
const listingType = document.querySelector('.listing_type');
const openTraceStatus = document.querySelector('.trace_status');
const saveStatus = document.querySelector('.save_status');
const saveSrcStatus = document.querySelector('.save_src_status');
const modNameInput = document.querySelector('.module')
const openTraceBtn = document.querySelector('.open_trace');
const saveBtn = document.querySelector('.save');
const saveStmtsBtn = document.querySelector('.save_stmts');

/* ---- Toast popups ---- */
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info', title) {
  const defaults = { error: 'Error', success: 'Success', info: 'Notice' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconChar = { error: '⚠', success: '✔', info: 'ℹ' }[type] || 'ℹ';
  toast.innerHTML = `
    <span class="icon">${iconChar}</span>
    <div class="body">
      <div class="title"></div>
      <div class="text"></div>
    </div>
    <button class="close" aria-label="Dismiss">&times;</button>`;
  toast.querySelector('.title').textContent = title || defaults[type] || 'Notice';
  toast.querySelector('.text').textContent = message;

  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.close').addEventListener('click', dismiss);
  toastContainer.appendChild(toast);
  if (type !== 'error') setTimeout(dismiss, 4000);
  else setTimeout(dismiss, 8000);
}

/* ---- Guided step state ---- */
function setStep(n, state) {
  const step = document.querySelector(`.step[data-step="${n}"]`);
  if (!step) return;
  step.classList.remove('locked', 'done');
  if (state === 'unlocked') return;
  if (state) step.classList.add(state);
}

listingType.addEventListener('change', () => {
  if (listingType.value) {
    setStep(1, 'done');
    setStep(2, 'unlocked');
  } else {
    setStep(1, 'unlocked');
    setStep(2, 'locked');
  }
})

document.querySelector('.open_listing').addEventListener('click', async () => {
  if (!listingType.value) {
    showToast('Please choose an architecture type first.', 'error', 'Architecture required');
    return
  }
  let start = Date.now();
  await openFile().then((file) => {
    start = Date.now();
    return readFileText(file)
  }).then(text => {
    statements = listingType.value == "s390" ? getStatments390(text) : getStatments86(text);
    console.log(statements);
    openListingStatus.classList.remove('red');
    openListingStatus.classList.add('green');
    openListingStatus.innerHTML = `Loaded ${statements.listingStatements.length} addresses and ${statements.sourceStatements.length} statements.`
    modNameInput.value = statements.moduleName;
    setStep(2, 'done');
    setStep(3, 'unlocked');
    openTraceBtn.disabled = false;
    showToast(`Listing loaded for module ${statements.moduleName}.`, 'success', 'Listing ready');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    openListingStatus.textContent = '';
    showToast(err.message, 'error', 'Could not read listing');
  }
  )
  const end = Date.now();
  console.log(`Execution time: ${end - start} ms`);
});
document.querySelector('.open_trace').addEventListener('click', () => {
  if (!statements.sourceStatements) {
    showToast('Please open a listing before loading a trace.', 'error', 'Listing required');
    return
  }
  openFile().then((file) => {
    return readFileText(file)
  }).then(text => {
    const start = Date.now();
    const modName = modNameInput.value
    ///const modName = statements.sourceStatements[0].cmd.replace(/[0-9]/g, '').trim().split(':')[0];
    //console.log('modName = ' + modName,document.querySelector('.module').value.startsWith(modName))
    // if(document.querySelector('.module').value.startsWith(modName.trim)) console.log('OKKKKKKKKKKKKKKKKKKKKKKK')
    // else throw new Error(`Please check module name or listing file (current listing for ${modName} module)`)
    commands = getCommands(text, modNameInput.value);

    console.log(commands)
    console.log(text.substr(0, 16).split('+')[0].trim())
    const listingModuleName = text.substr(0, 16).split('+')[0].trim();
    if (listingModuleName.startsWith(modName)) console.log(`Trace was successfully uploaded for ${listingModuleName} module`)
    // else throw new Error(`Trace and listing files have different module names (current listing for ${modName} module and trace for ${listingModuleName})`)
    stmts = []
    mapping = commands.map(
      (cmd) => {
        const stmt = statements.sourceStatements.find(st => st.addr === cmd.addr)
        if (stmt) stmts.push(stmt.cmd);
        return stmt ? (`${'='.repeat(128)}\n${stmt.cmd}${cmd.cmd}`) : cmd.cmd;
      }
    ).join('')

    //console.log('stmts ====>',stmts.join(''))
    console.log(mapping)
    const end = Date.now();
    console.log(`Execution time: ${end - start} ms`);
    const matched = stmts.length;
    openTraceStatus.classList.remove('red');
    openTraceStatus.classList.add(matched ? 'green' : 'red');
    openTraceStatus.textContent = `Mapping created — ${matched} of ${commands.length} trace commands matched a source statement.`;
    setStep(3, 'done');
    setStep(4, 'unlocked');
    saveBtn.disabled = false;
    saveStmtsBtn.disabled = false;
    if (matched) {
      showToast(`Mapping created: ${matched} commands matched.`, 'success', 'Mapping ready');
    } else {
      showToast('The trace loaded, but no command addresses matched the listing. Check the module name and architecture.', 'error', 'No matches found');
    }
  }).catch(
    (err) => {
      if (err.name === 'AbortError') return;
      openTraceStatus.textContent = '';
      showToast(err.message, 'error', 'Could not build mapping');
    }
  )
});
// Shared save flow for both save buttons.
//   blob     - text content to write
//   type     - filename discriminator ('full' | 'cmds')
//   statusEl - the status line to update
//   label    - human-readable name for toasts ('Mapping' | 'Source trace')
function handleSave(blob, type, statusEl, label) {
  if (!blob || !blob.length) {
    statusEl.textContent = 'Nothing to save';
    statusEl.classList.remove('red', 'green');
    showToast(`${label} is empty — load a listing and trace first.`, 'error', 'Nothing to save');
    return;
  }
  saveFile(blob, type).then((file) => {
    if (!file) {
      statusEl.textContent = 'Save cancelled';
      statusEl.classList.remove('red', 'green');
      return;
    }
    console.log(file);
    statusEl.textContent = 'Saved to ' + file.name;
    statusEl.classList.remove('red');
    statusEl.classList.add('green');
    showToast(`${label} saved to ${file.name}`, 'success', 'Saved');
  }).catch((err) => {
    statusEl.textContent = '';
    showToast(err.message, 'error', `Could not save ${label.toLowerCase()}`);
  });
}

document.querySelector('.save').addEventListener('click', () => {
  handleSave(mapping, 'full', saveStatus, 'Mapping');
});
document.querySelector('.save_stmts').addEventListener('click', () => {
  handleSave(stmts.join(''), 'cmds', saveSrcStatus, 'Source trace');
});
