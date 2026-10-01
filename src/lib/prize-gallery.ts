import type { Prize } from './model';

export function setupPrizeGallery() {
  const galleries = Array.from(document.querySelectorAll<HTMLElement>('[data-prize-gallery]'));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let prizes: Prize[] = [], index = 0, signature = '', paused = motion.matches;
  let timer: number | undefined;
  function render() {
    const prize = prizes[index];
    for (const gallery of galleries) {
      const image = gallery.querySelector<HTMLImageElement>('[data-gallery-image]')!;
      if (prize) {
        if (image.getAttribute('src') !== prize.image) {
          image.src = prize.image;
          if (!motion.matches && typeof image.animate === 'function') image.animate([{opacity:.25},{opacity:1}],{duration:350,easing:'ease-out'});
        }
        image.alt = prize.name; gallery.querySelector('[data-gallery-caption]')!.textContent = prize.name;
      }
      gallery.querySelector<HTMLElement>('[data-gallery-controls]')!.hidden = prizes.length < 2;
      gallery.querySelector('[data-gallery-position]')!.textContent = `${index+1} / ${prizes.length}`;
      const pause = gallery.querySelector<HTMLButtonElement>('[data-gallery-action="pause"]')!;
      pause.textContent = paused ? 'Reanudar galería' : 'Pausar galería'; pause.setAttribute('aria-pressed',String(paused));
    }
  }
  function schedule() {
    window.clearInterval(timer);
    if (!paused && prizes.length > 1 && !document.hidden) timer = window.setInterval(()=>{index=(index+1)%prizes.length;render();},5000);
  }
  galleries.forEach(gallery=>gallery.addEventListener('click',event=>{
    const action = (event.target as Element).closest<HTMLElement>('[data-gallery-action]')?.dataset.galleryAction;
    if (!action || !prizes.length) return;
    if (action === 'pause') paused = !paused;
    else index = (index + (action === 'next' ? 1 : -1) + prizes.length) % prizes.length;
    render(); schedule();
  }));
  document.addEventListener('visibilitychange',schedule);
  motion.addEventListener('change',event=>{if(event.matches){paused=true;render();schedule();}});
  window.addEventListener('pagehide',()=>window.clearInterval(timer),{once:true});
  return {
    setPrizes(value: Prize[]) { const next=JSON.stringify(value);if(next===signature)return;signature=next;prizes=value;index=Math.min(index,Math.max(0,value.length-1));render();schedule(); },
  };
}
