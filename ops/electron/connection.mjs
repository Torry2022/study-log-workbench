const form=document.querySelector('form'),notice=document.querySelector('#notice'),submit=form.querySelector('[type=submit]');
let localReady=false;
function directory(root,kind){localReady=kind==='new'||kind==='existing';document.querySelector('#root').value=root;document.querySelector('#root').title=root;document.querySelector('#directory-state').textContent=kind==='new'?'将在此处保存学习记录':kind==='existing'?'可打开已有学习记录':'';render();}
window.connection.notice(message=>notice.textContent=message);
function render(){const remote=form.elements.mode.value==='remote';document.querySelector('#remote').hidden=!remote;document.querySelector('#local').hidden=remote;form.elements.origin.required=remote;form.elements.password.required=remote;submit.disabled=!remote&&!localReady;submit.textContent=remote?'连接服务器':'打开本地工作台';}
form.addEventListener('change',render);document.querySelector('#cancel').onclick=()=>window.connection.cancel();
try{const saved=await window.connection.read();form.elements.mode.value=saved.mode;form.elements.origin.value=saved.origin;form.elements.localHttp.checked=saved.localHttp;directory(saved.root,saved.kind);document.querySelector('.logo-light').src=saved.logos.light;document.querySelector('.logo-dark').src=saved.logos.dark;if(saved.error)notice.textContent=saved.error;render();}catch{notice.textContent='无法读取使用设置，请关闭后重试。';}
form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;notice.textContent='';try{const result=await window.connection.select({mode:form.elements.mode.value,origin:form.elements.origin.value.trim(),password:form.elements.password.value,localHttp:form.elements.localHttp.checked});if(result.error)notice.textContent=result.error;}catch{notice.textContent='连接未完成，请重试。';}finally{render();}};


document.querySelector('#choose-directory').onclick=async()=>{const button=document.querySelector('#choose-directory');button.disabled=true;notice.textContent='';try{const result=await window.connection.pickDirectory();if(result.error)notice.textContent=result.error;else if(!result.canceled){directory(result.root,result.kind);}}catch{notice.textContent='无法打开文件夹选择窗口，请重试。';}finally{button.disabled=false;}};
