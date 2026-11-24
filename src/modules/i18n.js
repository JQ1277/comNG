const locale = require('./locale.js').getLocale()
console.log('Locale:', locale)

const titleI18n = {
  zh: {
    setting: '设置',
    portSwitch: '串口开关',
    cleanData: '清空数据',
    autoScrolldown: '自动下拉',
    terminalToggle: '切换文本 / 终端模式',
    terminalSplit: '双串口分屏',
    minimize: '最小化',
    maximize: '最大化',
    close: '关闭',
  },
  en: {
    setting: 'Settings',
    portSwitch: 'Port Switch',
    cleanData: 'Clean Data',
    autoScrolldown: 'Auto Scrolldown',
    terminalToggle: 'Switch text / terminal mode',
    terminalSplit: 'Dual serial split view',
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
  },
}

const labelI18n = {
  zh: {
    general: '通用',
    transmit: '发送',
    advance: '高级',
    fileops: '文件操作',
    chart: '可视化',
    about: '关于',
    hexMode: '十六进制模式',
    timestamp: '时间戳',
    modemSignal: '流控信号',
    darkTheme: '深色主题',
    customizedBaudRate: '自定义波特率',
    terminalMode: '终端',
    textMode: '文本',
    terminalLocalEcho: '本地回显',
    terminalEnter: '回车发送',
    terminalClear: '清空终端',
    terminalSaveLog: '保存日志',
    terminalLogSaved: '日志已保存',
    terminalNoLog: '终端没有可保存的日志',
    terminalSaveFailed: '日志保存失败，请检查保存位置后重试',
    terminalSplit: '双串口分屏',
    terminalPrimary: '串口 1',
    terminalSecondary: '串口 2',
    terminalBaud: '波特率',
    terminalCustomBaud: '自定义…',
    terminalInvalidBaud: '请输入 1 到 2147483647 之间的整数',
    terminalCancel: '取消',
    terminalApply: '确定',
    terminalConnect: '连接',
    terminalDisconnect: '断开',
    selectSerialPort: '请选择串口',
    serialPortUnavailable: '不可用',
    serialPortInUse: '已被另一个分屏占用',
    terminalHint: '选中后 Ctrl+C 复制 · Ctrl+V 粘贴到当前串口 · 无选区时 Ctrl+C 发送中断',
    fontSize: '字体大小',
    fontFamily: '字体',
    protocolOptions: '协议配置',
    eof: '换行符',
    txHexMode: '十六进制',

    autoRepeat: '自动重发',
    signature: '签名',
    breakpoint: '文本断点',
    barColor: '控制板配色',
    darkThemeBarColor: '深色主题配色',
    lightThemeBarColor: '浅色主题配色',
    capture2File: '数据捕获到文件',
    shortcuts: '快捷键',
    chartSwitch: '启用可视化',
    chartExample: '消息示例: NGF Number0 Number1',
    version: '版本',
    license: '许可证',
    starMe: '给我点个星',
    feedback: '反馈',
    documents: '文档',
    userManual: '用户手册',
    tryPreviewVersion: '尝鲜版本',
    toastEnableHexMode: '请先在通用标签页中启用"十六进制模式"。',
    toastBreakpointNotEmpty: '错误：文本断点不能为空',
    toastNoPortOpened: '错误：没有打开串口，无法写入',
    toastWriteFailed: '错误：写入失败，请重试',
    toastInvalidHexData: '错误：请确保发送的数据是有效的十六进制数据',
  },
  en: {
    general: 'General',
    transmit: 'Transmit',
    advance: 'Advance',
    fileops: 'File Ops',
    chart: 'Chart',
    about: 'About',
    hexMode: 'Hex Mode',
    timestamp: 'Timestamp',
    modemSignal: 'Modem Signal',
    darkTheme: 'Dark Theme',
    customizedBaudRate: 'Customized Baud Rate',
    terminalMode: 'Terminal',
    textMode: 'Text',
    terminalLocalEcho: 'Local echo',
    terminalEnter: 'Enter sends',
    terminalClear: 'Clear terminal',
    terminalSaveLog: 'Save log',
    terminalLogSaved: 'Log saved',
    terminalNoLog: 'No terminal log to save',
    terminalSaveFailed: 'Could not save the log. Check the destination and try again.',
    terminalSplit: 'Dual serial split view',
    terminalPrimary: 'Port 1',
    terminalSecondary: 'Port 2',
    terminalBaud: 'Baud rate',
    terminalCustomBaud: 'Custom…',
    terminalInvalidBaud: 'Enter a whole number from 1 to 2147483647',
    terminalCancel: 'Cancel',
    terminalApply: 'Apply',
    terminalConnect: 'Connect',
    terminalDisconnect: 'Disconnect',
    selectSerialPort: 'Select a port',
    serialPortUnavailable: 'Unavailable',
    serialPortInUse: 'Already open in the other pane',
    terminalHint: 'Ctrl+C copies selection · Ctrl+V pastes to the focused port · Ctrl+C interrupts when nothing is selected',
    fontSize: 'Font Size',
    fontFamily: 'Font Family',
    protocolOptions: 'Protocol Options',
    eof: 'EOF',
    txHexMode: 'Hex Mode',

    autoRepeat: 'Auto Repeat',
    signature: 'Signature',
    breakpoint: 'Break on Text',
    barColor: 'Bar Color',
    darkThemeBarColor: 'Dark Theme Bar Color',
    lightThemeBarColor: 'Light Theme Bar Color',
    capture2File: 'Capture to File',
    shortcuts: 'Shortcuts',
    chartSwitch: 'Enable Chart',
    chartExample: 'Format: NGF Number0 Number1',
    version: 'Version',
    license: 'License',
    starMe: 'Star Me',
    feedback: 'Feedback',
    documents: 'Documents',
    userManual: 'User Manual',
    tryPreviewVersion: 'Try Preview Version',
    toastEnableHexMode: "Please first enable 'Hex Mode' in General tab.",
    toastBreakpointNotEmpty: 'Error: Breakpoint on-text can not be empty',
    toastNoPortOpened: 'Error: No port opened, cannot write',
    toastWriteFailed: 'Error: Write failed, please try again',
    toastInvalidHexData: 'Error: Please ensure the tx data is valid hex data',
  },
}

function applyLanguage() {
  let lang = locale.split('-')[0]
  if (!titleI18n[lang]) lang = 'en'
  // lang = 'zh' // for test

  document.querySelectorAll('[i18n-title]').forEach((el) => {
    const key = el.getAttribute('i18n-title')
    el.title = titleI18n[lang][key] || key
  })

  document.querySelectorAll('[i18n-label]').forEach((el) => {
    const key = el.getAttribute('i18n-label')
    el.textContent = labelI18n[lang][key] || key
  })

  document.querySelectorAll('[i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('i18n-aria-label')
    el.setAttribute('aria-label', labelI18n[lang][key] || key)
  })
}

module.exports = {
  applyLanguage,
  getToastMessage,
}

/**
 * Get translated toast message
 * @param {string} key - The translation key
 * @returns {string} Translated message or fallback to English/key
 */
function getToastMessage(key) {
  const lang = locale.split('-')[0]
  const messages = labelI18n[lang] || labelI18n.en
  return messages[key] || labelI18n.en[key] || key
}
