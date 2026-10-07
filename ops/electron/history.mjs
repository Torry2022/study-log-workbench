const form=document.querySelector('form'),fields=form.elements,notice=document.querySelector('#notice');
const render=()=>fields.days.disabled=!fields.enabled.checked;
document.querySelector('#cancel').onclick=()=>window.close();fields.enabled.onchange=render;
try{const value=await window.historySettings.read();fields.enabled.checked=value.enabled;fields.days.value=String(value.days);render();}catch{notice.textContent='无法读取历史版本设置，请关闭后重试。';}
form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{await window.historySettings.save({enabled:fields.enabled.checked,days:Number(fields.days.value)});}catch{notice.textContent='未能保存设置，请关闭窗口后重试。';button.disabled=false;}};
