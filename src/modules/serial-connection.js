/* eslint-env es6 */
const SerialPort = require('serialport')
const { toast } = require('./utilities.js')
const { getToastMessage } = require('./i18n.js')

const claimedPaths = new Set()

function createSerialConnection(onData, onStateChange) {
  let port
  let state = 'closed'
  let closePending = false

  function setState(next, path) {
    state = next
    onStateChange(state, path)
  }

  function close() {
    if (state === 'opening') {
      closePending = true
    } else if (state === 'open') {
      const current = port
      setState('closing', current.path)
      current.close((error) => {
        if (!error || current !== port) return
        toast(error.message)
        setState('open', current.path)
      })
    }
  }

  function open(path, options) {
    if (state !== 'closed') return
    if (!path) {
      toast(getToastMessage('selectSerialPort'))
      return
    }
    if (claimedPaths.has(path)) {
      toast(path + ' · ' + getToastMessage('serialPortInUse'))
      return
    }

    let current
    try {
      current = new SerialPort(path, options)
    } catch (error) {
      toast(path + ' · ' + error.message)
      return
    }
    port = current
    claimedPaths.add(path)
    setState('opening', path)

    function release() {
      if (current !== port) return
      port = undefined
      closePending = false
      claimedPaths.delete(path)
      setState('closed', path)
    }

    current.on('open', () => {
      setState('open', path)
      if (closePending) close()
    })
    current.on('close', release)
    current.on('error', (error) => {
      if (current !== port) return
      toast(path + ' · ' + error.message)
      if (state === 'opening') release()
    })
    current.on('data', (data) => {
      if (current === port && state === 'open') onData(data)
    })
  }

  function writeTerminalData(data) {
    if (state !== 'open' || !port.isOpen) {
      toast(getToastMessage('toastNoPortOpened'))
      return false
    }
    port.write(Buffer.from(data, 'utf8'), (error) => {
      if (error) toast(getToastMessage('toastWriteFailed'))
    })
    return true
  }

  return {
    open,
    close,
    writeTerminalData,
    get state() {
      return state
    },
    get port() {
      return port
    },
  }
}

module.exports = { createSerialConnection }
