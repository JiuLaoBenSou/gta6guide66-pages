const backToTop = document.querySelector('.back-to-top');
const siteHome = document.querySelector('.site-header .brand');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function updateBackToTop() {
  backToTop.hidden = window.scrollY < 450;
}

backToTop.addEventListener('click', () => {
  siteHome.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
});

window.addEventListener('scroll', updateBackToTop, { passive: true });
updateBackToTop();
