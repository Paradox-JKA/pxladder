(function () {
  'use strict';

  var API = window.PARADOX_API;
  var P = new URLSearchParams(location.search);
  var app = document.getElementById('app');
  var navEl = document.getElementById('nav');
  var statusEl = document.getElementById('status');
  var toastEl = document.getElementById('toast');
  var pollTimer = null;
  var SESSION = null; // {display_name, ingame_name, staff_role, email}

  // ---------------------------------------------------------------- credential

  var LS = 'pdx_key';
  function lsGet() { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } }
  function lsSet(v) { try { localStorage.setItem(LS, v); } catch (e) {} }
  function lsClear() { try { localStorage.removeItem(LS); } catch (e) {} }

  // A key arriving in the URL (magic link / invite) is stored, then scrubbed from the bar.
  var urlKey = P.get('k') || P.get('key') || P.get('t') || P.get('s') || '';
  if (urlKey) {
    lsSet(urlKey);
    ['k', 'key', 't', 's'].forEach(function (p) { P.delete(p); });
    var clean = location.pathname + (P.toString() ? '?' + P.toString() : '');
    try { history.replaceState({}, '', clean); } catch (e) {}
  }
  function KEY() { return lsGet(); }

  // ---------------------------------------------------------------- net

  function get(params) {
    if (KEY() && !params.key) params.key = KEY();
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(API + '?' + qs, { method: 'GET' }).then(readJson).catch(netErr);
  }
  function post(body) {
    if (KEY() && !body.key) body.key = KEY();
    return fetch(API, { method: 'POST', body: JSON.stringify(body) }).then(readJson).catch(netErr);
  }
  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'Bad response: ' + t.slice(0, 160) }; }
    });
  }
  function netErr() { return { ok: false, error: 'Network error — check your connection.', net: true }; }
  // Only a real "your key is not valid" answer should sign the user out.
  function authFailed(r) {
    return !r.net && !r.ok && /sign in|signed in|not an organizer|session expired|not valid/i.test(r.error || '');
  }

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(v) {
    if (!v) return '';
    var t = typeof v === 'number' ? v : Date.parse(v);
    if (!t) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function until(v) {
    if (!v) return '';
    var d = Math.round((Date.parse(v) - Date.now()) / 3.6e6);
    if (isNaN(d)) return '';
    return d <= 0 ? 'now' : (d < 48 ? d + 'h' : Math.round(d / 24) + 'd');
  }
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = kind || '';
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 3500);
  }
  function msgBox(t, k) { return '<div class="msg ' + (k || 'info') + '">' + esc(t) + '</div>'; }
  function setStatus(s) { statusEl.textContent = s; }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPoll(fn, ms) { stopPoll(); pollTimer = setInterval(fn, ms || 45000); }
  function nav(items) {
    items = items.filter(Boolean).concat([{ label: 'Rules', href: 'rules.html' }]);
    navEl.innerHTML = items.map(function (i) {
      return '<a class="pill' + (i.on ? ' on' : '') + '" href="' + esc(i.href) + '">' + esc(i.label) + '</a>';
    }).join('');
  }
  function streakCell(n) {
    n = Number(n) || 0;
    if (n > 0) return '<span class="streak-up">W' + n + '</span>';
    if (n < 0) return '<span class="streak-dn">L' + (-n) + '</span>';
    return '<span class="hint">–</span>';
  }
  function stateTag(s) {
    var m = { pending: '', ready: 'amber', reported: 'blue', disputed: 'red', confirmed: 'good', complete: 'good' };
    return '<span class="tag ' + (m[s] || '') + '">' + esc(s) + '</span>';
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (ACTIONS[act]) { e.preventDefault(); ACTIONS[act](b); }
  });
  app.addEventListener('submit', function (e) { e.preventDefault(); });

  // ---------------------------------------------------------------- router

  function route() {
    stopPoll();
    var comp = P.get('comp'), view = P.get('view');

    if (view === 'admin') {
      if (!KEY()) return renderHome('Sign in to reach the organizer console.');
      return get({ fn: 'whoami' }).then(function (r) {
        if (!r.ok) { if (authFailed(r)) lsClear(); return renderHome(r.error); }
        SESSION = r.account;
        return SESSION.staff_role ? renderAdmin() : renderDashboard();
      });
    }
    if (comp && view === 'join') return renderJoin(comp);
    if (comp) return renderCompetition(comp);          // public, no sign-in needed
    if (view === 'register') return renderRegister();
    if (!KEY()) return renderHome();

    get({ fn: 'whoami' }).then(function (r) {
      if (!r.ok) { if (authFailed(r)) lsClear(); return renderHome(r.error); }
      SESSION = r.account;
      renderDashboard();
    });
  }

  // ---------------------------------------------------------------- home / auth

  function renderHome(note) {
    nav([{ label: 'Competitions', href: '?', on: true }]);
    setStatus('');
    get({ fn: 'list' }).then(function (r) {
      var cards = (r.ok ? r.competitions : []).map(function (c) {
        return '<a class="card" href="?comp=' + esc(c.slug) + '"><div class="t">' + esc(c.name) +
          '</div><div class="m">' + esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) + '</div></a>';
      }).join('');
      app.innerHTML =
        (note ? msgBox(note, 'info') : '') +
        '<h1>Paradox competitions</h1><p class="sub">Sign in to join events and report matches.</p>' +
        '<div class="cards">' + cards + '</div>' +
        '<h2>Sign in</h2><div class="panel form-narrow">' +
        '<form id="loginF"><label>With your email</label>' +
        '<input name="email" type="email" placeholder="you@example.com" required>' +
        '<button type="submit">Email me a sign-in link</button>' +
        '<div id="loginMsg"></div></form>' +
        '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">' +
        '<form id="keyF"><label>…or paste your key</label>' +
        '<input name="key" placeholder="the key you saved at signup" autocomplete="off">' +
        '<button class="small ghost" type="submit">Sign in with key</button></form>' +
        '<p class="hint" style="margin-top:14px">New here? <a href="?view=register">Create an account</a>.<br>' +
        'Lost your key and no email on your account? Ask an organizer in Discord to reset it.</p>' +
        '</div>';
      document.getElementById('loginF').addEventListener('submit', function (e) {
        e.preventDefault();
        var em = e.target.email.value.trim();
        document.getElementById('loginMsg').innerHTML = '<p class="hint">Sending…</p>';
        post({ fn: 'login', email: em }).then(function (res) {
          document.getElementById('loginMsg').innerHTML = msgBox(res.message || res.error, res.ok ? 'ok' : 'err');
        });
      });
      document.getElementById('keyF').addEventListener('submit', function (e) {
        e.preventDefault();
        var k = e.target.key.value.trim();
        if (k) { lsSet(k); location.search = ''; }
      });
    });
  }

  function renderRegister() {
    nav([{ label: 'Competitions', href: '?' }, { label: 'Create account', href: '?view=register', on: true }]);
    setStatus('');
    app.innerHTML =
      '<h1>Create your Paradox account</h1>' +
      '<p class="sub">One account for the ladder and every tournament. No password.</p>' +
      '<div class="panel form-narrow"><form id="regF">' +
      '<label>In-game name <span class="hint">— the ONLY thing shown publicly, on the ladder and brackets. Use your JKA name so people can find you.</span></label>' +
      '<input name="ingame_name" maxlength="40" required>' +
      '<label>Private handle <span class="hint">— optional, never shown publicly; organizers use it to find your account. Leave blank to reuse your in-game name.</span></label>' +
      '<input name="display_name" maxlength="40" placeholder="optional">' +
      '<label>Email <span class="hint">— optional. With one you can get your sign-in link re-sent; without one, a lost key means asking an organizer.</span></label>' +
      '<input name="email" type="email" placeholder="optional">' +
      '<button type="submit">Create account</button><div id="regMsg"></div></form></div>';
    var f = document.getElementById('regF');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('regMsg').innerHTML = '<p class="hint">Creating…</p>';
      post({
        fn: 'register', email: f.email.value.trim(),
        display_name: f.display_name.value.trim(), ingame_name: f.ingame_name.value.trim()
      }).then(function (r) {
        if (!r.ok) { document.getElementById('regMsg').innerHTML = msgBox(r.error, 'err'); return; }
        if (!r.key) { document.getElementById('regMsg').innerHTML = msgBox(r.message || 'Check your email.', 'ok'); return; }
        lsSet(r.key);   // signed in now — but make them save the key before moving on
        app.innerHTML =
          '<h1>You’re in, ' + esc(r.account.ingame_name) + '</h1>' +
          msgBox('This is your key. Copy it somewhere safe. It’s the only way back into your account' +
            (r.emailed ? ' — we also emailed you a sign-in link.' : '. There is no email on file, so if you lose it an organizer has to reset you.'), r.emailed ? 'ok' : 'info') +
          '<div class="panel form-narrow"><div class="linkbox mono" id="keyBox">' + esc(r.key) + '</div>' +
          '<div class="inline-actions"><button class="small" data-act="copyKey">Copy key</button>' +
          '<button class="small ghost" data-act="goDash">I’ve saved it — continue</button></div></div>';
      });
    });
  }

  // ---------------------------------------------------------------- public competition view

  function renderCompetition(slug) {
    load();
    startPoll(load, 45000);
    function load() {
      get({ fn: 'state', comp: slug }).then(function (r) {
        if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); return; }
        var c = r.competition;
        nav([
          { label: c.name, href: '?comp=' + slug, on: true },
          KEY() ? { label: 'My dashboard', href: '?' } : { label: 'Sign in to join', href: '?' },
          { label: 'Join', href: '?comp=' + slug + '&view=join' }
        ]);
        setStatus('updated ' + ago(Date.now()) + ' · auto-refresh 45s' + (c.season ? ' · season ' + c.season : ''));
        var head = '<h1>' + esc(c.name) + '</h1><p class="sub">' + esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) +
          ' · best of ' + esc(c.best_of) + ' to ' + esc(c.target_score) + '</p>';
        var noMatches = !(r.matches || []).length;
        var pre = (c.type !== 'ladder' && noMatches) ? entrantsPanel(r) : '';
        var rules = (c.type === 'ladder')
          ? '<p class="hint" style="margin:-8px 0 20px"><a href="rules.html">Full ladder rules →</a></p>'
          : rulesPanel(c, r.config || {}, slug);
        if (c.type === 'ladder') app.innerHTML = head + rules + ladderView(r);
        else if (c.type === 'round_robin') app.innerHTML = head + rules + pre + (noMatches ? '' : roundRobinView(r));
        else app.innerHTML = head + rules + pre + (noMatches ? '' : bracketView(r));
      });
    }
  }

  function nameById(r, id) {
    var p = (r.participants || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.ingame_name : '';
  }
  function rulesPanel(c, cfg, slug) {
    var secs = PXRules.competition(c, cfg);
    var joinUrl = location.origin + location.pathname + '?comp=' + slug + '&view=join';
    var md = PXRules.toMarkdown(c.name, joinUrl, secs);
    return '<h2>Format &amp; rules</h2><div class="panel">' + PXRules.toHtml(secs) +
      '<div class="inline-actions" style="margin-top:14px"><button class="small ghost" data-act="copyRules">Copy for Discord</button></div>' +
      '<textarea id="rulesMd" hidden readonly rows="14" style="margin-top:10px">' + esc(md) + '</textarea></div>';
  }
  function entrantsPanel(r) {
    var e = (r.participants || []).filter(function (p) { return p.status === 'active'; });
    if (!e.length) return '<div class="panel hint">No entrants yet. <a href="?comp=' + esc(r.competition.slug) + '&view=join">Join.</a></div>';
    return '<h2>Entrants (' + e.length + ')</h2><div class="panel"><table><tbody>' +
      e.sort(function (a, b) { return String(a.ingame_name).localeCompare(String(b.ingame_name)); })
        .map(function (p) { return '<tr><td>' + esc(p.ingame_name) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="hint">The bracket is drawn when an organizer starts the tournament.</p></div>';
  }
  function ladderView(r) {
    var s = r.standings || [];
    if (!s.length) return '<div class="panel hint">No players on the ladder yet. <a href="?comp=' + esc(r.competition.slug) + '&view=join">Join it.</a></div>';
    var note = '<p class="hint">Challenge up to ' + r.config.challenge_range + ' positions above you · drop after ' + r.config.inactivity_days + ' days idle.</p>';
    var rows = s.map(function (p) {
      var flags = (p.flags || '').split(/\s+/).filter(Boolean).map(function (f) {
        return '<span class="tag ' + (f === 'inactive' ? '' : 'amber') + '">' + esc(f) + '</span>';
      }).join(' ');
      return '<tr><td class="rank">' + p.position + '</td><td>' + esc(p.ingame_name) + ' ' + flags + '</td>' +
        '<td class="num">' + p.wins + '–' + p.losses + '</td><td class="num">' + streakCell(p.streak) + '</td>' +
        '<td class="hint">' + (p.last_match_at ? ago(p.last_match_at) : 'never') + '</td></tr>';
    }).join('');
    var chal = (r.challenges || []).filter(function (x) { return x.state === 'pending'; });
    var chalHtml = chal.length ? '<h2>Open challenges</h2><div class="panel"><table><tbody>' + chal.map(function (x) {
      return '<tr><td>' + esc(nameById(r, x.challenger_id)) + ' → ' + esc(nameById(r, x.defender_id)) +
        '</td><td class="hint num">accept within ' + until(x.accept_by) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
    return note + '<div class="panel"><table><thead><tr><th>#</th><th>Player</th><th class="num">W–L</th>' +
      '<th class="num">Streak</th><th>Last played</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + chalHtml;
  }
  function roundRobinView(r) {
    var s = r.standings || [];
    var stand = s.length ? '<div class="panel"><table><thead><tr><th>#</th><th>Player</th><th class="num">W–L</th><th class="num">Diff</th></tr></thead><tbody>' +
      s.map(function (p) {
        return '<tr><td class="rank">' + p.rank + '</td><td>' + esc(p.ingame_name) + '</td>' +
          '<td class="num">' + p.w + '–' + p.l + '</td><td class="num">' + (p.rf - p.ra >= 0 ? '+' : '') + (p.rf - p.ra) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="panel hint">Standings appear once matches are played.</div>';
    return '<h2>Standings</h2>' + stand + '<h2>Fixtures</h2>' + fixtureList(r);
  }
  function fixtureList(r) {
    var byRound = {};
    (r.matches || []).forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
    var rounds = Object.keys(byRound).sort(function (a, b) { return a - b; });
    if (!rounds.length) return '<div class="panel hint">No fixtures yet.</div>';
    return rounds.map(function (rd) {
      return '<div class="panel"><h3 style="margin:0 0 8px;color:var(--muted)">Round ' + esc(rd) + '</h3><table><tbody>' +
        byRound[rd].map(function (m) {
          var done = m.state === 'confirmed' || m.state === 'complete';
          return '<tr><td>' + esc(m.slot_a || 'TBD') + ' <span class="hint">vs</span> ' + esc(m.slot_b || 'TBD') + '</td>' +
            '<td class="num">' + (done ? (m.score_a + '–' + m.score_b) : stateTag(m.state)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
  }
  function bracketView(r) {
    var ms = r.matches || [];
    if (!ms.length) return '<div class="panel hint">Bracket not generated yet.</div>';
    var champ = r.competition.winner_id ? msgBox('🏆 Champion: ' + nameById(r, r.competition.winner_id), 'ok') : '';
    function section(title, list) {
      if (!list.length) return '';
      var byRound = {};
      list.forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
      var cols = Object.keys(byRound).sort(function (a, b) { return a - b; }).map(function (rd) {
        return '<div class="round"><h3>' + esc(byRound[rd][0].label || ('Round ' + rd)) + '</h3>' +
          byRound[rd].map(matchMini).join('') + '</div>';
      }).join('');
      return '<h2>' + title + '</h2><div class="rounds">' + cols + '</div>';
    }
    function matchMini(m) {
      var done = m.state === 'confirmed' || m.state === 'complete';
      function side(nm, sc, id) {
        var cls = done ? (m.winner_id === id && id ? 'win' : 'lose') : '';
        return '<div class="side ' + cls + '"><span>' + esc(nm || 'TBD') + '</span><span class="s">' + (done ? esc(sc) : '') + '</span></div>';
      }
      return '<div class="match">' + side(m.slot_a, m.score_a, m.pa_id) + side(m.slot_b, m.score_b, m.pb_id) +
        (done ? '' : '<div class="foot">' + esc(m.state) + '</div>') + '</div>';
    }
    var hasB = ms.some(function (m) { return m.bracket; });
    if (!hasB) return champ + section('Bracket', ms);
    return champ + section('Winners bracket', ms.filter(function (m) { return m.bracket === 'W'; })) +
      section('Losers bracket', ms.filter(function (m) { return m.bracket === 'L'; })) +
      section('Grand final', ms.filter(function (m) { return m.bracket === 'GF'; }));
  }

  // ---------------------------------------------------------------- join

  function renderJoin(slug) {
    if (!KEY()) {
      nav([{ label: 'Competitions', href: '?' }]);
      app.innerHTML = msgBox('Sign in first, then you can join with one click.', 'info') +
        '<p><a class="btn" href="?">Sign in</a> &nbsp; <a class="btn ghost" href="?view=register">Create account</a></p>' +
        '<p class="hint"><a href="?comp=' + esc(slug) + '">← back to ' + esc(slug) + '</a></p>';
      return;
    }
    get({ fn: 'state', comp: slug }).then(function (r) {
      if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); return; }
      var c = r.competition;
      nav([{ label: c.name, href: '?comp=' + slug }, { label: 'Join', href: '?comp=' + slug + '&view=join', on: true }]);
      var gate = c.type === 'ladder'
        ? 'Joining the ladder needs organizer approval — you’ll be added at the bottom.'
        : 'One click and you’re in.';
      app.innerHTML = '<h1>Join ' + esc(c.name) + '</h1><p class="sub">' + esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) + '</p>' +
        '<div class="panel"><p>' + gate + '</p>' +
        '<button data-act="joinNow" data-c="' + esc(slug) + '">Join ' + esc(c.name) + '</button>' +
        '<div id="joinMsg"></div></div>';
    });
  }

  // ---------------------------------------------------------------- dashboard

  function renderDashboard() {
    load();
    startPoll(load, 45000);
    function load() {
      get({ fn: 'me' }).then(function (r) {
        if (!r.ok) {
          if (authFailed(r)) { lsClear(); return renderHome('Please sign in again.'); }
          setStatus(r.error + ' — retrying…');
          return;
        }
        var a = r.account;
        nav([
          { label: 'Dashboard', href: '?', on: true },
          a.staff_role ? { label: 'Organizer', href: '?view=admin' } : null
        ]);
        setStatus('signed in as ' + a.display_name + ' · updated ' + ago(Date.now()) + ' · auto-refresh 45s');

        var handleBit = (a.display_name && a.display_name !== a.ingame_name) ? ' <span class="hint">handle: ' + esc(a.display_name) + '</span>' : '';
        var html = '<h1>' + esc(a.ingame_name) + handleBit + '</h1>' +
          '<p class="sub">' + (a.email ? esc(a.email) : 'no email') + (a.staff_role ? ' · ' + esc(a.staff_role) : '') +
          ' &nbsp; <a href="#" data-act="logout">log out</a> · <a href="#" data-act="editProfile">account</a></p>' +
          '<div id="profileBox"></div>';

        // join
        if ((r.joinable || []).length) {
          html += '<h2>Join an event</h2><div class="panel"><table><tbody>' + r.joinable.map(function (c) {
            return '<tr><td>' + esc(c.name) + ' <span class="hint">' + esc(c.type.replace('_', ' ')) + '</span></td>' +
              '<td class="num"><button class="small" data-act="joinNow" data-c="' + esc(c.slug) + '">Join</button></td></tr>';
          }).join('') + '</tbody></table></div>';
        }

        // enrollments
        html += '<h2>Your competitions</h2>';
        html += (r.enrollments || []).length ? '<div class="panel"><table><tbody>' + r.enrollments.map(function (e) {
          var extra = e.comp_type === 'ladder' && e.status === 'active' ? '#' + e.position
            : e.status === 'active' ? e.wins + '–' + e.losses : e.status;
          return '<tr><td><a href="?comp=' + esc(e.comp_slug) + '">' + esc(e.comp_name) + '</a> ' +
            '<span class="hint">' + esc(e.comp_type.replace('_', ' ')) + '</span></td>' +
            '<td class="num hint">' + esc(extra) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="panel hint">Not in anything yet — join an event above.</div>';

        // matches
        html += '<h2>Your matches</h2>';
        var mine = r.matches || [];
        if (!mine.length) html += '<div class="panel hint">Nothing to play right now.</div>';
        else mine.forEach(function (m) { html += playerMatchCard(m, r.my_participant_ids || []); });

        // ladder
        if (r.ladder) html += ladderChallengeUI(r.ladder);

        app.innerHTML = html;
      });
    }
  }

  function playerMatchCard(m, myIds) {
    var iAmA = myIds.indexOf(m.pa_id) >= 0;
    var myName = iAmA ? m.slot_a : m.slot_b, oppName = iAmA ? m.slot_b : m.slot_a;
    var cName = m.comp ? m.comp.name : '';
    var head = '<div class="vs"><b>' + esc(myName) + '</b> vs <b>' + esc(oppName) + '</b> ' + stateTag(m.state) +
      (cName ? ' <span class="hint">' + esc(cName) + '</span>' : '') + '</div>';
    var body = '';
    if (m.state === 'ready') {
      body = reportForm(m);
    } else if (m.state === 'reported') {
      if (myIds.indexOf(m.reported_by) >= 0) {
        body = '<p class="hint">You reported ' + esc(m.score_a + '–' + m.score_b) + '. Waiting for ' + esc(oppName) + ' to confirm.</p>';
      } else {
        body = '<p>Opponent reported <b>' + esc(m.slot_a + ' ' + m.score_a + ' – ' + m.score_b + ' ' + m.slot_b) + '</b>.</p>' +
          '<div class="inline-actions"><button class="small" data-act="confirm" data-m="' + m.id + '">Confirm</button>' +
          '<button class="small ghost" data-act="disputeOpen" data-m="' + m.id + '">Dispute</button></div><div id="disp_' + m.id + '"></div>';
      }
    } else if (m.state === 'disputed') {
      body = msgBox('Under review by an organizer. Add your screenshot / demo link:', 'info') + evidenceForm(m);
    }
    return '<div class="match-card">' + head + (m.server ? '<p class="hint">Server: ' + esc(m.server) + '</p>' : '') + body + '</div>';
  }
  function reportForm(m) {
    return '<form data-reportform="' + m.id + '"><div class="row2">' +
      '<div><label>' + esc(m.slot_a) + ' score</label><input name="sa" type="number" min="0" required></div>' +
      '<div><label>' + esc(m.slot_b) + ' score</label><input name="sb" type="number" min="0" required></div></div>' +
      '<label>Screenshot / demo link (optional unless disputed)</label><input name="ev" type="url" placeholder="https://...">' +
      '<button class="small" data-act="report" data-m="' + m.id + '">Report result</button></form>';
  }
  function evidenceForm(m) {
    return '<form data-evform="' + m.id + '"><label>Evidence link</label><input name="ev" type="url" placeholder="https://..." required>' +
      '<button class="small" data-act="evidence" data-m="' + m.id + '">Submit evidence</button></form>';
  }
  function ladderChallengeUI(L) {
    var html = '<h2>Ladder — you are #' + L.position + '</h2>';
    if ((L.my_challenges || []).length) {
      html += '<div class="panel">' + L.my_challenges.map(function (x) {
        if (x.incoming && x.state === 'pending') {
          return '<div class="match-card"><div class="vs"><b>' + esc(x.challenger) + '</b> challenged you</div>' +
            '<p class="hint">Respond within ' + until(x.accept_by) + ' or auto-forfeit.</p>' +
            '<div class="inline-actions"><button class="small" data-act="accept" data-c="' + x.id + '">Accept</button>' +
            '<button class="small ghost" data-act="decline" data-c="' + x.id + '">Decline (cede position)</button></div></div>';
        }
        return '<div class="match-card"><div class="vs">' + (x.incoming ? 'From <b>' + esc(x.challenger) + '</b>' : 'You challenged <b>' + esc(x.defender) + '</b>') +
          ' — ' + esc(x.state) + '</div><p class="hint">accept-by ' + until(x.accept_by) + '</p></div>';
      }).join('') + '</div>';
    }
    html += '<h3 style="color:var(--muted)">Who you can challenge</h3>';
    if (!L.can_challenge) html += '<div class="panel hint">You have an active challenge or you’re on cooldown.</div>';
    else if (!(L.challengeable || []).length) html += '<div class="panel hint">Nobody in range right now.</div>';
    else html += '<div class="panel"><table><tbody>' + L.challengeable.map(function (p) {
      return '<tr><td class="rank">' + p.position + '</td><td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) + '</span></td>' +
        '<td class="num">' + p.wins + '–' + p.losses + '</td>' +
        '<td class="num"><button class="small" data-act="challenge" data-p="' + p.id + '">Challenge</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    return html;
  }

  // ---------------------------------------------------------------- admin

  function renderAdmin() {
    var comp = P.get('comp') || '';
    load();
    function load() {
      var q = { fn: 'admin' };
      if (comp) q.comp = comp;
      get(q).then(function (r) {
        if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); nav([{ label: 'Dashboard', href: '?' }]); return; }
        nav([{ label: 'Dashboard', href: '?' }, { label: 'Organizer', href: '?view=admin', on: !comp }].concat(
          r.competitions.map(function (c) {
            return { label: c.name, href: '?view=admin&comp=' + c.slug, on: comp === c.slug };
          })
        ));
        setStatus('organizer · ' + r.role + ' · updated ' + ago(Date.now()));
        var html = '<h1>Organizer console</h1>';
        if (!comp) html += '<p class="sub">Pick a competition above, or create one.</p>' +
          needsAttention(r) + createForm(r.role) +
          (r.role === 'admin' ? staffSection() + systemSettings(r.settings || []) : '');
        else if (r.competition) html += adminCompView(r);
        app.innerHTML = html;
        wireCreate();
        if (!comp && r.role === 'admin') { loadStaff(); wireSettings(); }
        if (comp && r.competition) wireCompEdit(r.competition);
      });
    }
  }

  function needsAttention(r) {
    var pend = r.pending_all || [], disp = r.disputes_count || 0;
    if (!pend.length && !disp) return '';
    var h = '<h2>Needs attention</h2><div class="panel">';
    if (disp) h += '<p>' + disp + ' disputed match' + (disp === 1 ? '' : 'es') + ' — open the competition to rule.</p>';
    if (pend.length) {
      h += '<table><tbody>' + pend.map(function (p) {
        return '<tr><td>' + esc(p.ingame_name) + ' <span class="hint">wants into ' + esc(p.comp_name) + '</span></td>' +
          '<td class="num"><div class="inline-actions">' +
          '<button class="small" data-act="approve" data-p="' + p.participant_id + '" data-c="' + esc(p.comp_slug) + '">Approve</button>' +
          '<button class="small ghost" data-act="reject" data-p="' + p.participant_id + '" data-c="' + esc(p.comp_slug) + '">Reject</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    }
    return h + '</div>';
  }

  function createForm(role) {
    if (role !== 'admin') return '<div class="panel hint">Only admins can create competitions.</div>';
    return '<h2>New competition</h2><div class="panel form-narrow"><form id="crF">' +
      '<label>Name</label><input name="name" required>' +
      '<div class="row2"><div><label>Format</label><select name="type">' +
      '<option value="single_elim">Single elimination</option><option value="double_elim">Double elimination</option>' +
      '<option value="round_robin">Round robin</option></select></div>' +
      '<div><label>Confirm mode</label><select name="confirm_mode">' +
      '<option value="opponent">Opponent confirms</option><option value="mutual">Both report</option><option value="trust">Trust (instant)</option></select></div></div>' +
      '<div class="row3"><div><label>Best of</label><input name="best_of" type="number" value="3" min="1"></div>' +
      '<div><label>Target</label><input name="target_score" type="number" value="10" min="1"></div>' +
      '<div><label>Evidence</label><select name="evidence_policy">' +
      '<option value="dispute_only">On dispute only</option><option value="none">None</option>' +
      '<option value="screenshot">Screenshot</option><option value="demo">Demo</option></select></div></div>' +
      '<button type="submit">Create</button><div id="crMsg"></div></form></div>';
  }
  function wireCreate() {
    var f = document.getElementById('crF');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('crMsg').innerHTML = '<p class="hint">Creating…</p>';
      post({
        fn: 'create', name: f.name.value.trim(), type: f.type.value, confirm_mode: f.confirm_mode.value,
        evidence_policy: f.evidence_policy.value, best_of: f.best_of.value, target_score: f.target_score.value
      }).then(function (r) {
        if (!r.ok) { document.getElementById('crMsg').innerHTML = msgBox(r.error, 'err'); return; }
        location.search = '?view=admin&comp=' + r.slug;
      });
    });
  }

  function systemSettings(list) {
    if (!list.length) return '';
    return '<h2>Ladder &amp; system settings</h2><div class="panel"><form id="setF"><table><tbody>' +
      list.map(function (s) {
        return '<tr><td class="hint">' + esc(s.key) + '</td><td><input name="' + esc(s.key) + '" value="' + esc(s.value) + '"></td></tr>';
      }).join('') + '</tbody></table><button class="small" type="submit">Save settings</button><div id="setMsg"></div></form></div>';
  }
  function wireSettings() {
    var f = document.getElementById('setF');
    if (!f || f._wired) return;
    f._wired = true;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var inputs = Array.prototype.slice.call(f.querySelectorAll('input'));
      document.getElementById('setMsg').innerHTML = '<p class="hint">Saving ' + inputs.length + '…</p>';
      var chain = Promise.resolve();
      inputs.forEach(function (i) {
        chain = chain.then(function () { return post({ fn: 'config_set', ckey: i.name, value: i.value }); });
      });
      chain.then(function () { document.getElementById('setMsg').innerHTML = msgBox('Saved.', 'ok'); });
    });
  }

  function staffSection() {
    return '<h2>Staff</h2><div class="panel"><div id="staffList" class="hint">Loading…</div>' +
      '<form id="staffF" style="margin-top:12px"><div class="row2">' +
      '<div><label>Email</label><input name="email" type="email" required></div>' +
      '<div><label>Role</label><select name="role"><option value="mod">mod</option><option value="admin">admin</option><option value="none">none (remove)</option></select></div>' +
      '</div><button class="small" type="submit">Set role</button><div id="staffMsg"></div></form></div>' +
      '<h2>Recover a member</h2><div class="panel">' +
      '<p class="hint">Someone lost their key. Look them up, then reset it and send them the new link.</p>' +
      '<form id="recF"><div class="row2">' +
      '<div><label>Display name or email</label><input name="who" required></div>' +
      '<div style="align-self:end"><button class="small ghost" data-act="acctFind">Look up</button> ' +
      '<button class="small" data-act="acctReset">Reset key</button></div></div>' +
      '<div id="recMsg"></div></form></div>';
  }
  function loadStaff() {
    post({ fn: 'staff_list' }).then(function (r) {
      var el = document.getElementById('staffList');
      if (!el) return;
      if (!r.ok) { el.innerHTML = msgBox(r.error, 'err'); return; }
      el.innerHTML = '<table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Last seen</th></tr></thead><tbody>' +
        r.staff.map(function (s) {
          return '<tr><td>' + esc(s.email) + '</td><td>' + esc(s.display_name) + '</td><td>' + esc(s.role) +
            '</td><td class="hint">' + (s.last_seen ? ago(s.last_seen) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
    var f = document.getElementById('staffF');
    if (f && !f._wired) {
      f._wired = true;
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        document.getElementById('staffMsg').innerHTML = '<p class="hint">Saving…</p>';
        post({ fn: 'staff_set', email: f.email.value.trim(), role: f.role.value }).then(function (r) {
          document.getElementById('staffMsg').innerHTML = msgBox(r.ok ? 'Done.' + (r.invite_link ? ' Invite: ' + r.invite_link : '') : r.error, r.ok ? 'ok' : 'err');
          if (r.ok) loadStaff();
        });
      });
    }
  }

  function adminCompView(r) {
    var c = r.competition;
    var parts = r.participants || [], pend = r.pending || [], disp = r.disputes || [], matches = r.matches || [];
    var active = parts.filter(function (p) { return p.status === 'active'; });
    var seeded = c.seeded === 'TRUE' || c.seeded === true;

    var html = '<h1>' + esc(c.name) + '</h1><p class="sub">' + esc(c.type) + ' · ' + esc(c.status) + ' · ' + active.length + ' active</p>';

    html += '<div class="panel"><label>Status</label><div class="inline-actions">' +
      ['signups', 'locked', 'live', 'complete'].map(function (st) {
        return '<button class="small ' + (c.status === st ? '' : 'ghost') + '" data-act="setstatus" data-v="' + st + '" data-c="' + esc(c.slug) + '">' + st + '</button>';
      }).join('') + '</div>';
    if (c.type !== 'ladder' && c.status !== 'live') {
      html += '<div class="inline-actions" style="margin-top:12px">' +
        '<button class="small" data-act="seedRandom" data-c="' + esc(c.slug) + '">Seed randomly</button>' +
        '<button class="small" data-act="start" data-c="' + esc(c.slug) + '"' + (seeded ? '' : ' disabled') + '>Start</button>' +
        '<span class="hint">' + (seeded ? 'seeded ✓' : 'seed before starting') + '</span></div>';
    }
    html += '</div>';

    // edit settings
    html += '<details class="panel"><summary>Edit settings</summary><form id="ceF" style="margin-top:12px">' +
      '<label>Name</label><input name="name" value="' + esc(c.name) + '">' +
      '<div class="row2"><div><label>Confirm mode</label><select name="confirm_mode">' +
      ['opponent', 'mutual', 'trust'].map(function (v) { return '<option' + (c.confirm_mode === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
      '</select></div><div><label>Evidence policy</label><select name="evidence_policy">' +
      ['dispute_only', 'none', 'screenshot', 'demo'].map(function (v) { return '<option' + (c.evidence_policy === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="row2"><div><label>Best of</label><input name="best_of" type="number" min="1" value="' + esc(c.best_of) + '"></div>' +
      '<div><label>Target score</label><input name="target_score" type="number" min="1" value="' + esc(c.target_score) + '"></div></div>' +
      '<label><input type="checkbox" name="auto_approve" style="width:auto"' + (c.auto_approve === 'TRUE' ? ' checked' : '') + '> Auto-approve joins</label>' +
      '<button class="small" data-act="compEdit" data-c="' + esc(c.slug) + '">Save settings</button></form></details>';

    html += '<h2>Pending signups (' + pend.length + ')</h2>';
    html += pend.length ? '<div class="panel"><table><tbody>' + pend.map(function (p) {
      return '<tr><td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) + (p.email ? ' · ' + esc(p.email) : '') + '</span></td>' +
        '<td class="num"><div class="inline-actions"><button class="small" data-act="approve" data-p="' + p.id + '" data-c="' + esc(c.slug) + '">Approve</button>' +
        '<button class="small ghost" data-act="reject" data-p="' + p.id + '" data-c="' + esc(c.slug) + '">Reject</button></div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="panel hint">None waiting.</div>';

    html += '<h2>Disputes (' + disp.length + ')</h2>';
    html += disp.length ? disp.map(function (m) {
      return '<div class="match-card"><div class="vs"><b>' + esc(m.slot_a) + '</b> vs <b>' + esc(m.slot_b) + '</b> ' + stateTag('disputed') + '</div>' +
        (m.dispute_note ? '<p class="hint">Note: ' + esc(m.dispute_note) + '</p>' : '') +
        (m.evidence_a ? '<p class="hint">A: <a href="' + esc(m.evidence_a) + '" target="_blank" rel="noopener">evidence</a></p>' : '') +
        (m.evidence_b ? '<p class="hint">B: <a href="' + esc(m.evidence_b) + '" target="_blank" rel="noopener">evidence</a></p>' : '') +
        '<form data-ruleform="' + m.id + '"><div class="row3">' +
        '<div><label>Winner</label><select name="w"><option value="' + m.pa_id + '">' + esc(m.slot_a) + '</option><option value="' + m.pb_id + '">' + esc(m.slot_b) + '</option></select></div>' +
        '<div><label>' + esc(m.slot_a) + '</label><input name="sa" type="number" min="0" value="' + esc(m.score_a || 0) + '"></div>' +
        '<div><label>' + esc(m.slot_b) + '</label><input name="sb" type="number" min="0" value="' + esc(m.score_b || 0) + '"></div></div>' +
        '<label>Ruling note</label><input name="note"><button class="small" data-act="rule" data-m="' + m.id + '">Apply ruling</button></form></div>';
    }).join('') : '<div class="panel hint">No disputes.</div>';

    var STAT = ['active', 'pending', 'inactive', 'withdrawn', 'banned', 'rejected'];
    html += '<h2>Participants (' + parts.length + ')</h2><div class="panel"><table><thead><tr>' +
      '<th>#</th><th>Player</th><th>Status</th><th></th></tr></thead><tbody>' +
      parts.sort(function (a, b) { return (Number(a.position) || 99) - (Number(b.position) || 99); }).map(function (p) {
        return '<tr><td class="rank">' +
          (c.type === 'ladder'
            ? '<input style="width:52px" name="pos" form="pf_' + p.id + '" value="' + esc(p.position || '') + '">'
            : (p.seed || '–')) + '</td>' +
          '<td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) + (p.email ? ' · ' + esc(p.email) : '') + '</span></td>' +
          '<td><select name="status" form="pf_' + p.id + '">' +
          STAT.map(function (v) { return '<option' + (p.status === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></td>' +
          '<td class="num"><form id="pf_' + p.id + '"><button class="small" data-act="partSet" data-p="' + p.id + '" data-c="' + esc(c.slug) + '">Save</button></form></td></tr>';
      }).join('') + '</tbody></table>' +
      '<form id="paF" style="margin-top:14px"><div class="row3">' +
      '<div><label>Add by account email</label><input name="email" type="email" placeholder="optional"></div>' +
      '<div><label>or Display name</label><input name="display_name"></div>' +
      '<div><label>In-game name</label><input name="ingame_name"></div></div>' +
      '<button class="small" data-act="partAdd" data-c="' + esc(c.slug) + '">Add participant</button><div id="paMsg"></div></form></div>';

    var MST = ['pending', 'ready', 'reported', 'disputed'];
    html += '<h2>Matches (' + matches.length + ')</h2><div class="panel"><table><thead><tr>' +
      '<th>Round</th><th>Match</th><th>State</th><th class="num">Score</th><th></th></tr></thead><tbody>' +
      matches.map(function (m) {
        var done = m.state === 'confirmed' || m.state === 'complete';
        return '<tr><td class="hint">' + esc((m.bracket ? m.bracket + ' ' : '') + (m.label || m.round)) + '</td>' +
          '<td>' + esc(m.slot_a || 'TBD') + ' vs ' + esc(m.slot_b || 'TBD') + '</td>' +
          '<td>' + stateTag(m.state) + '</td>' +
          '<td class="num">' + (m.score_a !== '' ? m.score_a + '–' + m.score_b : '') + '</td>' +
          '<td class="num">' + (done ? '' : '<button class="small ghost" data-act="matchEdit" data-m="' + m.id + '">edit</button>') + '</td></tr>' +
          '<tr id="me_' + m.id + '" hidden><td colspan="5"><form data-matchform="' + m.id + '"><div class="row3">' +
          '<div><label>' + esc(m.slot_a || 'A') + '</label><input name="sa" type="number" min="0" value="' + esc(m.score_a || '') + '"></div>' +
          '<div><label>' + esc(m.slot_b || 'B') + '</label><input name="sb" type="number" min="0" value="' + esc(m.score_b || '') + '"></div>' +
          '<div><label>State</label><select name="state">' + MST.map(function (v) { return '<option' + (m.state === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></div>' +
          '</div><label>Server</label><input name="server" value="' + esc(m.server || '') + '">' +
          '<div class="inline-actions"><button class="small" data-act="matchSave" data-m="' + m.id + '">Save</button>' +
          '<button class="small ghost" data-act="matchSave" data-m="' + m.id + '" data-settle="1">Save &amp; settle</button></div></form></td></tr>';
      }).join('') + '</tbody></table></div>';

    html += '<details class="panel"><summary style="color:var(--accent)">Danger zone</summary>' +
      '<p class="hint">Deleting removes the competition and all its participants, matches and challenges. The ladder cannot be deleted.</p>' +
      '<form id="delF"><label>Type <code>' + esc(c.slug) + '</code> to confirm</label><input name="confirm">' +
      '<button class="small" data-act="compDelete" data-c="' + esc(c.slug) + '">Delete competition</button></form></details>';

    return html;
  }
  function wireCompEdit() { /* forms submit via delegated data-act buttons */ }

  // ---------------------------------------------------------------- actions

  function reload() { route(); }

  function copyText(t, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = o; }, 1500); } };
    try {
      if (navigator.clipboard) { navigator.clipboard.writeText(t).then(done, function () { fallback(); }); }
      else fallback();
    } catch (e) { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e2) {} document.body.removeChild(ta); done();
    }
  }

  var ACTIONS = {
    pasteKey: function () {
      var k = prompt('Paste your key:');
      if (k && k.trim()) { lsSet(k.trim()); location.search = ''; }
    },
    copyRules: function (b) {
      var ta = document.getElementById('rulesMd');
      if (!ta) return;
      ta.hidden = false; ta.focus(); ta.select();
      copyText(ta.value, b);
    },
    copyKey: function (b) { copyText(document.getElementById('keyBox').textContent, b); },
    goDash: function () { location.search = ''; },
    showKey: function (b) {
      var box = document.getElementById('myKeyBox');
      box.textContent = KEY(); box.hidden = false; b.remove();
    },
    copyMyKey: function (b) { copyText(KEY(), b); },
    logout: function () {
      if (!confirm('Log out on this device? Make sure your key is saved — you’ll need it to get back in.')) return;
      lsClear(); location.search = '';
    },
    editProfile: function () {
      document.getElementById('profileBox').innerHTML =
        '<div class="panel form-narrow"><form id="pfF">' +
        '<label>In-game name <span class="hint">(shown publicly)</span></label><input name="ingame_name" value="' + esc(SESSION.ingame_name) + '">' +
        '<label>Private handle <span class="hint">(organizers only)</span></label><input name="display_name" value="' + esc(SESSION.display_name) + '">' +
        '<button class="small" data-act="saveProfile">Save</button></form>' +
        '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">' +
        '<label>Your key <span class="hint">— the only way back into your account. Keep a copy.</span></label>' +
        '<div class="linkbox mono" id="myKeyBox" hidden></div>' +
        '<div class="inline-actions">' +
        '<button class="small ghost" data-act="showKey">Show my key</button>' +
        '<button class="small ghost" data-act="copyMyKey">Copy my key</button></div></div>';
    },
    saveProfile: function () {
      var f = document.getElementById('pfF');
      post({ fn: 'profile', display_name: f.display_name.value.trim(), ingame_name: f.ingame_name.value.trim() })
        .then(function (r) { toast(r.ok ? 'Saved.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    joinNow: function (b) {
      var slug = b.getAttribute('data-c');
      b.disabled = true;
      post({ fn: 'join', comp: slug }).then(function (r) {
        var box = document.getElementById('joinMsg');
        if (box) box.innerHTML = msgBox(r.ok ? (r.message || 'Joined.') : r.error, r.ok ? 'ok' : 'err');
        else toast(r.ok ? (r.message || 'Joined.') : r.error, r.ok ? 'ok' : 'err');
        if (r.ok) setTimeout(function () { location.search = ''; }, 900);
        else b.disabled = false;
      });
    },
    report: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-reportform="' + id + '"]');
      post({ fn: 'report', match_id: id, score_a: f.sa.value, score_b: f.sb.value, evidence_url: f.ev.value.trim() })
        .then(function (r) { toast(r.ok ? (r.message || 'Reported.') : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    confirm: function (b) {
      post({ fn: 'confirm', match_id: b.getAttribute('data-m') }).then(function (r) {
        toast(r.ok ? 'Confirmed.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    disputeOpen: function (b) {
      var id = b.getAttribute('data-m');
      document.getElementById('disp_' + id).innerHTML =
        '<form data-dispform="' + id + '"><label>What happened? (optional)</label><input name="note">' +
        '<label>Screenshot / demo link</label><input name="ev" type="url" placeholder="https://...">' +
        '<button class="small" data-act="dispute" data-m="' + id + '">Submit dispute</button></form>';
    },
    dispute: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-dispform="' + id + '"]');
      post({ fn: 'dispute', match_id: id, note: f.note.value.trim(), evidence_url: f.ev.value.trim() })
        .then(function (r) { toast(r.ok ? 'Flagged.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    evidence: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-evform="' + id + '"]');
      post({ fn: 'dispute', match_id: id, evidence_url: f.ev.value.trim() })
        .then(function (r) { toast(r.ok ? 'Submitted.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    challenge: function (b) {
      post({ fn: 'challenge', defender_id: b.getAttribute('data-p') }).then(function (r) {
        toast(r.ok ? 'Challenge sent.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    accept: function (b) {
      post({ fn: 'accept', challenge_id: b.getAttribute('data-c') }).then(function (r) {
        toast(r.ok ? 'Accepted — go play it.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    decline: function (b) {
      if (!confirm('Decline and cede your ladder position?')) return;
      post({ fn: 'decline', challenge_id: b.getAttribute('data-c') }).then(function (r) {
        toast(r.ok ? 'Declined.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    approve: function (b) { staffAct({ fn: 'approve', comp: b.getAttribute('data-c'), participant_id: b.getAttribute('data-p') }); },
    reject: function (b) { staffAct({ fn: 'reject', comp: b.getAttribute('data-c'), participant_id: b.getAttribute('data-p') }); },
    setstatus: function (b) { staffAct({ fn: 'setstatus', comp: b.getAttribute('data-c'), status: b.getAttribute('data-v') }); },
    seedRandom: function (b) { staffAct({ fn: 'seed', comp: b.getAttribute('data-c'), method: 'random' }); },
    start: function (b) { staffAct({ fn: 'start', comp: b.getAttribute('data-c') }); },
    rule: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-ruleform="' + id + '"]');
      staffAct({ fn: 'rule', match_id: id, winner_id: f.w.value, score_a: f.sa.value, score_b: f.sb.value, note: f.note.value.trim() });
    },
    compEdit: function (b) {
      var f = document.getElementById('ceF');
      staffAct({
        fn: 'comp_edit', comp: b.getAttribute('data-c'),
        name: f.name.value.trim(), confirm_mode: f.confirm_mode.value, evidence_policy: f.evidence_policy.value,
        best_of: f.best_of.value, target_score: f.target_score.value, auto_approve: f.auto_approve.checked
      });
    },
    compDelete: function (b) {
      var f = document.getElementById('delF');
      if (!confirm('Permanently delete this competition and all its data?')) return;
      post({ fn: 'comp_delete', comp: b.getAttribute('data-c'), confirm: f.confirm.value.trim() }).then(function (r) {
        if (!r.ok) { toast(r.error, 'err'); return; }
        toast('Deleted.', 'ok'); location.search = '?view=admin';
      });
    },
    partSet: function (b) {
      var id = b.getAttribute('data-p');
      var f = document.getElementById('pf_' + id);
      var body = { fn: 'participant_set', participant_id: id, status: f.status.value };
      if (f.pos) body.position = f.pos.value;
      staffAct(body);
    },
    partAdd: function (b) {
      var f = document.getElementById('paF');
      document.getElementById('paMsg').innerHTML = '<p class="hint">Adding…</p>';
      post({
        fn: 'participant_add', comp: b.getAttribute('data-c'),
        email: f.email.value.trim(), display_name: f.display_name.value.trim(), ingame_name: f.ingame_name.value.trim()
      }).then(function (r) {
        document.getElementById('paMsg').innerHTML = msgBox(r.ok ? 'Added.' : r.error, r.ok ? 'ok' : 'err');
        if (r.ok) reload();
      });
    },
    matchEdit: function (b) {
      var row = document.getElementById('me_' + b.getAttribute('data-m'));
      if (row) row.hidden = !row.hidden;
    },
    matchSave: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-matchform="' + id + '"]');
      staffAct({
        fn: 'match_set', match_id: id, score_a: f.sa.value, score_b: f.sb.value,
        state: f.state.value, server: f.server.value.trim(), settle: b.getAttribute('data-settle') ? 1 : ''
      });
    },
    acctFind: function () {
      var f = document.getElementById('recF');
      document.getElementById('recMsg').innerHTML = '<p class="hint">Looking…</p>';
      post({ fn: 'account_find', who: f.who.value.trim() }).then(function (r) {
        if (!r.ok) { document.getElementById('recMsg').innerHTML = msgBox(r.error, 'err'); return; }
        var a = r.account;
        document.getElementById('recMsg').innerHTML = msgBox(
          a.display_name + ' · ' + (a.ingame_name || 'no ign') + ' · ' + (a.email || 'no email') +
          ' · ' + (a.staff_role || 'player') + ' · ' + a.status +
          (a.last_seen ? ' · last seen ' + ago(a.last_seen) : '') +
          ' · in ' + (a.enrollments.length) + ' competition(s)', 'info');
      });
    },
    acctReset: function () {
      var f = document.getElementById('recF');
      if (!f.who.value.trim()) { toast('Enter who to reset.', 'err'); return; }
      if (!confirm('Reset this member’s key? Their old key stops working immediately.')) return;
      post({ fn: 'account_reset', who: f.who.value.trim() }).then(function (r) {
        if (!r.ok) { document.getElementById('recMsg').innerHTML = msgBox(r.error, 'err'); return; }
        document.getElementById('recMsg').innerHTML =
          msgBox('Reset ' + r.display_name + '.' + (r.email ? ' Emailed them the new link.' : ' No email on file — send them this:'), 'ok') +
          '<div class="linkbox mono">' + esc(r.link) + '</div>';
      });
    }
  };

  function staffAct(body) {
    post(body).then(function (r) { toast(r.ok ? 'Done.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
  }

  // ---------------------------------------------------------------- go

  if (!API || API.indexOf('script.google.com') < 0) {
    app.innerHTML = msgBox('Set window.PARADOX_API in config.js to your Apps Script /exec URL.', 'err');
  } else {
    route();
  }
})();
