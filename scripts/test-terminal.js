/* Integration test: real Electron renderer and xterm, simulated serial hardware. */
/* eslint-env es6 */
const path = require('path')
const fs = require('fs')
const root = path.resolve(__dirname, '..')

if (process.type === 'renderer') {
  const Module = require('module')
  const load = Module._load
  const { EventEmitter } = require('events')
  class SerialMock extends EventEmitter {
    constructor(path, options) {
      super()
      this.path = path
      this.options = options
      this.isOpen = true
      this.writes = []
      window.testPort = this
      window.testPorts = window.testPorts || {}
      window.testPorts[path] = this
      window.testOpenCount = (window.testOpenCount || 0) + 1
      process.nextTick(() => this.emit('open'))
    }
    static list() {
      const paths = window.testPortList || ['MOCK', 'MOCK2']
      return Promise.resolve(paths.map((path) => ({ path, manufacturer: 'Test' })))
    }
    write(data, callback) {
      this.writes.push(Buffer.from(data).toString('utf8'))
      if (callback) callback(null)
    }
    set() {}
    close() {
      this.isOpen = false
      this.emit('close', null)
    }
  }
  Module._load = function (name, ...args) {
    if (name === 'serialport') return SerialMock
    const result = load.call(this, name, ...args)
    if (name === 'electron') {
      return Object.create(result, {
        clipboard: {
          value: {
            readText: () => window.testClipboardText || '',
            writeText: (text) => {
              window.testClipboardText = text
            },
          },
        },
      })
    }
    if (name === 'xterm') {
      return {
        ...result,
        Terminal: class extends result.Terminal {
          constructor(options) {
            super(options)
            window.testTerminal = this
          }
        },
      }
    }
    return result
  }
} else if (process.type === 'browser') {
  const assert = require('assert')
  const { app, BrowserWindow, dialog } = require('electron')
  const phase = process.argv[2]
  app.setPath('userData', process.argv[3])
  app
    .whenReady()
    .then(async () => {
      const store = require('../src/modules/store').initWithMigration(
        require('../package.json').version
      )
      if (phase === 'interaction') store.set('terminal.secondary.baudRate', 115201)
      const win = new BrowserWindow({
        show: false,
        width: 760,
        height: 768,
        webPreferences: { nodeIntegration: true, preload: __filename },
      })
      const dialogs = []
      let cancelSave = false
      dialog.showSaveDialog = async (parent, options) => {
        assert.strictEqual(parent, win)
        const name = cancelSave ? 'canceled-' + options.defaultPath : options.defaultPath
        const filePath = path.join(app.getPath('userData'), name)
        dialogs.push(filePath)
        return { canceled: cancelSave, filePath }
      }
      win.webContents.on('console-message', (event, level, message) => {
        if (level >= 2) console.error('Renderer:', message)
      })
      const js = (code) => win.webContents.executeJavaScript(code)
      const pause = () => new Promise((resolve) => setTimeout(resolve, 50))
      const flush = () => js('new Promise(resolve => window.testTerminal.write("", resolve))')
      await win.loadFile(path.join(root, 'src/index.html'))
      for (
        let i = 0;
        i < 100 && !(await js('typeof editorInst !== "undefined" && !!editorInst'));
        i++
      )
        await pause()
      assert(await js('!!editorInst'), 'original Monaco editor initializes')
      if (phase === 'restore') {
        assert(
          await js('!!window.testTerminal && !document.getElementById("serial-terminal").hidden')
        )
        assert.strictEqual(await js('document.getElementById("terminal-local-echo").checked'), true)
        assert.strictEqual(await js('document.getElementById("terminal-enter").value'), 'crlf')
        assert.strictEqual(
          await js('document.getElementById("terminal-secondary-baud").value'),
          '1000000'
        )
        console.log('PASS terminal mode and options survive process restart')
        app.exit(0)
        return
      }
      assert.strictEqual(
        await js('!!window.testTerminal'),
        false,
        'terminal is lazy and text mode is default'
      )
      await js(String.raw`editorInst.getModel().setValue('keep my edited log\n');
      require('./modules/serialport').refreshPorts();`)
      await pause()
      await js(`document.getElementById('port-switch').click();
      document.getElementById('terminal-mode-btn').click();`)
      await pause()
      assert(
        await js(
          '!!window.testTerminal && window.testTerminal.cols > 20 && window.testTerminal.rows > 5'
        )
      )
      assert(
        await js(`document.getElementById('terminal-mode-btn').getBoundingClientRect().left >=
        document.getElementById('menu-btn').getBoundingClientRect().right`),
        'mode buttons do not overlap at minimum width'
      )
      assert(
        await js(`Array.from(document.getElementById('terminal-toolbar').children).every((el, i, all) =>
        i === 0 || el.getBoundingClientRect().left >= all[i - 1].getBoundingClientRect().right)`),
        'terminal controls do not overlap on Electron 7'
      )
      const narrowCols = await js('window.testTerminal.cols')
      win.setSize(1000, 768)
      await pause()
      assert(
        (await js('window.testTerminal.cols')) > narrowCols,
        'terminal resizes with its window'
      )
      const fullRows = await js('window.testTerminal.rows')
      await js('document.getElementById("menu-btn").click()')
      for (let i = 0; i < 40 && (await js('window.testTerminal.rows')) >= fullRows; i++)
        await pause()
      assert(
        (await js('window.testTerminal.rows')) < fullRows,
        'settings panel leaves room for the terminal: ' +
          (await js(`JSON.stringify({
          rows: window.testTerminal.rows, menuHidden: document.getElementById('menu-area').hidden,
          editorHeight: document.getElementById('editor-area').offsetHeight, menuHeight: menuInfo.height
        })`))
      )
      await js('document.getElementById("menu-btn").click(); window.testTerminal.focus()')
      await pause()
      console.log('PASS minimum-width controls, window resize and settings panel layout')
      const key = async (keyCode, modifiers = []) => {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        await pause()
      }
      for (const letter of 'help ') {
        win.webContents.sendInputEvent({ type: 'char', keyCode: letter })
      }
      await key('Enter')
      await key('Up')
      await key('Tab')
      await key('Backspace')
      await key('C', ['control'])
      assert.deepStrictEqual(await js('window.testPort.writes'), [
        'h',
        'e',
        'l',
        'p',
        ' ',
        '\r',
        '\x1b[A',
        '\t',
        '\x7f',
        '\x03',
      ])
      console.log('PASS exact serial bytes for text, space, Enter, arrows, Tab, Backspace, Ctrl+C')
      await js(String.raw`window.testPort.emit('data', Buffer.from('\x1b[31mRED\x1b[0m\r\n'));
      const bytes = Buffer.from('中文\r\n');
      window.testPort.emit('data', bytes.slice(0, 1));
      window.testPort.emit('data', bytes.slice(1));`)
      await flush()
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(0).translateToString(true)'),
        'RED'
      )
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(0).getCell(0).getFgColor()'),
        1
      )
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(1).translateToString(true)'),
        '中文'
      )
      assert((await js('editorInst.getValue()')).startsWith('keep my edited log\n'))
      fs.mkdirSync(path.join(root, 'out'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'out/terminal-preview.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      console.log('PASS ANSI colors, fragmented UTF-8 and original editor logging')
      await js(String.raw`window.savedTerminal = window.testTerminal;
      document.getElementById('terminal-mode-btn').click();
      window.testPort.emit('data', Buffer.from('still receiving\r\n'));`)
      await flush()
      assert(await js('document.getElementById("serial-terminal").hidden'))
      await js('document.getElementById("terminal-mode-btn").click()')
      assert(
        await js(
          'window.savedTerminal === window.testTerminal && window.testPort.isOpen && window.testOpenCount === 1'
        )
      )
      assert((await js('editorInst.getValue()')).includes('still receiving'))
      console.log('PASS mode switches preserve both buffers and the existing connection')
      await js(`document.getElementById('terminal-local-echo').click();
      document.getElementById('terminal-enter').value = 'crlf';
      document.getElementById('terminal-enter').dispatchEvent(new Event('change'));
      window.testTerminal.focus();`)
      store.set('transmit.hexmode', true)
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' })
      await key('Enter')
      await flush()
      assert.deepStrictEqual(await js('window.testPort.writes.slice(-2)'), ['x', '\r\n'])
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(3).translateToString(true)'),
        'x'
      )
      console.log('PASS local echo, CRLF and independence from existing hex-send settings')
      const savedEditor = await js('editorInst.getValue()')
      await js('document.getElementById("terminal-clear").click()')
      await flush()
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(0).translateToString(true)'),
        ''
      )
      assert.strictEqual(await js('editorInst.getValue()'), savedEditor)
      store.set('transmit.hexmode', false)
      store.set('transmit.eof', '\r\n')
      await js(`require('./modules/serialport').transmitData(' original ');`)
      assert.strictEqual(await js('window.testPort.writes.slice(-1)[0]'), 'original\r\n')
      await js('window.testPort.close(); window.testTerminal.focus()')
      const count = await js('window.testPort.writes.length')
      await key('Enter')
      assert.strictEqual(await js('window.testPort.writes.length'), count)
      console.log(
        'PASS isolated clear, unchanged original send behavior and disconnected-input guard'
      )

      win.setSize(760, 768)
      await js(`window.primaryTerminal = window.testTerminal;
      document.getElementById('terminal-split-btn').click();
      require('./modules/serialport').refreshPorts();`)
      assert(
        await js(`['terminal-toolbar', 'terminal-secondary-toolbar'].every(id => {
        const toolbar = document.getElementById(id);
        return toolbar.lastElementChild.getBoundingClientRect().right <= toolbar.getBoundingClientRect().right;
      })`),
        'both split toolbars fit at minimum window width'
      )
      assert.strictEqual(
        await js('document.getElementById("terminal-secondary-baud").tagName'),
        'SELECT'
      )
      assert.strictEqual(
        await js('document.getElementById("terminal-secondary-baud").value'),
        '115201',
        'previously saved baud remains selected'
      )
      await js(`{
      const primaryBaud = document.getElementById('terminal-primary-baud');
      primaryBaud.value = '5';
      primaryBaud.dispatchEvent(new Event('change'));
      document.getElementById('terminal-primary-toggle').click();
      const secondary = document.getElementById('terminal-secondary-port');
      secondary.value = 'MOCK';
      secondary.dispatchEvent(new Event('change'));
      document.getElementById('terminal-secondary-toggle').click();
      }`)
      assert.strictEqual(await js('window.testOpenCount'), 2, 'duplicate port is rejected')
      await js(`{
      const secondary = document.getElementById('terminal-secondary-port');
      secondary.value = 'MOCK2';
      secondary.dispatchEvent(new Event('change'));
      const baud = document.getElementById('terminal-secondary-baud');
      baud.value = '9600';
      baud.dispatchEvent(new Event('change'));
      document.getElementById('terminal-secondary-toggle').click();
      }`)
      assert.strictEqual(await js('window.testPorts.MOCK2.options.baudRate'), 9600)
      assert.strictEqual(await js('window.testPorts.MOCK.options.baudRate'), 921600)
      await js(String.raw`window.testPorts.MOCK.emit('data', Buffer.from('LEFT\r\n'));
      window.testPorts.MOCK2.emit('data', Buffer.from('RIGHT\r\n'));`)
      await js('new Promise(resolve => window.primaryTerminal.write("", resolve))')
      await flush()
      assert.strictEqual(
        await js('window.primaryTerminal.buffer.active.getLine(0).translateToString(true)'),
        'LEFT'
      )
      await js(`{
      document.getElementById('terminal-secondary-toggle').click();
      const baud = document.getElementById('terminal-secondary-baud');
      baud.value = 'custom';
      baud.dispatchEvent(new Event('change'));
      }`)
      assert(await js('document.getElementById("terminal-secondary-baud-dialog").open'))
      await js(`document.getElementById('terminal-secondary-baud-dialog')
        .querySelector('button[type="button"]').click()`)
      assert.strictEqual(
        await js('document.getElementById("terminal-secondary-baud").value'),
        '9600'
      )
      await js(`{
      const baud = document.getElementById('terminal-secondary-baud');
      baud.value = 'custom';
      baud.dispatchEvent(new Event('change'));
      const input = document.getElementById('terminal-secondary-baud-input');
      input.value = '1000000';
      document.getElementById('terminal-secondary-baud-dialog')
        .querySelector('button[type="submit"]').click();
      document.getElementById('terminal-secondary-toggle').click();
      }`)
      assert(!(await js('document.getElementById("terminal-secondary-baud-dialog").open')))
      assert.strictEqual(await js('window.testPorts.MOCK2.options.baudRate'), 1000000)
      assert.strictEqual(await js('window.testPorts.MOCK.options.baudRate'), 921600)
      console.log('PASS secondary baud presets and independent custom baud selection')
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(0).translateToString(true)'),
        'RIGHT'
      )
      assert(!(await js('editorInst.getValue()')).includes('RIGHT'))
      await js('window.testTerminal.focus()')
      await key('Enter')
      assert.deepStrictEqual(await js('window.testPorts.MOCK2.writes'), ['\r'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), [])
      await js('window.primaryTerminal.focus()')
      await key('Enter')
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), ['\r\n'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK2.writes'), ['\r'])

      const wrappedLine = 'left message '.repeat(15) + '串口日志'
      const rightLines = Array.from({ length: 100 }, (_, index) => 'right message ' + index)
      await js(`window.testPorts.MOCK.emit('data', Buffer.from(${JSON.stringify(
        '\x1b[31m' + wrappedLine + '\x1b[0m\r\n'
      )}));
      window.testPorts.MOCK2.emit('data', Buffer.from(${JSON.stringify(
        rightLines.join('\r\n') + '\r\n'
      )}));
      document.getElementById('terminal-save').onclick();`)
      await js('document.getElementById("terminal-secondary-save").onclick()')
      assert.strictEqual(dialogs.length, 2)
      assert(path.basename(dialogs[0]).startsWith('MOCK-'))
      assert(path.basename(dialogs[1]).startsWith('MOCK2-'))
      const leftLog = fs.readFileSync(dialogs[0], 'utf8')
      const rightLog = fs.readFileSync(dialogs[1], 'utf8')
      assert(leftLog.startsWith('LEFT\n'))
      assert(leftLog.endsWith(wrappedLine + '\n'), 'visual wraps join into the original line')
      assert(!leftLog.includes('\x1b'), 'export excludes ANSI styling bytes')
      assert(!leftLog.includes('RIGHT'))
      assert.strictEqual(rightLog, ['RIGHT', ...rightLines, ''].join('\n'))
      cancelSave = true
      await js('document.getElementById("terminal-secondary-save").onclick()')
      assert.strictEqual(dialogs.length, 3)
      assert(!fs.existsSync(dialogs[2]))
      console.log('PASS separate UTF-8 log exports, scrollback, line wrapping and cancellation')

      await js('window.primaryTerminal.focus(); window.primaryTerminal.select(0, 0, 4);')
      await key('C', ['control'])
      assert.strictEqual(await js('window.testClipboardText'), 'LEFT')
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), ['\r\n'])
      await js('window.testTerminal.focus()')
      await key('V', ['control'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK2.writes'), ['\r', 'LEFT'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), ['\r\n'])

      await js('window.testTerminal.select(0, 0, 5);')
      await key('C', ['control', 'shift'])
      assert.strictEqual(await js('window.testClipboardText'), 'RIGHT')
      await js(
        String.raw`window.primaryTerminal.focus(); window.testClipboardText += ' 中文\r\nnext';`
      )
      await key('V', ['control', 'shift'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), ['\r\n', 'RIGHT 中文\rnext'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK2.writes'), ['\r', 'LEFT'])

      await js('window.primaryTerminal.clearSelection(); window.testClipboardText = "";')
      await key('V', ['control'])
      await key('C', ['control'])
      assert.deepStrictEqual(await js('window.testPorts.MOCK.writes'), [
        '\r\n',
        'RIGHT 中文\rnext',
        '\x03',
      ])
      assert.deepStrictEqual(await js('window.testPorts.MOCK2.writes'), ['\r', 'LEFT'])
      console.log('PASS independent terminal copy, paste and Ctrl+C interrupt shortcuts')

      await js('document.getElementById("terminal-secondary-clear").click()')
      assert.strictEqual(
        await js('window.testTerminal.buffer.active.getLine(0).translateToString(true)'),
        ''
      )
      assert.strictEqual(
        await js('window.primaryTerminal.buffer.active.getLine(0).translateToString(true)'),
        'LEFT'
      )
      await js('document.getElementById("terminal-split-btn").click()')
      assert(await js('window.testPorts.MOCK.isOpen && !window.testPorts.MOCK2.isOpen'))
      assert(await js('document.getElementById("terminal-secondary").hidden'))
      console.log('PASS dual-port receive, keyboard transmit, clear and disconnect isolation')

      const other = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, preload: __filename },
      })
      await other.loadFile(path.join(root, 'src/index.html'))
      const otherJS = (code) => other.webContents.executeJavaScript(code)
      await otherJS(`require('./modules/serialport').refreshPorts()`)
      await otherJS(`{
      const path = document.getElementById('path-select');
      path.value = 'MOCK2';
      path.dispatchEvent(new Event('change'));
      const baud = document.getElementById('baud-select');
      baud.value = '2';
      baud.dispatchEvent(new Event('change'));
      }`)
      await js(`window.testPortList = ['MOCK2', 'MOCK'];
      require('./modules/serialport').refreshPorts();`)
      assert.strictEqual(await js('document.getElementById("path-select").value'), 'MOCK')
      assert.strictEqual(await otherJS('document.getElementById("path-select").value'), 'MOCK2')
      await js(`const toggle = document.getElementById('port-switch');
      toggle.click();
      toggle.click();`)
      assert.strictEqual(await js('window.testPorts.MOCK.options.baudRate'), 921600)
      assert(await js('window.testPorts.MOCK.isOpen'))
      assert(!(await js('window.testPorts.MOCK2.isOpen')))
      other.destroy()
      console.log(
        'PASS other windows and reordered port lists preserve the current selection and baud'
      )
      app.exit(0)
    })
    .catch((error) => {
      console.error(error.stack)
      app.exit(1)
    })
} else {
  const { spawnSync } = require('child_process')
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'comng-terminal-test-'))
  const electron = require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const phase of ['interaction', 'restore']) {
    const result = spawnSync(electron, [__filename, phase, profile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env,
      windowsHide: true,
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) console.error(result.error.message)
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
