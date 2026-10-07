const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('connection',Object.freeze({read:()=>ipcRenderer.invoke('connection:read'),pickDirectory:()=>ipcRenderer.invoke('connection:pick-directory'),select:value=>ipcRenderer.invoke('connection:select',value),notice:callback=>ipcRenderer.on('connection:notice',(_event,message)=>callback(message))}));
