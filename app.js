(function () {
  'use strict';

  var API = window.PARADOX_API;
  var P = new URLSearchParams(location.search);
  var app = document.getElementById('app');
  var navEl = document.getElementById('nav');
  var statusEl = document.getElementById('status');
  var toastEl = document.getElementById('toast');
  var pollTimer = null;
  var lastRevision = null;

  // ---------------------------------------------------------------- net

  function get(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(API + '?' + qs, { method: 'GET' }).then(readJson);
  }
  function post(body) {
    // text/plain keeps this a "simple request" (no CORS preflight); Apps Script
    // reads the raw body from e.postData.contents.
    return fetch(API, { method: 'POST', body: JSON.stringify(body) }).then(readJson);
  }
  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); }
      catch (e) { return { ok: false, error: 'Bad response from server: ' + t.slice(0, 200) }; }
    });
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
  function msgBox(text, kind) { return '<div class="msg ' + (kind || 'info') + '">' + esc(text) + '</div>'; }
  function setStatus(s) { statusEl.textContent = s; }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPoll(fn, ms) { stopPoll(); pollTimer = setInterval(fn, ms || 45000); }

  function nav(items) {
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

  // delegated click handler for [data-act]
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (ACTIONS[act]) { e.preventDefault(); ACTIONS[act](b); }
  });

  // ---------------------------------------------------------------- router

  function route() {
    stopPoll();
    if (P.get('s')) return renderAdmin();
    if (P.get('t')) return renderPlayer();
    if (P.get('comp') && P.get('view') === 'signup') return renderSignup(P.get('comp'));
    if (P.get('comp')) return renderCompetition(P.get('comp'));
    return renderLanding();
  }

  // ---------------------------------------------------------------- landing

  function renderLanding() {
    nav([{ label: 'Competitions', href: '?', on: true }]);
    setStatus('');
    get({ fn: 'list' }).then(function (r) {
      if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); return; }
      var cards = r.competitions.map(function (c) {
        return '<a class="card" href="?comp=' + esc(c.slug) + '">' +
          '<div class="t">' + esc(c.name) + '</div>' +
          '<div class="m">' + esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) + '</div></a>';
      }).join('');
      app.innerHTML =
        '<h1>Paradox competitions</h1>' +
        '<p class="sub">Pick a competition to view its ladder or bracket.</p>' +
        '<div class="cards">' + cards + '</div>' +
        resendPanel();
      wireResend();
    });
  }

  function resendPanel() {
    return '<h2>Lost your link?</h2>' +
      '<div class="panel"><form id="resendF">' +
      '<label>Email you registered with</label>' +
      '<input name="email" type="email" placeholder="you@example.com" required>' +
      '<button type="submit">Email me my link</button>' +
      '<div id="resendMsg"></div></form></div>';
  }
  function wireResend() {
    var f = document.getElementById('resendF');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = f.email.value.trim();
      document.getElementById('resendMsg').innerHTML = '<p class="hint">Sending…</p>';
      post({ fn: 'resend', email: email }).then(function (r) {
        document.getElementById('resendMsg').innerHTML = msgBox(r.message || r.error, r.ok ? 'ok' : 'err');
      });
    });
  }

  // ---------------------------------------------------------------- competition view

  function renderCompetition(slug) {
    load();
    startPoll(load, 45000);

    function load() {
      get({ fn: 'state', comp: slug }).then(function (r) {
        if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); return; }
        var c = r.competition;
        nav([
          { label: c.name, href: '?comp=' + slug, on: true },
          { label: 'Sign up', href: '?comp=' + slug + '&view=signup' }
        ]);
        setStatus('updated ' + ago(Date.now()) + ' · auto-refresh 45s' +
          (c.season ? ' · season ' + c.season : ''));
        if (r.revision !== lastRevision) { lastRevision = r.revision; }

        var head = '<h1>' + esc(c.name) + '</h1><p class="sub">' +
          esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) +
          ' · best of ' + esc(c.best_of) + ' to ' + esc(c.target_score) + '</p>';

        if (c.type === 'ladder') app.innerHTML = head + ladderView(r);
        else if (c.type === 'round_robin') app.innerHTML = head + roundRobinView(r);
        else app.innerHTML = head + bracketView(r);
      });
    }
  }

  function nameById(r, id) {
    var p = (r.participants || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.display_name : '';
  }

  function ladderView(r) {
    var s = r.standings || [];
    if (!s.length) return '<div class="panel hint">No players on the ladder yet. ' +
      '<a href="?comp=' + esc(r.competition.slug) + '&view=signup">Be the first.</a></div>';
    var rangeNote = '<p class="hint">Challenge up to ' + r.config.challenge_range +
      ' positions above you · drop after ' + r.config.inactivity_days + ' days idle.</p>';
    var rows = s.map(function (p) {
      var flags = (p.flags || '').split(/\s+/).filter(Boolean)
        .map(function (f) { return '<span class="tag ' + (f === 'inactive' ? '' : 'amber') + '">' + esc(f) + '</span>'; }).join(' ');
      return '<tr>' +
        '<td class="rank">' + p.position + '</td>' +
        '<td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) + '</span> ' + flags + '</td>' +
        '<td class="num">' + p.wins + '–' + p.losses + '</td>' +
        '<td class="num">' + streakCell(p.streak) + '</td>' +
        '<td class="hint">' + (p.last_match_at ? ago(p.last_match_at) : 'never') + '</td>' +
        '</tr>';
    }).join('');
    var chal = (r.challenges || []).filter(function (x) { return x.state === 'pending'; });
    var chalHtml = chal.length ? '<h2>Open challenges</h2><div class="panel"><table><tbody>' +
      chal.map(function (x) {
        return '<tr><td>' + esc(nameById(r, x.challenger_id)) + ' → ' + esc(nameById(r, x.defender_id)) +
          '</td><td class="hint num">accept within ' + until(x.accept_by) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '';
    return rangeNote +
      '<div class="panel"><table><thead><tr><th>#</th><th>Player</th><th class="num">W–L</th>' +
      '<th class="num">Streak</th><th>Last played</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      chalHtml;
  }

  function roundRobinView(r) {
    var s = r.standings || [];
    var stand = s.length ? '<div class="panel"><table><thead><tr><th>#</th><th>Player</th>' +
      '<th class="num">W–L</th><th class="num">Diff</th></tr></thead><tbody>' +
      s.map(function (p) {
        return '<tr><td class="rank">' + p.rank + '</td><td>' + esc(p.display_name) +
          ' <span class="hint">' + esc(p.ingame_name) + '</span></td>' +
          '<td class="num">' + p.w + '–' + p.l + '</td>' +
          '<td class="num">' + (p.rf - p.ra >= 0 ? '+' : '') + (p.rf - p.ra) + '</td></tr>';
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
    var winnerId = r.competition.winner_id;
    var champ = winnerId ? msgBox('🏆 Champion: ' + nameById(r, winnerId), 'ok') : '';

    function section(title, list) {
      if (!list.length) return '';
      var byRound = {};
      list.forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
      var cols = Object.keys(byRound).sort(function (a, b) { return a - b; }).map(function (rd) {
        var label = byRound[rd][0].label || ('Round ' + rd);
        return '<div class="round"><h3>' + esc(label) + '</h3>' +
          byRound[rd].map(matchMini).join('') + '</div>';
      }).join('');
      return '<h2>' + title + '</h2><div class="rounds">' + cols + '</div>';
    }
    function matchMini(m) {
      var done = m.state === 'confirmed' || m.state === 'complete';
      function side(nm, sc, id) {
        var cls = done ? (m.winner_id === id && id ? 'win' : 'lose') : '';
        return '<div class="side ' + cls + '"><span>' + esc(nm || 'TBD') + '</span><span class="s">' +
          (done ? esc(sc) : '') + '</span></div>';
      }
      return '<div class="match">' + side(m.slot_a, m.score_a, m.pa_id) + side(m.slot_b, m.score_b, m.pb_id) +
        (done ? '' : '<div class="foot">' + esc(m.state) + '</div>') + '</div>';
    }

    var hasBrackets = ms.some(function (m) { return m.bracket; });
    if (!hasBrackets) return champ + section('Bracket', ms);
    return champ +
      section('Winners bracket', ms.filter(function (m) { return m.bracket === 'W'; })) +
      section('Losers bracket', ms.filter(function (m) { return m.bracket === 'L'; })) +
      section('Grand final', ms.filter(function (m) { return m.bracket === 'GF'; }));
  }

  // ---------------------------------------------------------------- signup

  function renderSignup(slug) {
    nav([
      { label: 'Back to competition', href: '?comp=' + slug },
      { label: 'Sign up', href: '?comp=' + slug + '&view=signup', on: true }
    ]);
    setStatus('');
    get({ fn: 'state', comp: slug }).then(function (r) {
      if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); return; }
      var c = r.competition;
      var closed = c.type !== 'ladder' && ['live', 'complete', 'locked'].indexOf(c.status) >= 0;
      app.innerHTML =
        '<h1>Sign up — ' + esc(c.name) + '</h1>' +
        '<p class="sub">' + esc(c.type.replace('_', ' ')) + ' · ' + esc(c.status) + '</p>' +
        (closed ? msgBox('Signups are closed for this competition.', 'err') :
          '<div class="panel"><form id="suF">' +
          '<label>Display name (shown on the bracket)</label>' +
          '<input name="display_name" maxlength="40" required>' +
          '<label>In-game name (how people find you in JKA)</label>' +
          '<input name="ingame_name" maxlength="40" required>' +
          '<label>Email — for your personal link &amp; notifications (optional but recommended)</label>' +
          '<input name="email" type="email" placeholder="you@example.com">' +
          '<button type="submit">Register</button>' +
          '<p class="hint">One entry per person. Returning ladder players: use “Lost your link?” on the home page.</p>' +
          '<div id="suMsg"></div></form></div>');
      var f = document.getElementById('suF');
      if (f) f.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          fn: 'signup', comp: slug,
          display_name: f.display_name.value.trim(),
          ingame_name: f.ingame_name.value.trim(),
          email: f.email.value.trim()
        };
        document.getElementById('suMsg').innerHTML = '<p class="hint">Submitting…</p>';
        post(body).then(function (res) {
          if (!res.ok) { document.getElementById('suMsg').innerHTML = msgBox(res.error, 'err'); return; }
          if (res.status === 'active' && res.link) {
            document.getElementById('suMsg').innerHTML =
              msgBox('You are in! Bookmark your personal link:', 'ok') +
              '<div class="linkbox mono">' + esc(res.link) + '</div>';
          } else {
            document.getElementById('suMsg').innerHTML = msgBox(res.message || 'Registered.', 'ok');
          }
          f.reset();
        });
      });
    });
  }

  // ---------------------------------------------------------------- player panel

  function renderPlayer() {
    var t = P.get('t');
    load();
    startPoll(load, 45000);

    function load() {
      get({ fn: 'me', t: t }).then(function (r) {
        if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); nav([]); return; }
        var me = r.me, c = r.competition;
        nav([
          { label: 'My panel', href: '?t=' + t, on: true },
          c ? { label: c.name, href: '?comp=' + c.slug } : null
        ].filter(Boolean));
        setStatus('you: ' + me.display_name + ' · updated ' + ago(Date.now()));

        var posLine = (c && c.type === 'ladder')
          ? 'Ladder position <b>#' + me.position + '</b> · ' + me.wins + '–' + me.losses + ' · ' + streakCell(me.streak)
          : me.wins + '–' + me.losses + ' · seed ' + (me.seed || '–');

        var html = '<h1>' + esc(me.display_name) + ' <span class="hint">' + esc(me.ingame_name) + '</span></h1>' +
          '<p class="sub">' + (c ? esc(c.name) + ' · ' : '') + posLine + '</p>';

        html += '<h2>Your matches</h2>';
        if (!r.matches.length) html += '<div class="panel hint">Nothing to play right now.</div>';
        else r.matches.forEach(function (m) { html += playerMatchCard(m, me); });

        if (c && c.type === 'ladder' && me.status === 'active') {
          html += ladderChallengeUI(r, me);
        }
        app.innerHTML = html;
      });
    }
  }

  function playerMatchCard(m, me) {
    var iAmA = m.pa_id === me.id;
    var myName = iAmA ? m.slot_a : m.slot_b;
    var oppName = iAmA ? m.slot_b : m.slot_a;
    var head = '<div class="vs"><b>' + esc(myName) + '</b> vs <b>' + esc(oppName) + '</b> ' + stateTag(m.state) + '</div>';
    var body = '';

    if (m.state === 'ready') {
      body = reportForm(m);
    } else if (m.state === 'reported') {
      if (m.reported_by === me.id) {
        body = '<p class="hint">You reported ' + esc(m.score_a + '–' + m.score_b) +
          '. Waiting for ' + esc(oppName) + ' to confirm (auto-confirms if they do nothing).</p>';
      } else {
        body = '<p>Your opponent reported <b>' + esc(m.slot_a + ' ' + m.score_a + ' – ' + m.score_b + ' ' + m.slot_b) + '</b>.</p>' +
          '<div class="inline-actions">' +
          '<button class="small" data-act="confirm" data-m="' + m.id + '">Confirm result</button>' +
          '<button class="small ghost" data-act="disputeOpen" data-m="' + m.id + '">Dispute</button></div>' +
          '<div id="disp_' + m.id + '"></div>';
      }
    } else if (m.state === 'disputed') {
      body = msgBox('Under review by an organizer. Add your screenshot / demo link below.', 'info') +
        evidenceForm(m);
    }
    return '<div class="match-card" data-mid="' + m.id + '">' + head +
      (m.server ? '<p class="hint">Server: ' + esc(m.server) + '</p>' : '') + body + '</div>';
  }

  function reportForm(m) {
    return '<form data-reportform="' + m.id + '">' +
      '<div class="row2">' +
      '<div><label>' + esc(m.slot_a) + ' score</label><input name="sa" type="number" min="0" required></div>' +
      '<div><label>' + esc(m.slot_b) + ' score</label><input name="sb" type="number" min="0" required></div>' +
      '</div>' +
      '<label>Screenshot / demo link (optional unless disputed)</label>' +
      '<input name="ev" type="url" placeholder="https://...">' +
      '<button class="small" data-act="report" data-m="' + m.id + '">Report result</button>' +
      '<span id="rep_' + m.id + '" class="hint"></span></form>';
  }
  function evidenceForm(m) {
    return '<form data-evform="' + m.id + '">' +
      '<label>Evidence link</label><input name="ev" type="url" placeholder="https://..." required>' +
      '<button class="small" data-act="evidence" data-m="' + m.id + '">Submit evidence</button>' +
      '<span id="ev_' + m.id + '" class="hint"></span></form>';
  }

  function ladderChallengeUI(r, me) {
    var html = '<h2>Challenges</h2>';
    var mine = r.my_challenges || [];
    if (mine.length) {
      html += '<div class="panel">' + mine.map(function (x) {
        var who = x.incoming ? nameById(r, x.challenger_id) : nameById(r, x.defender_id);
        if (x.incoming && x.state === 'pending') {
          return '<div class="match-card"><div class="vs"><b>' + esc(who) + '</b> challenged you</div>' +
            '<p class="hint">Respond by ' + until(x.accept_by) + ' or it is an automatic forfeit.</p>' +
            '<div class="inline-actions">' +
            '<button class="small" data-act="accept" data-c="' + x.id + '">Accept</button>' +
            '<button class="small ghost" data-act="decline" data-c="' + x.id + '">Decline (cede position)</button>' +
            '</div></div>';
        }
        return '<div class="match-card"><div class="vs">' +
          (x.incoming ? 'From <b>' + esc(who) + '</b>' : 'You challenged <b>' + esc(who) + '</b>') +
          ' — ' + esc(x.state) + '</div><p class="hint">accept-by ' + until(x.accept_by) + '</p></div>';
      }).join('') + '</div>';
    }

    html += '<h2>Who you can challenge</h2>';
    var list = r.challengeable || [];
    if (!r.can_challenge) {
      html += '<div class="panel hint">You have an active challenge or you are on cooldown — resolve that first.</div>';
    } else if (!list.length) {
      html += '<div class="panel hint">Nobody in range right now.</div>';
    } else {
      html += '<div class="panel"><table><tbody>' + list.map(function (p) {
        return '<tr><td class="rank">' + p.position + '</td>' +
          '<td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) + '</span></td>' +
          '<td class="num">' + p.wins + '–' + p.losses + '</td>' +
          '<td class="num"><button class="small" data-act="challenge" data-p="' + p.id + '">Challenge</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    return html;
  }

  // ---------------------------------------------------------------- admin panel

  function renderAdmin() {
    var s = P.get('s');
    var comp = P.get('comp') || '';
    load();

    function load() {
      var q = { fn: 'admin', s: s };
      if (comp) q.comp = comp;
      get(q).then(function (r) {
        if (!r.ok) { app.innerHTML = msgBox(r.error, 'err'); nav([]); return; }
        nav([{ label: 'Admin (' + r.role + ')', href: '?s=' + s, on: !comp }].concat(
          r.competitions.map(function (c) {
            return { label: c.name, href: '?s=' + s + '&comp=' + c.slug, on: comp === c.slug };
          })
        ));
        setStatus('admin · ' + r.role + ' · updated ' + ago(Date.now()));

        var html = '<h1>Organizer console</h1>';
        if (!comp) {
          html += '<p class="sub">Pick a competition above, or create one.</p>' + createForm(r.role);
        } else if (r.competition) {
          html += adminCompView(r, s);
        }
        app.innerHTML = html;
        wireCreate(s);
      });
    }
  }

  function createForm(role) {
    if (role !== 'admin') return '<div class="panel hint">Only admins can create competitions.</div>';
    return '<h2>New competition</h2><div class="panel"><form id="crF">' +
      '<label>Name</label><input name="name" required>' +
      '<div class="row2">' +
      '<div><label>Format</label><select name="type">' +
      '<option value="single_elim">Single elimination</option>' +
      '<option value="double_elim">Double elimination</option>' +
      '<option value="round_robin">Round robin</option></select></div>' +
      '<div><label>Confirm mode</label><select name="confirm_mode">' +
      '<option value="opponent">Opponent confirms</option>' +
      '<option value="mutual">Both report</option>' +
      '<option value="trust">Trust (instant)</option></select></div>' +
      '</div>' +
      '<div class="row3">' +
      '<div><label>Best of</label><input name="best_of" type="number" value="3" min="1"></div>' +
      '<div><label>Target score</label><input name="target_score" type="number" value="10" min="1"></div>' +
      '<div><label>Evidence</label><select name="evidence_policy">' +
      '<option value="dispute_only">On dispute only</option>' +
      '<option value="none">None</option>' +
      '<option value="screenshot">Screenshot required</option>' +
      '<option value="demo">Demo required</option></select></div>' +
      '</div>' +
      '<label><input type="checkbox" name="auto_approve" style="width:auto"> Auto-approve signups (skip the queue)</label>' +
      '<button type="submit">Create</button><div id="crMsg"></div></form></div>';
  }
  function wireCreate(s) {
    var f = document.getElementById('crF');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        fn: 'create', s: s, name: f.name.value.trim(), type: f.type.value,
        confirm_mode: f.confirm_mode.value, evidence_policy: f.evidence_policy.value,
        best_of: f.best_of.value, target_score: f.target_score.value,
        auto_approve: f.auto_approve.checked
      };
      document.getElementById('crMsg').innerHTML = '<p class="hint">Creating…</p>';
      post(body).then(function (r) {
        if (!r.ok) { document.getElementById('crMsg').innerHTML = msgBox(r.error, 'err'); return; }
        document.getElementById('crMsg').innerHTML =
          msgBox('Created. Signup link:', 'ok') + '<div class="linkbox mono">' + esc(r.signup_url) + '</div>';
        setTimeout(function () { location.search = '?s=' + s + '&comp=' + r.slug; }, 1200);
      });
    });
  }

  function adminCompView(r, s) {
    var c = r.competition;
    var parts = r.participants || [], pend = r.pending || [], disp = r.disputes || [], matches = r.matches || [];
    var active = parts.filter(function (p) { return p.status === 'active'; });

    var html = '<h1>' + esc(c.name) + '</h1><p class="sub">' + esc(c.type) + ' · ' + esc(c.status) +
      ' · ' + active.length + ' active</p>';

    // status control
    html += '<div class="panel"><label>Competition status</label><div class="inline-actions">' +
      ['signups', 'locked', 'live', 'complete'].map(function (st) {
        return '<button class="small ' + (c.status === st ? '' : 'ghost') + '" data-act="setstatus" data-v="' + st + '">' + st + '</button>';
      }).join('') + '</div>';
    if (c.type !== 'ladder' && c.status !== 'live') {
      html += '<div class="inline-actions" style="margin-top:12px">' +
        '<button class="small" data-act="seedRandom">Seed randomly</button>' +
        '<button class="small" data-act="start"' + (c.seeded === 'TRUE' || c.seeded === true ? '' : ' disabled') + '>Start tournament</button>' +
        '<span class="hint">' + (c.seeded === 'TRUE' || c.seeded === true ? 'seeded ✓' : 'seed before starting') + '</span></div>';
    }
    html += '</div>';

    // pending signups
    html += '<h2>Pending signups (' + pend.length + ')</h2>';
    html += pend.length ? '<div class="panel"><table><tbody>' + pend.map(function (p) {
      return '<tr><td>' + esc(p.display_name) + ' <span class="hint">' + esc(p.ingame_name) +
        (p.email ? ' · ' + esc(p.email) : '') + '</span></td>' +
        '<td class="num"><div class="inline-actions">' +
        '<button class="small" data-act="approve" data-p="' + p.id + '">Approve</button>' +
        '<button class="small ghost" data-act="reject" data-p="' + p.id + '">Reject</button></div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="panel hint">None waiting.</div>';

    // disputes
    html += '<h2>Disputes (' + disp.length + ')</h2>';
    html += disp.length ? disp.map(function (m) {
      return '<div class="match-card"><div class="vs"><b>' + esc(m.slot_a) + '</b> vs <b>' + esc(m.slot_b) +
        '</b> ' + stateTag('disputed') + '</div>' +
        (m.dispute_note ? '<p class="hint">Note: ' + esc(m.dispute_note) + '</p>' : '') +
        (m.evidence_a ? '<p class="hint">A: <a href="' + esc(m.evidence_a) + '" target="_blank" rel="noopener">evidence</a></p>' : '') +
        (m.evidence_b ? '<p class="hint">B: <a href="' + esc(m.evidence_b) + '" target="_blank" rel="noopener">evidence</a></p>' : '') +
        '<form data-ruleform="' + m.id + '"><div class="row3">' +
        '<div><label>Winner</label><select name="w"><option value="' + m.pa_id + '">' + esc(m.slot_a) + '</option>' +
        '<option value="' + m.pb_id + '">' + esc(m.slot_b) + '</option></select></div>' +
        '<div><label>' + esc(m.slot_a) + '</label><input name="sa" type="number" min="0" value="' + esc(m.score_a || 0) + '"></div>' +
        '<div><label>' + esc(m.slot_b) + '</label><input name="sb" type="number" min="0" value="' + esc(m.score_b || 0) + '"></div>' +
        '</div><label>Ruling note</label><input name="note">' +
        '<button class="small" data-act="rule" data-m="' + m.id + '">Apply ruling</button>' +
        '<span id="rule_' + m.id + '" class="hint"></span></form></div>';
    }).join('') : '<div class="panel hint">No disputes.</div>';

    // participants + matches (read-only tables)
    html += '<h2>Participants</h2><div class="panel"><table><thead><tr><th>#</th><th>Player</th><th>Email</th><th>Status</th></tr></thead><tbody>' +
      parts.sort(function (a, b) { return (Number(a.position) || 99) - (Number(b.position) || 99); }).map(function (p) {
        return '<tr><td class="rank">' + (p.position || '–') + '</td><td>' + esc(p.display_name) +
          ' <span class="hint">' + esc(p.ingame_name) + '</span></td><td class="hint">' + esc(p.email || '') +
          '</td><td>' + esc(p.status) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    html += '<h2>Matches</h2><div class="panel"><table><thead><tr><th>Round</th><th>Match</th><th>State</th><th class="num">Score</th></tr></thead><tbody>' +
      matches.map(function (m) {
        return '<tr><td class="hint">' + esc((m.bracket ? m.bracket + ' ' : '') + (m.label || m.round)) + '</td>' +
          '<td>' + esc(m.slot_a || 'TBD') + ' vs ' + esc(m.slot_b || 'TBD') + '</td>' +
          '<td>' + stateTag(m.state) + '</td>' +
          '<td class="num">' + (m.score_a !== '' ? m.score_a + '–' + m.score_b : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    return html;
  }

  // ---------------------------------------------------------------- actions

  function reload() { route(); }

  var ACTIONS = {
    report: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-reportform="' + id + '"]');
      var out = document.getElementById('rep_' + id);
      out.textContent = 'sending…';
      post({ fn: 'report', t: P.get('t'), match_id: id, score_a: f.sa.value, score_b: f.sb.value, evidence_url: f.ev.value.trim() })
        .then(function (r) {
          if (!r.ok) { out.textContent = ''; toast(r.error, 'err'); return; }
          toast(r.message || 'Reported.', 'ok'); reload();
        });
    },
    confirm: function (b) {
      post({ fn: 'confirm', t: P.get('t'), match_id: b.getAttribute('data-m') }).then(function (r) {
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
      post({ fn: 'dispute', t: P.get('t'), match_id: id, note: f.note.value.trim(), evidence_url: f.ev.value.trim() })
        .then(function (r) { toast(r.ok ? 'Flagged for an organizer.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    evidence: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-evform="' + id + '"]');
      post({ fn: 'dispute', t: P.get('t'), match_id: id, evidence_url: f.ev.value.trim() })
        .then(function (r) { toast(r.ok ? 'Evidence submitted.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload(); });
    },
    challenge: function (b) {
      post({ fn: 'challenge', t: P.get('t'), defender_id: b.getAttribute('data-p') }).then(function (r) {
        toast(r.ok ? 'Challenge sent.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    accept: function (b) {
      post({ fn: 'accept', t: P.get('t'), challenge_id: b.getAttribute('data-c') }).then(function (r) {
        toast(r.ok ? 'Accepted — go play it.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    decline: function (b) {
      if (!confirm('Decline this challenge? You cede your ladder position.')) return;
      post({ fn: 'decline', t: P.get('t'), challenge_id: b.getAttribute('data-c') }).then(function (r) {
        toast(r.ok ? 'Declined.' : r.error, r.ok ? 'ok' : 'err'); if (r.ok) reload();
      });
    },
    approve: function (b) { staffAct({ fn: 'approve', comp: P.get('comp'), participant_id: b.getAttribute('data-p') }); },
    reject: function (b) { staffAct({ fn: 'reject', comp: P.get('comp'), participant_id: b.getAttribute('data-p') }); },
    setstatus: function (b) { staffAct({ fn: 'setstatus', comp: P.get('comp'), status: b.getAttribute('data-v') }); },
    seedRandom: function () { staffAct({ fn: 'seed', comp: P.get('comp'), method: 'random' }); },
    start: function () { staffAct({ fn: 'start', comp: P.get('comp') }); },
    rule: function (b) {
      var id = b.getAttribute('data-m');
      var f = document.querySelector('[data-ruleform="' + id + '"]');
      staffAct({ fn: 'rule', match_id: id, winner_id: f.w.value, score_a: f.sa.value, score_b: f.sb.value, note: f.note.value.trim() });
    }
  };

  function staffAct(body) {
    body.s = P.get('s');
    post(body).then(function (r) {
      toast(r.ok ? 'Done.' : r.error, r.ok ? 'ok' : 'err');
      if (r.ok) reload();
    });
  }

  // report-form submit via Enter should not reload the page
  app.addEventListener('submit', function (e) { e.preventDefault(); });

  // ---------------------------------------------------------------- go

  if (!API || API.indexOf('script.google.com') < 0) {
    app.innerHTML = msgBox('Set window.PARADOX_API in config.js to your Apps Script /exec URL.', 'err');
  } else {
    route();
  }
})();
