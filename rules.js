/* Shared rules generator — used by app.js (tournament pages) and rules.html (ladder).
   Everything is derived from a competition's stored settings + the global config,
   so an organizer never writes rules by hand. */
(function () {
  var P = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function typeName(t) {
    return { single_elim: 'Single elimination', double_elim: 'Double elimination',
      round_robin: 'Round robin', ladder: 'Challenge ladder' }[t] || t;
  }
  function typeBlurb(t) {
    return {
      single_elim: 'one loss and you are out.',
      double_elim: 'you are out after two losses — the losers bracket gives you a second life.',
      round_robin: 'everyone plays everyone. Ranked by wins, then head-to-head, then round difference.'
    }[t] || '';
  }
  function reporting(c, cfg) {
    var ac = cfg.auto_confirm_hours || 24;
    if (c.confirm_mode === 'mutual')
      return ['Both players report the score. Matching scores settle it; a mismatch goes to an organizer.'];
    if (c.confirm_mode === 'trust')
      return ['The winner reports the score and it stands. Attach a screenshot or demo if an organizer asks.'];
    return ['The winner reports the score on the site. The loser then confirms it or disputes it.',
      'If the loser does nothing within ' + ac + ' hours, the result auto-confirms.'];
  }
  function evidence(c) {
    return {
      screenshot: 'A scoreboard screenshot is required with every report.',
      demo: 'A demo recording is required with every report.',
      dispute_only: 'Screenshots/demos are only needed if a result is disputed — keep one until the match is confirmed.'
    }[c.evidence_policy] || '';
  }

  /** Rules for a tournament, from its stored settings. */
  P.competition = function (c, cfg) {
    cfg = cfg || {};
    var s = [];
    s.push({ h: 'Format', lines: [typeName(c.type) + (typeBlurb(c.type) ? ' — ' + typeBlurb(c.type) : '')] });
    s.push({ h: 'Matches', lines: [
      'Best of ' + c.best_of + ', to ' + c.target_score + '.',
      'Played on Paradox servers.',
      'Arrange each match with your opponent and play it promptly — organizers may step in on stalled matches.'
    ] });
    var rep = reporting(c, cfg); var ev = evidence(c);
    s.push({ h: 'Reporting', lines: ev ? rep.concat([ev]) : rep });
    s.push({ h: 'Disputes', lines: [
      'Either player can dispute a reported result.',
      'Both sides submit a screenshot or demo; an organizer rules on it.'
    ] });
    s.push({ h: 'Signing up', lines: [
      c.auto_approve === false
        ? 'Registration is reviewed by an organizer before you are in.'
        : 'Open registration — anyone with an account joins instantly.',
      'One entry per person. The bracket is drawn when an organizer starts the tournament.'
    ] });
    return s;
  };

  /** Rules for the challenge ladder, from the global config block. */
  P.ladder = function (cfg, comp) {
    cfg = cfg || {}; comp = comp || {};
    var range = cfg.challenge_range || 4, acc = cfg.accept_days || 3, idle = cfg.inactivity_days || 10,
      rem = cfg.rematch_hours || 48, lcd = cfg.loss_cooldown_hours || 12, dcd = cfg.defense_cooldown_hours || 6,
      acf = cfg.auto_confirm_hours || 24, bo = comp.best_of || 3, ts = comp.target_score || 10;
    return [
      { h: 'Joining', lines: [
        'Anyone with a Paradox account can join — you enter at the bottom.',
        'One ladder spot per person.'
      ] },
      { h: 'Challenging', lines: [
        'You may challenge any player up to ' + range + ' positions above you. Challenges only go up.',
        'One challenge at a time — you cannot stack them or be in two at once.',
        'The challenged player has ' + acc + ' days to accept. No response, or a decline, is an automatic forfeit — the challenger takes their position.',
        'After you lose a challenge, wait ' + lcd + ' hours before starting another.',
        'After you successfully defend, you are safe from new challenges for ' + dcd + ' hours.',
        'No instant rematches — ' + rem + ' hours, or play someone else first, before re-challenging the same player.'
      ] },
      { h: 'Matches', lines: [
        'Best of ' + bo + ', duels to ' + ts + '. Played on Paradox servers.',
        'The winner reports the score. The loser then confirms or disputes.',
        'If the loser does nothing within ' + acf + ' hours, the result auto-confirms.'
      ] },
      { h: 'Moving up', lines: [
        'Win your challenge and you take that player’s position; everyone between shifts down one.',
        'Lose and nothing changes (a cooldown applies).'
      ] },
      { h: 'Disputes', lines: [
        'Either player can dispute a reported result.',
        'Both sides submit a screenshot or demo; an organizer rules on it.'
      ] },
      { h: 'Staying active', lines: [
        'Play at least one match every ' + idle + ' days. Idle longer and you slowly drop down the ladder until you play again.'
      ] },
      { h: 'Seasons', lines: [
        'The ladder runs in seasons. At season end, standings are recorded and the ladder resets.'
      ] }
    ];
  };

  P.toHtml = function (sections) {
    return sections.map(function (sec) {
      return '<h3 style="margin:16px 0 6px">' + esc(sec.h) + '</h3><ul style="margin:0;padding-left:18px">' +
        sec.lines.map(function (l) { return '<li style="margin:3px 0">' + esc(l) + '</li>'; }).join('') + '</ul>';
    }).join('');
  };

  P.toMarkdown = function (title, joinUrl, sections) {
    var out = '# ' + title + '\n';
    if (joinUrl) out += '\n**Sign up / track:** ' + joinUrl + '\n';
    sections.forEach(function (sec) {
      out += '\n## ' + sec.h + '\n' + sec.lines.map(function (l) { return '- ' + l; }).join('\n') + '\n';
    });
    out += '\n_Reporting, challenges and disputes are all handled on the site — not in Discord._\n';
    return out;
  };

  window.PXRules = P;
})();
