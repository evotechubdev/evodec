const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tv', {
  version: () => ipcRenderer.invoke('app:version'),
  logout: () => ipcRenderer.invoke('tv:logout'),
  request: (action, extra = {}, adult = false) => ipcRenderer.invoke('tv:request', action, extra, adult),
  catalog: (options = {}) => ipcRenderer.invoke('tv:catalog', options),
  extraCatalog: () => ipcRenderer.invoke('tv:extra-catalog'),
  extraStreamUrl: (id) => ipcRenderer.invoke('tv:extra-stream-url', id),
  streamUrl: (kind, id, extension, options) => ipcRenderer.invoke('tv:stream-url', kind, id, extension, options),
  closeStream: () => ipcRenderer.invoke('tv:close-stream'),
  nativePlay: (url, bounds, options) => ipcRenderer.invoke('native:play', url, bounds, options),
  nativeCommand: (command, value) => ipcRenderer.invoke('native:command', command, value),
  onNativeState: callback => ipcRenderer.on('native:state', (_event, value) => callback(value)),
  download: (media) => ipcRenderer.invoke('tv:download', media),
  cancelDownload: () => ipcRenderer.invoke('tv:cancel-download'),
  showDownloadedFile: () => ipcRenderer.invoke('tv:show-downloaded-file'),
  onDownloadProgress: (callback) => ipcRenderer.on('download:progress', (_event, value) => callback(value)),
});

contextBridge.exposeInMainWorld('games', {
  open: (gameId, bounds) => ipcRenderer.invoke('games:open', gameId, bounds),
  bounds: (bounds) => ipcRenderer.invoke('games:bounds', bounds),
  reload: () => ipcRenderer.invoke('games:reload'),
  close: () => ipcRenderer.invoke('games:close'),
  onEnded: (callback) => ipcRenderer.on('games:ended', () => callback()),
});

contextBridge.exposeInMainWorld('evoAuth', {
  login: (login, password, remember = false) => ipcRenderer.invoke('auth:login', login, password, remember),
  rememberedLogin: () => ipcRenderer.invoke('auth:remembered-login'),
  forgetLogin: () => ipcRenderer.invoke('auth:forget-login'),
  selectProfile: (profile, pin = null, rememberPin = false) => ipcRenderer.invoke('auth:select-profile', profile, pin, rememberPin),
  switchProfile: () => ipcRenderer.invoke('auth:switch-profile'),
  profileSettings: () => ipcRenderer.invoke('profiles:settings'),
  saveProfiles: (settings) => ipcRenderer.invoke('profiles:save', settings),
  onSessionEnded: (callback) => ipcRenderer.on('session:ended', (_event, message) => callback(message)),
  parental: () => ipcRenderer.invoke('parental:get'),
  parentalSettings: () => ipcRenderer.invoke('parental:settings'),
  unlockParental: (pin) => ipcRenderer.invoke('parental:unlock', pin),
  saveParental: (settings) => ipcRenderer.invoke('parental:save', settings),
});
