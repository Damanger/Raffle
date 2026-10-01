export function setupWheelFullscreen(panel: HTMLElement, button: HTMLButtonElement, onResize: () => void) {
  let expanded = false, native = false, previousOverflow = '', previousFocus: HTMLElement | null = null;
  const role = panel.getAttribute('role'), modal = panel.getAttribute('aria-modal');
  function restore() {
    if (!expanded) return;
    expanded = false; native = false; panel.classList.remove('wheel-expanded');
    role ? panel.setAttribute('role',role) : panel.removeAttribute('role');
    modal ? panel.setAttribute('aria-modal',modal) : panel.removeAttribute('aria-modal');
    document.body.style.overflow = previousOverflow;
    button.textContent = 'Pantalla completa'; button.setAttribute('aria-expanded','false');
    previousFocus?.focus({preventScroll:true}); requestAnimationFrame(onResize);
  }
  async function close() {
    if (document.fullscreenElement === panel) { try { await document.exitFullscreen(); } catch { /* Restore the viewport view even if the browser is leaving fullscreen. */ } }
    restore();
  }
  button.addEventListener('click', async()=>{
    if (expanded) { await close();return; }
    previousFocus = document.activeElement as HTMLElement; previousOverflow = document.body.style.overflow;
    expanded = true; panel.classList.add('wheel-expanded'); panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true');
    document.body.style.overflow = 'hidden'; button.textContent = 'Salir de pantalla completa'; button.setAttribute('aria-expanded','true');
    // Keep the same live wheel and controls; unsupported browsers use the viewport overlay.
    if (panel.requestFullscreen && document.fullscreenEnabled) {
      try { await panel.requestFullscreen(); native = document.fullscreenElement === panel; }
      catch { native = false; }
    }
    if (!expanded) { if (document.fullscreenElement === panel) await document.exitFullscreen().catch(()=>{});return; }
    button.focus({preventScroll:true}); requestAnimationFrame(onResize);
  });
  document.addEventListener('fullscreenchange',()=>{
    if (document.fullscreenElement === panel) native = true;
    else if (native) restore();
  });
  document.addEventListener('keydown',event=>{
    if (!expanded || panel.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && !native) { event.preventDefault();void close(); }
    if (event.key === 'Tab') {
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')).filter(el=>el.getClientRects().length>0);
      const first=focusable[0],last=focusable.at(-1);
      if (event.shiftKey && (document.activeElement===first || !panel.contains(document.activeElement))) {event.preventDefault();last?.focus();}
      else if (!event.shiftKey && (document.activeElement===last || !panel.contains(document.activeElement))) {event.preventDefault();first?.focus();}
    }
  });
  window.addEventListener('resize',()=>{if(expanded)requestAnimationFrame(onResize);});
  window.addEventListener('pagehide',restore,{once:true});
  return { close };
}
