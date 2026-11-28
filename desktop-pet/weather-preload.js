const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuWeather', {
  onColorMode: callback => { const listener = (_event, mode, appearance, theme) => callback(mode, appearance, theme); ipcRenderer.on('pet:color-mode', listener); return () => ipcRenderer.removeListener('pet:color-mode', listener); },
  onChooseCity: callback => { const listener = () => callback(); ipcRenderer.on('weather:choose-city', listener); return () => ipcRenderer.removeListener('weather:choose-city', listener); },
  onDetails: callback => { const listener = () => callback(); ipcRenderer.on('weather:details', listener); return () => ipcRenderer.removeListener('weather:details', listener); },
  onPointerReset: callback => { const listener = () => callback(); ipcRenderer.on('pet:quota-card-pointer-reset', listener); return () => ipcRenderer.removeListener('pet:quota-card-pointer-reset', listener); },
  onCollapse: callback => { const listener = () => callback(); ipcRenderer.on('weather:collapse', listener); return () => ipcRenderer.removeListener('weather:collapse', listener); },
  get: () => ipcRenderer.invoke('weather:get'),
  refresh: () => ipcRenderer.invoke('weather:refresh'),
  search: query => ipcRenderer.invoke('weather:search', query),
  selectCity: city => ipcRenderer.invoke('weather:city', city),
  useLocation: confirmed => ipcRenderer.invoke('weather:location', confirmed === true ? true : undefined),
  resize: size => ipcRenderer.invoke('weather:resize', typeof size === 'boolean' ? size : {
    expanded: size?.expanded === true,
    ...(Number.isFinite(size?.height) ? { height: size.height } : {}),
    ...(typeof size?.picker === 'boolean' ? { picker: size.picker } : {})
  }),
  collapse: value => ipcRenderer.invoke('weather:collapse', { reducedMotion: value?.reducedMotion === true }),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('weather:state', listener);
    return () => ipcRenderer.removeListener('weather:state', listener);
  }
});
