// Noulette landing page: slideshow, theme switch and latest-release details.
(function () {
  var REPO = 'vibecoder0715/Noulette';

  // Slideshow (same timing as the desktop Home page). Skipped for reduced motion.
  var slides = document.querySelectorAll('.slide-layer');
  if (slides.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var i = 0;
    setInterval(function () {
      slides[i].classList.remove('active');
      i = (i + 1) % slides.length;
      slides[i].classList.add('active');
    }, 4500);
  }

  // Theme switch, remembered per browser.
  var toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('nl-theme', next);
  });

  // Show the latest version and size. The Install button already points at the latest release,
  // so this is only a nicety; failures leave the default text.
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rel) {
      if (!rel) return;
      var asset = (rel.assets || []).find(function (a) { return a.name === 'Noulette-Setup.exe'; });
      var meta = document.getElementById('release-meta');
      var size = asset ? ' · ' + Math.round(asset.size / 1e6) + ' MB' : '';
      meta.textContent = 'Version ' + String(rel.tag_name).replace(/^v/, '') + size + ' · Windows 10 and 11 (64-bit) · Free and open source';
    })
    .catch(function () {});
})();
