const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('titlebar',Object.freeze({
 workspace:()=>ipcRenderer.send('titlebar:workspace'),
 menu:(id,x,hover,regions)=>ipcRenderer.send('titlebar:menu',id,x,hover,regions),
 onActiveMenu:callback=>ipcRenderer.on('titlebar:active-menu',(_event,id)=>callback(id)),
 onFocus:callback=>ipcRenderer.on('titlebar:focus',()=>callback()),
 onTheme:callback=>ipcRenderer.on('titlebar:theme',(_event,theme)=>callback(theme))
}));
