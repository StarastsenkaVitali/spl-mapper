let path = undefined
const openFile = async () => {
  // console.log(WellKnownDirectory)

  const [handle] = await window.showOpenFilePicker({
    startIn: path
  })
  path = handle;
  const file = await handle.getFile()
  return file
};
// const openFile = async () => {
//   return new Promise((resolve) => {
//     const input = document.createElement('input');
//     input.type = 'file';
//     input.addEventListener('change', () => {
//       resolve(input.files[0]);
//     });
//     input.click();
//   });
// };

const saveFile = async (blob, type) => {
  try {
    const handle = await window.showSaveFilePicker({
      startIn: path,
      types: [{
        description: 'Mapping',
        accept: {
          'text/map': [`.${type}.txt`],
        },
      }],
    });

    const writable = await handle.createWritable();
    writable.filename = writable.filename + '.full.txt'
    await writable.write(blob);
    await writable.close();
    return handle;
  } catch (err) {
    console.error(err.message);
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
  result = []
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
  const traceLines = text.split('\r\n')
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

listingType.addEventListener('change', () => {
  console.log(listingType.value)
})

document.querySelector('.open_listing').addEventListener('click', async () => {
  if (!listingType.value) {
    openListingStatus.classList.remove('green');
    openListingStatus.classList.add('red');
    openListingStatus.textContent = "Please choose architecture type!"
    return
  }
  let start = Date.now();
  await openFile().then((file) => {
    start = Date.now();
    openListingStatus.textContent = 'File is opened';
    openListingStatus.classList.remove('red');
    openListingStatus.classList.add('green');
    return file.text()
  }).then(text => {
    statements = listingType.value == "s390" ? getStatments390(text) : getStatments86(text);
    console.log(statements);
    openListingStatus.classList.remove('red');
    openListingStatus.classList.add('green');
    openListingStatus.innerHTML = `Success! File is uploaded. </br>
     ${statements.listingStatements.length} addresses and </br> ${statements.sourceStatements.length} statements were loaded`
    modNameInput.value = statements.moduleName;
  }).catch((err) => {
    openListingStatus.classList.remove('green');
    openListingStatus.classList.add('red');
    openListingStatus.textContent = 'Error!' + err.message
  }
  )
  const end = Date.now();
  console.log(`Execution time: ${end - start} ms`);
});
document.querySelector('.open_trace').addEventListener('click', () => {
  openFile().then((file) => {
    openTraceStatus.textContent = 'File is opened';
    openTraceStatus.classList.remove('red');
    openTraceStatus.classList.add('green');
    return file.text()
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
    openTraceStatus.textContent = 'Mapping is created';
    openTraceStatus.classList.remove('red');
    openTraceStatus.classList.add('green');
  }).catch(
    (err) => {
      openTraceStatus.classList.remove('green');
      openTraceStatus.classList.add('red');
      openTraceStatus.textContent = 'Error!' + err.message
      throw err
    }
  )
});
const from = document.querySelector('.from');
const to = document.querySelector('.to');
const filename = document.querySelector('.name');
document.querySelector('.save').addEventListener('click', () => {
  saveFile(mapping, 'full').then((file => {
    console.log(file)
    saveStatus.textContent = 'Mapping is saved to ' + file.name;
    saveStatus.classList.remove('red');
    saveStatus.classList.add('green');
  })).catch(err => {
    saveStatus.textContent = err.message;
    saveStatus.classList.remove('green');
    saveStatus.classList.add('red');
  })
});
document.querySelector('.save_stmts').addEventListener('click', () => {
  saveFile(stmts.join(''), 'cmds').then(file => {
    console.log(file)
    saveSrcStatus.textContent = 'Source trace is saved to ' + file.name;
    saveSrcStatus.classList.remove('red');
    saveSrcStatus.classList.add('green');
  }).catch(err => {
    saveSrcStatus.textContent = err.message;
    saveSrcStatus.classList.remove('green');
    saveSrcStatus.classList.add('red');
  })
});
