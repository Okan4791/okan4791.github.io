const routeLinks = [...document.querySelectorAll('.case-route a[href^="#"]')];
const sections = routeLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

function setActiveSection(id) {
  for (const link of routeLinks) {
    const active = link.getAttribute('href') === `#${id}`;
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }

  for (const section of sections) {
    section.classList.toggle('is-active', section.id === id);
  }
}

if (routeLinks.length && sections.length) {
  const initialId = sections.some((section) => section.id === location.hash.slice(1))
    ? location.hash.slice(1)
    : sections[0].id;

  setActiveSection(initialId);

  for (const link of routeLinks) {
    link.addEventListener('click', () => setActiveSection(link.hash.slice(1)));
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.find((entry) => entry.isIntersecting);
    if (visible) setActiveSection(visible.target.id);
  }, { rootMargin: '-30% 0px -60%', threshold: 0 });

  for (const section of sections) observer.observe(section);
}
