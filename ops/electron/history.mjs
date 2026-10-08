const form=document.querySelector('form'),fields=form.elements,notice=document.querySelector('#notice');
const button=form.querySelector('[type=submit]');let original,saving=false;
const render=()=>{fields.days.disabled=!fields.enabled.checked;button.disabled=saving||!original||(fields.enabled.checked===original.enabled&&Number(fields.days.value)===original.days);};
form.oninput=render;form.onchange=render;
document.querySelector('#cancel').onclick=()=>window.close();fields.enabled.onchange=render;
try{const value=await window.historySettings.read();fields.enabled.checked=value.enabled;fields.days.value=String(value.days);original=value;render();}catch{notice.textContent='无法读取历史版本设置，请关闭后重试。';}
form.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;saving=true;render();try{await window.historySettings.save({enabled:fields.enabled.checked,days:Number(fields.days.value)});}catch{notice.textContent='未能保存设置，请关闭窗口后重试。';saving=false;render();}};
