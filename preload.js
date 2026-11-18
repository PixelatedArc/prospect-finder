const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testSheet: (input) => ipcRenderer.invoke('sheet:test', input),
  start: (opts) => ipcRenderer.invoke('run:start', opts),
  stop: () => ipcRenderer.invoke('run:stop'),
  buildEmails: (rows, ctx) => ipcRenderer.invoke('email:build', { rows, ctx }),
  checkPipeline: () => ipcRenderer.invoke('pipeline:check'),
  loadWeak: (tab) => ipcRenderer.invoke('email:load', tab),
  emailStatus: () => ipcRenderer.invoke('email:status'),
  runEmails: (job) => ipcRenderer.invoke('email:run', job),
  stopEmails: () => ipcRenderer.invoke('email:stop'),
  findReport: (query) => ipcRenderer.invoke('report:find', query),
  draftReport: (job) => ipcRenderer.invoke('report:draft', job),
  copy: (text) => ipcRenderer.invoke('copy', text),
  open: (target) => ipcRenderer.invoke('open', target),
  onEvent: (fn) => ipcRenderer.on('run:event', (e, ev) => fn(ev)),
  onEmailEvent: (fn) => ipcRenderer.on('email:event', (e, ev) => fn(ev)),
  onDemo: (fn) => ipcRenderer.on('run:demo', (e, data) => fn(data)),
});
