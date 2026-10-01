import { animate, stagger } from 'motion';

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const elements = document.querySelectorAll('[data-reveal]');
  if (elements.length) animate(elements, { opacity: [0,1], y: [18,0] }, { duration: .65, delay: stagger(.09), ease: [.22,1,.36,1] });
  const wheel = document.querySelector<HTMLElement>('.wheel-decorative .wheel-disc');
  if (wheel) animate(wheel, { rotate: [0,360] }, { duration: 70, ease: 'linear', repeat: Infinity });
}
