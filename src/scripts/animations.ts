import { inView } from 'motion';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ease = 'cubic-bezier(.23,1,.32,1)';
const active = new Map<Element, Animation>();

/** Rapid actions continue from the visible state instead of restarting from zero. */
function reveal(element: Element, distance = 10, duration = 280, delay = 0) {
  if (reduced.matches) return;
  const previous = active.get(element);
  const style = previous ? getComputedStyle(element) : null;
  const from = { opacity: style?.opacity || '0', transform: style?.transform || `translateY(${distance}px)` };
  previous?.cancel();
  const animation = element.animate([from, { opacity: '1', transform: 'translateY(0)' }], { duration, delay, easing: ease, fill: 'backwards' });
  active.set(element, animation);
  animation.finished.then(() => { if (active.get(element) === animation) active.delete(element); }).catch(() => {});
}

const heroText = document.querySelectorAll('.hero-copy [data-reveal]');
heroText.forEach((element,index) => reveal(element, 18, 560, index * 65));
inView('[data-reveal]', element => {
  if (element.closest('.hero-copy')) return;
  const marketing = !!element.closest('.home-page');
  reveal(element, marketing ? 16 : 8, marketing ? 480 : 260);
}, { margin: '0px 0px -20px 0px' });
inView('.countdown', element => {
  element.querySelectorAll('span').forEach((number,index) => reveal(number, 10, 360, index * 85));
});

const cards = document.getElementById('raffle-list');
if (cards) {
  let signature = '';
  new MutationObserver(() => {
    const items = cards.querySelectorAll('.raffle-card');
    const next = [...items].map(item => item.querySelector('a')?.getAttribute('href') + item.textContent!).join('|');
    if (next === signature) return;
    signature = next;
    items.forEach((card,index) => reveal(card, 12, 300, Math.min(index,5) * 45));
  }).observe(cards, { childList: true, subtree: true });
}

const grid = document.getElementById('ticket-grid');
if (grid) {
  let signature = grid.innerHTML;
  new MutationObserver(() => {
    const next = grid.innerHTML;
    if (signature === next) return;
    signature = next;
    reveal(grid, 4, 180);
  }).observe(grid, { childList: true });
}

document.querySelectorAll('#stat-raffles,#stat-sold,#stat-available,#sold-count,#available-count').forEach(element => {
  let value = element.textContent;
  new MutationObserver(() => {
    if (element.textContent === value) return;
    value = element.textContent;
    reveal(element, 5, 240);
  }).observe(element, { childList: true, characterData: true, subtree: true });
});

document.querySelectorAll('details').forEach(details => {
  details.addEventListener('toggle', () => {
    if (details.open) [...details.children].filter(child => child.tagName !== 'SUMMARY').forEach(child => reveal(child, 4, 200));
  });
});

const header = document.querySelector('.site-header');
const reflectScroll = () => header?.classList.toggle('is-scrolled', scrollY > 20);
window.addEventListener('scroll', reflectScroll, { passive: true });
reflectScroll();

const navigation = document.querySelector('.raffle-jump');
if (navigation) {
  const links = [...navigation.querySelectorAll<HTMLAnchorElement>('a')];
  const observer = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) return;
    links.forEach(link => {
      const current = link.hash === `#${visible.target.id}`;
      link.classList.toggle('is-current', current);
      if (current) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-10% 0px -70% 0px' });
  links.forEach(link => { const target = document.querySelector(link.hash); if (target) observer.observe(target); });
}

reduced.addEventListener('change', () => {
  if (!reduced.matches) return;
  active.forEach(animation => animation.finish());
  active.clear();
});
window.addEventListener('pagehide', () => { active.forEach(animation => animation.cancel()); active.clear(); }, { once: true });
