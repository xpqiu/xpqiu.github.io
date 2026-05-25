/* GitHub data fetcher for project cards.
 *
 * Two element types:
 *   - [data-repo="owner/name"]   single repo → fills .stars-count
 *   - [data-org="orgname"]       organisation → populates <li> sub-repos
 *
 * Results cached in localStorage with a 1 h TTL to stay well within the
 * unauthenticated GitHub API rate limit (60 req/hour per IP). */
(function () {
  'use strict';

  var TTL_MS = 60 * 60 * 1000;

  var STAR_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
    '<path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.72 4.192a.75.75 0 0 1-1.088.791L8 12.347 4.232 14.327a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>' +
    '</svg>';

  function format(n) {
    if (n == null) return '—';
    if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (Date.now() - v.t > TTL_MS) return null;
      return v.s;
    } catch (e) { return null; }
  }

  function writeCache(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ s: value, t: Date.now() })); }
    catch (e) { /* quota / private mode — ignore */ }
  }

  /* ---------- single repo: [data-repo] ---------- */
  document.querySelectorAll('[data-repo]').forEach(function (el) {
    var repo = el.getAttribute('data-repo');
    if (!repo || repo.indexOf('/') === -1) {
      el.setAttribute('data-loaded', 'error');
      return;
    }
    var key = 'gh-stars:' + repo;
    var cached = readCache(key);
    if (cached != null) {
      el.querySelector('.stars-count').textContent = format(cached);
      el.setAttribute('data-loaded', 'ok');
      return;
    }
    fetch('https://api.github.com/repos/' + repo, {
      headers: { 'Accept': 'application/vnd.github+json' }
    })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (data) {
        var s = data.stargazers_count;
        if (typeof s !== 'number') throw 0;
        writeCache(key, s);
        el.querySelector('.stars-count').textContent = format(s);
        el.setAttribute('data-loaded', 'ok');
      })
      .catch(function () { el.setAttribute('data-loaded', 'error'); });
  });

  /* ---------- org series: [data-org] ---------- */
  document.querySelectorAll('[data-org]').forEach(function (el) {
    var org = el.getAttribute('data-org');
    var limit = parseInt(el.getAttribute('data-limit'), 10) || 4;
    var featuredAttr = el.getAttribute('data-featured');
    var featured = featuredAttr
      ? featuredAttr.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      : null;
    if (!org) { el.innerHTML = ''; return; }

    function filterAndOrder(repos) {
      if (!featured) {
        // No allow-list: take top N by stars (already sorted on write).
        return repos.slice(0, limit);
      }
      // Allow-list mode: keep only listed names, preserve config order,
      // skip silently if a featured name isn't found in the org.
      var byName = {};
      repos.forEach(function (r) { byName[r.name.toLowerCase()] = r; });
      var out = [];
      featured.forEach(function (name) {
        var hit = byName[name.toLowerCase()];
        if (hit) out.push(hit);
      });
      return out;
    }

    function render(repos) {
      var items = filterAndOrder(repos);
      if (!items.length) { el.innerHTML = ''; return; }
      el.innerHTML = items.map(function (r) {
        return (
          '<li class="repo-item" title="' + escapeHtml(r.desc || r.name) + '">' +
            '<span class="repo-name">' + escapeHtml(r.name) + '</span>' +
            '<span class="repo-stars">' + STAR_SVG +
              '<span>' + format(r.stars) + '</span>' +
            '</span>' +
          '</li>'
        );
      }).join('');
    }

    var key = 'gh-org:' + org;
    var cached = readCache(key);
    if (cached) { render(cached); return; }

    fetch('https://api.github.com/orgs/' + org + '/repos?per_page=100&type=public&sort=updated', {
      headers: { 'Accept': 'application/vnd.github+json' }
    })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (list) {
        var slim = list
          .filter(function (r) { return !r.fork && !r.archived && !r.private; })
          .map(function (r) {
            return {
              name: r.name,
              stars: r.stargazers_count || 0,
              url: r.html_url,
              desc: r.description || ''
            };
          })
          .sort(function (a, b) { return b.stars - a.stars; });
        writeCache(key, slim);
        render(slim);
      })
      .catch(function () { el.innerHTML = ''; });
  });
})();
