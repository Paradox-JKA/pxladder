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
    if (c.start_date) {
      s.push({ h: 'Schedule', lines: [
        (c.start_tentative === 'TRUE' || c.start_tentative === true ? 'Tentative start: ' : 'Starts: ') + c.start_date +
          (c.start_tentative === 'TRUE' || c.start_tentative === true ? ' (subject to change).' : '.')
      ] });
    }
    s.push({ h: 'Matches', lines: [
      'Best of ' + c.best_of + ', to ' + c.target_score + '.',
      'Played on Paradox servers.',
      'Arrange each match with your opponent and play it promptly — organizers may step in on stalled matches.'
    ].concat(c.report_deadline_days ? ['Once your match is ready to play, you have ' + c.report_deadline_days + ' day(s) to report a result before organizers step in.'] : []) });
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
      (c.team_size > 0
        ? 'Teams of up to ' + c.team_size + '. One player registers for the whole team and reports on its behalf — teammates don’t need their own account unless they want one.'
        : 'One entry per person.') + ' The bracket is drawn when an organizer starts the tournament.'
    ].concat(c.signup_deadline ? ['Signups close ' + c.signup_deadline + '.'] : []) });
    return s;
  };

  /** Rules for the challenge ladder, from the global config block. */
  P.ladder = function (cfg, comp) {
    cfg = cfg || {}; comp = comp || {};
    var range = cfg.challenge_range || 4, acc = cfg.accept_days || 3, idle = cfg.inactivity_days || 10,
      rem = cfg.rematch_hours || 48,
      acf = cfg.auto_confirm_hours || 24, bo = comp.best_of || 3, ts = comp.target_score || 10,
      mrd = cfg.ladder_match_reminder_days || 3, mdd = cfg.ladder_match_deadline_days || 7,
      tl = cfg.match_time_limit_minutes || 0, noSw = cfg.no_saber_switching === 'TRUE' || cfg.no_saber_switching === true,
      teamSize = comp.team_size || 0;
    return [
      { h: 'Joining', lines: teamSize > 0 ? [
        'Teams of up to ' + teamSize + ' — one player registers for the whole team and enters at the bottom.',
        'Teammates don’t need their own account unless they want one; the registering player reports and challenges on the team’s behalf.',
        'One ladder spot per team.'
      ] : [
        'Anyone with a Paradox account can join — you enter at the bottom.',
        'One ladder spot per person.'
      ] },
      { h: 'Challenging', lines: [
        'You may challenge any player up to ' + range + ' positions above you. Challenges only go up.',
        'One challenge at a time — you cannot stack them or be in two at once.',
        'The challenged player has ' + acc + ' days to accept. No response, or a decline, is an automatic forfeit — the challenger takes their position.',
        'No instant rematches — ' + rem + ' hours, or play someone else first, before re-challenging the same player. You can still challenge someone else right away.'
      ] },
      { h: 'Matches', lines: [
        'Best of ' + bo + ', duels to ' + ts + '. Played on Paradox servers.'
      ].concat(tl ? ['Each duel is capped at ' + tl + ' minutes.'] : [])
        .concat(noSw ? ['No switching saber styles or hilts mid-duel — lock your loadout for the whole match (ESL ruleset).'] : [])
        .concat([
        'The winner reports the score. The loser then confirms or disputes.',
        'If the loser does nothing within ' + acf + ' hours, the result auto-confirms.',
        'Once a challenge is accepted, play it. You’ll get a reminder after ' + mrd + ' days.',
        'If it still hasn’t been played after ' + mdd + ' days, the challenge expires and BOTH players drop one position — no fault-finding, so don’t accept a challenge you don’t intend to actually play.'
      ]) },
      { h: 'Moving up', lines: [
        'Win your challenge and you take that player’s position; everyone between shifts down one.',
        'Lose and nothing changes (a cooldown applies).'
      ] },
      { h: 'Disputes', lines: [
        'Either player can dispute a reported result.',
        'Both sides submit a screenshot or demo; an organizer rules on it.'
      ] },
      { h: 'Staying active', lines: [
        'Play at least one match every ' + idle + ' days. Idle longer and you slowly drop down the ladder until you play again.',
        'The #1 spot is exempt — you can only be challenged there, never initiate, so you can’t be dropped for inactivity.'
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
