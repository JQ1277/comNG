/* eslint-env es6 */
const fs = require('fs')
const path = require('path')
const { remote, clipboard } = require('electron')
const store = require('./store.js').init()
const {
  serialEvents,
  writeTerminalData,
  getPrimaryPortState,
  refreshPorts,
  populatePortSelect,
  bindPrimaryPortControls,
} = require('./serialport.js')
const { createSerialConnection } = require('./serial-connection.js')
const { getToastMessage } = require('./i18n.js')
const { generateFileName, toast } = require('./utilities.js')

const enterSequences = { cr: '\r', lf: '\n', crlf: '\r\n' }
let active = false
let split = false
let primary
let secondary
let secondaryConnection

function fitTerminal() {
  if (!active) return
  const bounds = document.getElementById('editor-area').getBoundingClientRect()
  const panel = document.getElementById('serial-terminal')
  panel.style.left = bounds.left + 'px'
  panel.style.top = bounds.top + 'px'
  panel.style.width = bounds.width + 'px'
  panel.style.height = bounds.height + 'px'
  primary.fit()
  if (split) secondary.fit()
}

function readTerminalLog(buffer) {
  const lines = []
  const cursorRow = buffer.baseY + buffer.cursorY
  let usedLines = 0
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
    // Keep blank lines up to the cursor, but skip unused rows below the output.
    if (text || row <= cursorRow) usedLines = lines.length
  }
  lines.length = usedLines
  return lines.join('\n')
}

function createTerminalPane(prefix, settings, writeData, isVisible) {
  const screen = document.getElementById(prefix + '-screen')
  const echo = document.getElementById(prefix + '-local-echo')
  const enter = document.getElementById(prefix + '-enter')
  const clear = document.getElementById(prefix + '-clear')
  const save = document.getElementById(prefix + '-save')

  let terminal
  let fitAddon
  let displayedPath

  echo.checked = store.get(settings + '.localEcho', false)
  echo.onchange = () => store.set(settings + '.localEcho', echo.checked)
  enter.value = store.get(settings + '.enter', 'cr')
  enter.onchange = () => store.set(settings + '.enter', enter.value)
  clear.onclick = () => {
    if (!terminal) return
    terminal.reset()
    terminal.focus()
  }
  save.onclick = async () => {
    if (!terminal || save.disabled) return
    save.disabled = true
    try {
      const portName = path.basename(displayedPath || prefix).replace(/[^\w.-]/g, '_')
      // Take the snapshot after queued serial data has been parsed.
      const text = await new Promise((resolve) => {
        terminal.write('', () => resolve(readTerminalLog(terminal.buffer.active)))
      })
      if (!text) {
        toast(getToastMessage('terminalNoLog'))
        return
      }
      const { canceled, filePath } = await remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
        properties: ['createDirectory'],
        defaultPath: portName + '-' + generateFileName(),
        filters: [{ name: 'Log', extensions: ['log'] }],
      })
      if (canceled || !filePath) return
      await fs.promises.writeFile(filePath, text, 'utf8')
      toast(getToastMessage('terminalLogSaved'))
    } catch (error) {
      console.error(error)
      toast(getToastMessage('terminalSaveFailed'))
    } finally {
      save.disabled = false
    }
  }

  function initialize() {
    if (terminal) return
    const { Terminal } = require('xterm')
    const { FitAddon } = require('xterm-addon-fit')
    terminal = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontSize: 14,
      fontFamily: "'Cascadia Mono', Consolas, monospace",
      theme: { background: '#111827', foreground: '#d5dfec', cursor: '#5eead4' },
    })
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(screen)
    terminal.onData((data) => {
      if (!isVisible()) return
      const output = data === '\r' ? enterSequences[enter.value] || '\r' : data
      // xterm input bypasses text-mode formatting, including hex and automatic repeat.
      if (!writeData(output) || !echo.checked) return
      if (data === '\r') terminal.write('\r\n')
      else if (data === '\x7f') terminal.write('\b \b')
      else if (data === '\x03') terminal.write('^C\r\n')
      else terminal.write(data)
    })
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type !== 'keydown' ||
        event.altKey ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey)
      ) {
        return true
      }

      const key = event.key.toLowerCase()
      if (key === 'c' && terminal.hasSelection()) {
        event.preventDefault()
        clipboard.writeText(terminal.getSelection())
        return false
      }
      if (key === 'v') {
        // Intercept Ctrl+V before xterm sends it as the SYN control character.
        event.preventDefault()
        if (!event.repeat) {
          const text = clipboard.readText()
          if (text) terminal.paste(text)
        }
        return false
      }
      return true
    })
  }

  return {
    initialize,
    fit: () => fitAddon.fit(),
    focus: () => terminal.focus(),
    receive(data) {
      // Raw bytes preserve ANSI sequences and UTF-8 characters split across chunks.
      if (terminal) terminal.write(data)
    },
    showPort(path) {
      if (terminal && displayedPath && displayedPath !== path) {
        // Queue the terminal reset after any pending data from the previous port.
        terminal.write('\x1bc')
      }
      displayedPath = path
    },
  }
}

function updateConnectionButton(button, state) {
  button.disabled = state === 'opening' || state === 'closing'
  button.textContent = getToastMessage(state === 'open' ? 'terminalDisconnect' : 'terminalConnect')
  button.classList.toggle('connected', state === 'open')
}

function isValidBaudRate(rate) {
  return Number.isInteger(rate) && rate >= 1 && rate <= 2147483647
}

function initSecondaryBaudSelect(select) {
  const dialog = document.getElementById('terminal-secondary-baud-dialog')
  const input = document.getElementById('terminal-secondary-baud-input')
  const rateKey = 'terminal.secondary.baudRate'
  const customKey = 'terminal.secondary.customBaudRate'
  const presets = Array.from(document.getElementById('baud-select').options, (option) =>
    Number(option.text)
  ).filter(isValidBaudRate)
  const savedRate = store.get(rateKey)
  const savedCustom = store.get(customKey)
  let selectedRate = isValidBaudRate(savedRate) ? savedRate : 115200
  let customRate = isValidBaudRate(savedCustom) ? savedCustom : selectedRate

  function updateOptions() {
    select.options.length = 0
    for (const rate of new Set([...presets, customRate, selectedRate])) {
      select.add(new Option(String(rate), String(rate)))
    }
    select.add(new Option(getToastMessage('terminalCustomBaud'), 'custom'))
    select.value = String(selectedRate)
  }

  select.onchange = () => {
    if (select.value === 'custom') {
      select.value = String(selectedRate)
      input.setCustomValidity('')
      input.value = String(customRate)
      dialog.showModal()
      input.select()
      return
    }
    selectedRate = Number(select.value)
    store.set(rateKey, selectedRate)
  }
  input.oninput = () => input.setCustomValidity('')
  dialog.querySelector('button[type="button"]').onclick = () => dialog.close()
  dialog.querySelector('form').onsubmit = (event) => {
    event.preventDefault()
    const rate = Number(input.value)
    if (!isValidBaudRate(rate)) {
      input.setCustomValidity(getToastMessage('terminalInvalidBaud'))
      input.reportValidity()
      return
    }
    customRate = rate
    selectedRate = rate
    store.set({ [rateKey]: rate, [customKey]: rate })
    updateOptions()
    dialog.close()
  }
  updateOptions()
}

function initSplitControls() {
  const primaryToggle = document.getElementById('terminal-primary-toggle')
  bindPrimaryPortControls(
    document.getElementById('terminal-primary-port'),
    document.getElementById('terminal-primary-baud'),
    primaryToggle
  )
  updateConnectionButton(primaryToggle, getPrimaryPortState())
  serialEvents.on('state', (state, path) => {
    updateConnectionButton(primaryToggle, state)
    if (state === 'open') primary.showPort(path)
  })

  const secondaryPath = document.getElementById('terminal-secondary-port')
  const secondaryBaud = document.getElementById('terminal-secondary-baud')
  const secondaryToggle = document.getElementById('terminal-secondary-toggle')
  let selectedPath = store.get('terminal.secondary.path', '')
  initSecondaryBaudSelect(secondaryBaud)
  secondaryConnection = createSerialConnection(secondary.receive, (state, path) => {
    const busy = state !== 'closed'
    secondaryPath.disabled = busy
    secondaryBaud.disabled = busy
    updateConnectionButton(secondaryToggle, state)
    if (state === 'open') {
      secondary.showPort(path)
      if (split) secondary.focus()
    }
  })
  serialEvents.on('ports', (ports) => populatePortSelect(secondaryPath, ports, selectedPath))
  secondaryPath.onfocus = refreshPorts
  secondaryPath.onchange = () => {
    selectedPath = secondaryPath.value
    store.set('terminal.secondary.path', selectedPath)
  }
  secondaryToggle.onclick = () => {
    if (secondaryConnection.state === 'open') {
      secondaryConnection.close()
      return
    }
    const option = secondaryPath.selectedOptions[0]
    const baudRate = Number(secondaryBaud.value)
    secondaryConnection.open(option && !option.disabled ? option.value : '', { baudRate })
  }
}

function setTerminalMode(enabled, splitEnabled = false) {
  const showSplit = enabled && splitEnabled
  if (split && !showSplit) secondaryConnection.close()
  active = enabled
  split = showSplit

  const panel = document.getElementById('serial-terminal')
  panel.hidden = !active
  document.getElementById('terminal-secondary').hidden = !split
  document.getElementById('terminal-primary-controls').hidden = !split
  document.getElementById('terminal-single-title').hidden = split
  document.body.classList.toggle('terminal-active', active)
  document.body.classList.toggle('terminal-split', split)
  const button = document.getElementById('terminal-mode-btn')
  button.setAttribute('aria-pressed', String(active))
  button.textContent = getToastMessage(active ? 'textMode' : 'terminalMode')
  document.getElementById('terminal-split-btn').setAttribute('aria-pressed', String(split))
  store.set('terminal.enabled', active)
  if (active) {
    primary.initialize()
    if (split) {
      secondary.initialize()
      refreshPorts()
    }
    fitTerminal()
    primary.focus()
  } else {
    window.dispatchEvent(new Event('resize'))
    const editorInput = document.querySelector('#editor-area textarea')
    if (editorInput) editorInput.focus()
  }
}

function initTerminalMode() {
  primary = createTerminalPane('terminal', 'terminal', writeTerminalData, () => active)
  secondary = createTerminalPane(
    'terminal-secondary',
    'terminal.secondary',
    (data) => secondaryConnection.writeTerminalData(data),
    () => split
  )
  serialEvents.on('data', primary.receive)
  initSplitControls()
  document.getElementById('terminal-mode-btn').onclick = () => setTerminalMode(!active)
  document.getElementById('terminal-split-btn').onclick = () => setTerminalMode(true, !split)
  new ResizeObserver(fitTerminal).observe(document.getElementById('editor-area'))
  refreshPorts()
  if (store.get('terminal.enabled', false)) setTerminalMode(true)
}

module.exports = { initTerminalMode }
