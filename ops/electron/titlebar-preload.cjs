const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('titlebar',Object.freeze({
 onLocation:callback=>ipcRenderer.on('titlebar:location',(_event,label)=>callback(label)),
 workspace:()=>ipcRenderer.send('titlebar:workspace'),
 menu:(id,x)=>ipcRenderer.send('titlebar:menu',id,x),
 onFocus:callback=>ipcRenderer.on('titlebar:focus',()=>callback()),
 onTheme:callback=>ipcRenderer.on('titlebar:theme',(_event,theme)=>callback(theme))
}));
