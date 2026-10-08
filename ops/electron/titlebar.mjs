document.querySelector('img').src = new URLSearchParams(location.search).get('icon');
const buttons = [...document.querySelectorAll('button')];
const focus = index => { buttons.forEach((button,i)=>button.tabIndex=i===index?0:-1);buttons[index].focus(); };
buttons.forEach((button,index)=>{
 const open=hover=>window.titlebar.menu(index,button.getBoundingClientRect().left,hover,buttons.map(item=>{const rect=item.getBoundingClientRect();return {left:rect.left,right:rect.right};}));
 button.onclick=()=>open(false);
 button.onpointerenter=()=>open(true);
 button.onkeydown=event=>{
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
   event.preventDefault();focus(event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length);
  }else if(event.key==='ArrowDown'){event.preventDefault();button.click();}
 };
});
window.titlebar.onFocus(()=>focus(0));
window.titlebar.onTheme(theme=>{document.documentElement.dataset.theme=theme;});

window.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();window.titlebar.workspace();}
 if(event.key==='F10'||event.key==='Alt'){event.preventDefault();focus(0);}
});

window.titlebar.onLocation(label=>{const location=document.querySelector('#location');location.textContent=label;location.title=label;});

window.titlebar.onActiveMenu(id=>buttons.forEach((button,index)=>button.setAttribute('aria-expanded',String(index===id))));
