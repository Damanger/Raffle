import { animate } from 'motion';

const button = document.getElementById('demo-spin') as HTMLButtonElement | null;
const wheel = document.getElementById('demo-wheel');
if (button && wheel) {
  const numbers = ['001', '008', '014', '023', '032', '047', '056', '064'];
  let rotation = 0;
  let motion: ReturnType<typeof animate> | undefined;
  let generation = 0;
  let place = 3;
  button.addEventListener('click', async () => {
    const current = ++generation;
    const word = crypto.getRandomValues(new Uint32Array(1))[0];
    const index = word % numbers.length;
    // Stop at the presentation value so another press can redirect the same wheel.
    motion?.stop();
    const transform = getComputedStyle(wheel).transform;
    if (transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform);
      rotation = (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
    }
    const target = (360 - (index * 45 + 22.5)) % 360;
    const end = rotation + 720 + ((target - rotation + 360) % 360);
    document.getElementById('demo-label')!.textContent = 'Girando la suerte…';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion = animate(wheel, { rotate: [rotation, end] }, { duration: 2.4, ease: [.12, .72, .13, 1] });
      await motion;
    } else wheel.style.transform = `rotate(${end}deg)`;
    if (current !== generation) return;
    rotation = end;
    document.getElementById('demo-label')!.textContent = `Ganador ${place} · número de ejemplo`;
    document.getElementById('demo-number')!.textContent = `#${numbers[index]}`;
    document.querySelectorAll<HTMLElement>('[data-countdown]').forEach(element => element.classList.toggle('is-selected',element.textContent === String(place)));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelector('.demo-result')!.animate([{opacity:.25,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'cubic-bezier(.23,1,.32,1)'});
    }
    place = place === 1 ? 3 : place - 1;
  });
}
