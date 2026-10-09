/* Shared overlay handles leave existing scroll containers and their layout intact. */
(() => {
  if (window.__studyLogScrollbars) return;
  window.__studyLogScrollbars = true;
  document.documentElement.classList.add('overlay-scrollbars-ready');
  const layer = document.createElement('div'); layer.className = 'overlay-scrollbars'; document.body.append(layer);
  const entries = new Map(); let frame = 0, scan = true, dragging = false;
  const queue = (rescan = false) => { scan ||= rescan; if (!frame) frame = requestAnimationFrame(update); };
  const observer = new ResizeObserver(() => queue());
  function add(element) {
    const bars = ['y', 'x'].map(axis => {
      const bar = document.createElement('div'); bar.className = `overlay-scrollbar ${axis}`;
      bar.tabIndex = 0; bar.setAttribute('role', 'scrollbar'); bar.setAttribute('aria-label', axis === 'y' ? '垂直滚动' : '水平滚动');
      bar.setAttribute('aria-orientation', axis === 'y' ? 'vertical' : 'horizontal');
      bar.setAttribute('aria-valuemin', '0');
      const thumb = document.createElement('div'); thumb.className = 'overlay-scrollbar-thumb'; bar.append(thumb); layer.append(bar);
      const position = axis === 'y' ? 'scrollTop' : 'scrollLeft';
      bar.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); bar.focus({preventScroll:true});
        const rect = bar.getBoundingClientRect(), length = axis === 'y' ? rect.height : rect.width;
        const extent = axis === 'y' ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
        const thumbLength = axis === 'y' ? thumb.offsetHeight : thumb.offsetWidth;
        const coord = e => axis === 'y' ? e.clientY : e.clientX;
        if (event.target !== thumb) element[position] = (coord(event) - (axis === 'y' ? rect.top : rect.left) - thumbLength / 2) / (length - thumbLength) * extent;
        const start = coord(event), initial = element[position]; dragging = true; bar.setPointerCapture(event.pointerId);
        const move = e => { element[position] = initial + (coord(e) - start) / (length - thumbLength) * extent; queue(); };
        const end = () => { dragging = false; bar.removeEventListener('pointermove', move); bar.removeEventListener('lostpointercapture', end); queue(true); };
        bar.addEventListener('pointermove', move); bar.addEventListener('lostpointercapture', end, {once:true}); queue();
      });
      bar.addEventListener('keydown', event => {
        const extent = axis === 'y' ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
        const page = axis === 'y' ? element.clientHeight : element.clientWidth;
        const values = {ArrowUp:-40,ArrowLeft:-40,ArrowDown:40,ArrowRight:40,PageUp:-page,PageDown:page,Home:-extent,End:extent};
        if (!(event.key in values)) return; event.preventDefault(); element[position] += values[event.key]; queue();
      });
      bar.addEventListener('wheel', event => { element.scrollBy({top:event.deltaY,left:event.deltaX}); event.preventDefault(); }, {passive:false});
      return {bar, thumb, axis};
    });
    entries.set(element, bars); observer.observe(element);
  }
  function update() {
    frame = 0;
    if (scan && !dragging) {
      scan = false;
      const found = new Set([document.scrollingElement]);
      for (const element of document.body.querySelectorAll('*')) {
        if (layer.contains(element) || element === layer) continue;
        const style = getComputedStyle(element);
        if (/auto|scroll/.test(style.overflowX + style.overflowY)) found.add(element);
      }
      for (const [element,bars] of entries) if (!found.has(element) || !element.isConnected) { bars.forEach(({bar})=>bar.remove()); observer.unobserve(element); entries.delete(element); }
      for (const element of found) if (element && !entries.has(element)) add(element);
    }
    for (const [element,bars] of entries) {
      const root = element === document.scrollingElement, style = getComputedStyle(element);
      const bounds = root ? {left:0,top:0,right:innerWidth,bottom:innerHeight} : element.getBoundingClientRect();
      let left = Math.max(0,bounds.left + (root?0:element.clientLeft)), top = Math.max(0,bounds.top + (root?0:element.clientTop));
      let right = Math.min(innerWidth,root?innerWidth:bounds.left+element.clientLeft+element.clientWidth), bottom = Math.min(innerHeight,root?innerHeight:bounds.top+element.clientTop+element.clientHeight);
      for (let parent=element.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
        const css=getComputedStyle(parent); if (/auto|scroll|hidden|clip/.test(css.overflowX+css.overflowY)) {const r=parent.getBoundingClientRect();left=Math.max(left,r.left);right=Math.min(right,r.right);top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}
      }
      for (const {bar,thumb,axis} of bars) {
        const vertical=axis==='y', viewport=vertical?element.clientHeight:element.clientWidth, total=vertical?element.scrollHeight:element.scrollWidth;
        const length=(vertical?bottom-top:right-left)-4, offset=vertical?element.scrollTop:element.scrollLeft;
        const blocked=root && [getComputedStyle(document.body).overflowY,style.overflowY].includes('hidden');
        const visible=!blocked && element.getClientRects().length && length>24 && total>viewport+1 && (root || /auto|scroll/.test(vertical?style.overflowY:style.overflowX));
        bar.hidden=!visible; if(!visible)continue;
        // Do not expose a background scrollbar through a modal or overlapping pane.
        const hit=document.elementsFromPoint(vertical?right-5:left+5,vertical?top+5:bottom-5).find(e=>!layer.contains(e));
        if (hit && !(element===hit || element.contains(hit))) {bar.hidden=true;continue;}
        Object.assign(bar.style,{left:`${vertical?right-10:left+2}px`,top:`${vertical?top+2:bottom-10}px`,width:`${vertical?8:length}px`,height:`${vertical?length:8}px`});
        const size=Math.min(length,Math.max(24,length*viewport/total)), progress=offset/(total-viewport);
        Object.assign(thumb.style,{width:vertical?'100%':`${size}px`,height:vertical?`${size}px`:'100%',transform:`translate${vertical?'Y':'X'}(${progress*(length-size)}px)`});
        bar.setAttribute('aria-valuemax',String(total-viewport));bar.setAttribute('aria-valuenow',String(Math.round(offset)));
      }
    }
  }
  new MutationObserver(records=>{if(records.some(r=>!layer.contains(r.target) && !(r.type==='childList' && [...r.addedNodes,...r.removedNodes].every(n=>n===layer))))queue(true);}).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  document.addEventListener('scroll',()=>queue(),true);window.addEventListener('resize',()=>queue(true));
  document.addEventListener('load',()=>queue(true),true);document.fonts.ready.then(()=>queue(true));
  document.addEventListener('transitionend',()=>queue(true),true); observer.observe(document.body);queue(true);
})();
