/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
const serial = require('serialport')
const { EventEmitter } = require('events')
const serialEvents = new EventEmitter()
const { createSerialConnection } = require('./serial-connection.js')
const { toast } = require('./utilities.js')
const { getToastMessage } = require('./i18n.js')
const store = require('./store.js').init()

const pathSelect = document.getElementById('path-select')
const baudSelect = document.getElementById('baud-select')
const portSwitch = document.getElementById('port-switch')
// Saved settings seed new windows. Refreshes use this window's own selection.
let selectedPath = store.get('portPath', undefined)
const savedPathIndex = store.get('pathIndex', 0)
let availablePorts = []
let refreshInFlight
let reconnect = false
let modemSignalTimer, _rcvdSerialDataCB, _echoSerialDataCB
let _autoRepeatTimeout
let modemSignal = {
  cts: false,
  dsr: false,
  dcd: false,
}

function populatePortSelect(select, ports, path, showManufacturer = false) {
  select.options.length = 0
  select.add(new Option(getToastMessage('selectSerialPort'), ''))
  ports.forEach((device) => {
    const acpi = process.platform === 'win32' && device.pnpId && device.pnpId.startsWith('ACPI')
    const manufacturer = acpi ? 'Microsoft' : device.manufacturer
    const label = showManufacturer && manufacturer ? device.path + ' ' + manufacturer : device.path
    select.add(new Option(label, device.path))
  })
  if (path && !ports.some((device) => device.path === path)) {
    const unavailable = new Option(path + ' · ' + getToastMessage('serialPortUnavailable'), path)
    unavailable.disabled = true
    select.add(unavailable)
  }
  select.value = path || ''
}

function refreshPorts() {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = serial
    .list()
    .then((ports) => {
      availablePorts = ports
      if (selectedPath === undefined && ports.length) {
        selectedPath = (ports[savedPathIndex] || ports[0]).path
      }
      populatePortSelect(pathSelect, ports, selectedPath, true)
      mcss.FormSelect.init(pathSelect)
      serialEvents.emit('ports', ports)
    })
    .catch((e) => {
      console.error(e)
    })
    .finally(() => {
      refreshInFlight = undefined
    })
  return refreshInFlight
}

function _modemSignalTimerHandle() {
  const { port } = connection
  if (!port || !port.isOpen) return clearInterval(modemSignalTimer)

  port.get((e, signal) => {
    if (port !== connection.port || !port.isOpen) return
    if (e) return console.error(e)

    if (signal.cts !== modemSignal.cts) {
      modemSignal.cts = signal.cts
      if (signal.cts === false) {
        document.getElementById('cts-btn').style.cssText = 'background-color: #dfdfdf !important'
      } else {
        document.getElementById('cts-btn').style.cssText = 'background-color: #26a69a !important'
      }
    }
    if (signal.dsr !== modemSignal.dsr) {
      modemSignal.dsr = signal.dsr
      if (signal.dsr === false) {
        document.getElementById('dsr-btn').style.cssText = 'background-color: #dfdfdf !important'
      } else {
        document.getElementById('dsr-btn').style.cssText = 'background-color: #26a69a !important'
      }
    }
    if (signal.dcd !== modemSignal.dcd) {
      modemSignal.dcd = signal.dcd
      if (signal.dcd === false) {
        document.getElementById('dcd-btn').style.cssText = 'background-color: #dfdfdf !important'
      } else {
        document.getElementById('dcd-btn').style.cssText = 'background-color: #26a69a !important'
      }
    }
  })
}

// Only readonly signals need reset
function _modemSignalReset() {
  modemSignal.cts = false
  modemSignal.dsr = false
  modemSignal.dcd = false
  document.getElementById('cts-btn').style.cssText = 'background-color: #dfdfdf !important'
  document.getElementById('dsr-btn').style.cssText = 'background-color: #dfdfdf !important'
  document.getElementById('dcd-btn').style.cssText = 'background-color: #dfdfdf !important'
}

function _serialWrite(data, hexMode) {
  const { port } = connection
  if (port === undefined || port.isOpen === false) {
    toast(getToastMessage('toastNoPortOpened'))
    return false
  }

  port.write(data, _echoSerialDataCB(data, hexMode))
  return true
}

/**
 * SerialPort open options - Links to actual SerialPort library definitions
 * @typedef {import('@serialport/stream').openOptions} SerialPortOpenOptions
 */

function selectedOptionText(select) {
  const option = select.options[select.selectedIndex]
  return option ? option.text : ''
}

/**
 * Get serial port opening options from UI controls
 * @returns {SerialPortOpenOptions} Configuration object for opening serial port - links to SerialPort library definitions
 */
function _serialGetOptions() {
  const openOptions = {
    baudRate: parseInt(selectedOptionText(baudSelect), 10) || 115200,
    dataBits: parseInt(selectedOptionText(document.getElementById('databits-select')), 10) || 8,
    parity: selectedOptionText(document.getElementById('parity-select')).toLowerCase() || 'none',
    stopBits: parseInt(selectedOptionText(document.getElementById('stopbits-select')), 10) || 1,
  }
  const flowcontrol = selectedOptionText(
    document.getElementById('flowcontrol-select')
  ).toLowerCase()
  if (flowcontrol && flowcontrol !== 'none') openOptions[flowcontrol] = true
  return openOptions
}

const connection = createSerialConnection(
  (data) => {
    serialEvents.emit('data', data)
    if (_rcvdSerialDataCB) _rcvdSerialDataCB(data)
  },
  (state, path) => {
    updatePortSwitch()
    serialEvents.emit('state', state, path)
    if (state === 'open') {
      clearInterval(modemSignalTimer)
      if (document.getElementById('modem-signal-switch').checked) {
        modemSignalTimer = setInterval(_modemSignalTimerHandle, 100)
      }
      applyModemSignals()
    }
    if (state === 'closed') {
      clearInterval(_autoRepeatTimeout)
      clearInterval(modemSignalTimer)
      _modemSignalReset()
      document.dispatchEvent(new CustomEvent('portClosed'))
      if (reconnect) {
        reconnect = false
        openSelectedPort()
      }
    }
  }
)

function applyModemSignals() {
  const { port } = connection
  if (!port || !port.isOpen) return
  // Keep the signal levels selected in this window.
  port.set(
    {
      rts: !document.getElementById('rts-btn').classList.contains('grey'),
      dtr: !document.getElementById('dtr-btn').classList.contains('grey'),
    },
    (error) => {
      if (error) console.error(error)
    }
  )
}

for (const signal of ['rts', 'dtr']) {
  const button = document.getElementById(signal + '-btn')
  button.onclick = () => {
    const off = button.classList.toggle('grey')
    store.set('general.modemSignal.' + signal, !off)
    applyModemSignals()
  }
}

function updatePortSwitch() {
  portSwitch.checked = connection.state === 'open' || connection.state === 'opening'
  portSwitch.disabled = connection.state === 'opening' || connection.state === 'closing'
}

function openSelectedPort() {
  const option = pathSelect.selectedOptions[0]
  connection.open(option && !option.disabled ? option.value : '', _serialGetOptions())
  updatePortSwitch()
}

portSwitch.onclick = () => {
  if (portSwitch.checked) openSelectedPort()
  else serialClose()
}

baudSelect.onchange = () => {
  store.set('baudIndex', baudSelect.selectedIndex)
  const { port } = connection
  if (!port || !port.isOpen) return
  const baudRate = parseInt(selectedOptionText(baudSelect), 10) || 115200
  port.update({ baudRate: baudRate }, (error) => {
    if (error) console.error(error)
  })
}

pathSelect.onchange = () => {
  selectedPath = pathSelect.value
  if (selectedPath) store.set('portPath', selectedPath)
  const { state, port } = connection
  if (!port || (state !== 'closing' && selectedPath === port.path)) return
  reconnect = !!selectedPath
  connection.close()
}

document.getElementById('path-input').onmouseenter = refreshPorts

function bindPrimaryPortControls(path, baud, toggle) {
  const updatePath = () => populatePortSelect(path, availablePorts, selectedPath)
  const updateBaud = () => {
    baud.innerHTML = baudSelect.innerHTML
    baud.value = baudSelect.value
  }
  serialEvents.on('ports', updatePath)
  pathSelect.addEventListener('change', updatePath)
  baudSelect.addEventListener('change', updateBaud)
  new MutationObserver(updateBaud).observe(baudSelect, { childList: true, subtree: true })
  path.onfocus = refreshPorts
  path.onchange = () => {
    pathSelect.value = path.value
    mcss.FormSelect.init(pathSelect)
    pathSelect.dispatchEvent(new Event('change'))
  }
  baud.onchange = () => {
    baudSelect.value = baud.value
    mcss.FormSelect.init(baudSelect)
    baudSelect.dispatchEvent(new Event('change'))
  }
  toggle.onclick = () => portSwitch.click()
  updatePath()
  updateBaud()
}

/**
 * Transmit data through serial port with proper formatting
 * @param {string} dataIn - Raw input data to transmit
 * @returns {boolean} Success status
 */
function transmitData(dataIn) {
  // Pre-process data
  dataIn = dataIn.trim()
  if (dataIn === '') return false
  const eof = store.get('transmit.eof')

  // Convert data to buffer
  let dataOut = null
  let hexMode = store.get('transmit.hexmode')

  if (true === hexMode) {
    // Remove the space characters
    dataIn = dataIn.replace(/ /g, '')
    try {
      dataOut = Buffer.from(dataIn, 'hex')
      // Check if conversion resulted in empty buffer (invalid hex pairs)
      if (dataOut.length === 0 && dataIn.length > 0) {
        toast(getToastMessage('toastInvalidHexData'))
        return false
      }
      dataOut = Buffer.concat([dataOut, Buffer.from(eof, 'utf8')])
    } catch (error) {
      console.log('Error: Invalid hex data format', error)
      return false
    }
  } else {
    dataOut = Buffer.from(dataIn, 'utf8')
    dataOut = Buffer.concat([dataOut, Buffer.from(eof, 'utf8')])
  }

  if (_serialWrite(dataOut, hexMode) === false) return false

  console.log('Transmitted:', dataOut)

  // Handle auto-repeat functionality
  if (document.getElementById('trans-repeat-switch').checked === true) {
    // release the previous timer
    if (_autoRepeatTimeout !== undefined) clearInterval(_autoRepeatTimeout)

    let interval = document.getElementById('trans-repeat-interval').value
    interval = parseInt(interval)
    if (isNaN(interval) === true) interval = 1000

    // start the new timer
    _autoRepeatTimeout = setInterval(() => {
      _serialWrite(dataOut, hexMode)
    }, interval)
  }

  return true
}

document.getElementById('trans-repeat-switch').onchange = (e) => {
  let checked = e.target.checked

  if (checked === false && _autoRepeatTimeout !== undefined) {
    // cancel the timer
    clearInterval(_autoRepeatTimeout)
  }
}

function serialClose() {
  reconnect = false
  connection.close()
}

function serialInit(rcvdDataCB, echoDataCB) {
  _rcvdSerialDataCB = rcvdDataCB
  _echoSerialDataCB = echoDataCB
}

module.exports = {
  serialEvents,
  writeTerminalData: connection.writeTerminalData,
  getPrimaryPortState: () => connection.state,
  refreshPorts,
  populatePortSelect,
  bindPrimaryPortControls,
  serialInit,
  transmitData,
  serialClose,
}
