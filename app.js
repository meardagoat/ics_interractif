(function () {
  'use strict';

  const ICS_URL = 'calendar.ics';

  const CATEGORIES = [
    { id: 'msc1', label: 'MSc 1', color: '#013afb', text: '#f2f4f8', match: (s) => /^msc\s*1$/i.test(s) },
    { id: 'premsc', label: 'Pré MSc', color: '#ff1ef7', text: '#181818', match: (s) => /^pr[ée]\s*msc/i.test(s) },
    { id: 'kickoff', label: 'Kick-off', color: '#ff5a3a', text: '#181818', match: (s) => /kick-?off/i.test(s) },
    { id: 'seminar', label: 'Séminaires', color: '#00ff97', text: '#181818', match: (s) => /s[ée]minaire/i.test(s) },
    { id: 'other', label: 'Événements', color: '#181818', text: '#f2f4f8', match: () => true },
  ];

  const state = {
    events: [],
    hidden: new Set(JSON.parse(localStorage.getItem('hiddenCats') || '[]')),
    query: '',
    next: null,
  };

  const $ = (id) => document.getElementById(id);

  // Messages read aloud by screen readers (polite live region).
  let announceTimer;
  function announce(msg) {
    const box = $('sr-status');
    clearTimeout(announceTimer);
    box.textContent = '';
    announceTimer = setTimeout(() => { box.textContent = msg; }, 120);
  }
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  // ---------- ICS parsing ----------
  function unfold(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unescapeText(v) {
    return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  function parseDate(v) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
    if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }

  function parseICS(text) {
    const out = [];
    let cur = null;
    for (const line of unfold(text).split('\n')) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
      if (!cur) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = line.slice(idx + 1);
      switch (key) {
        case 'UID': cur.uid = value; break;
        case 'SUMMARY': cur.summary = unescapeText(value).replace(/\s+/g, ' ').trim(); break;
        case 'DESCRIPTION': cur.description = unescapeText(value).split('\n').map((s) => s.trim()).filter(Boolean).join(' · '); break;
        case 'DTSTART': cur.start = parseDate(value); break;
        case 'DTEND': cur.end = parseDate(value); break;
      }
    }
    return out.filter((e) => e.start);
  }

  const categorize = (title) => CATEGORIES.find((c) => c.match(title || ''));
  const normalizeTitle = (s) => (/^msc\s*1$/i.test(s) ? 'MSc 1' : s);

  // ---------- Formatting ----------
  const fmtDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtMarquee = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');

  function durationLabel(ms) {
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h${m ? pad(m) : ''}` : `${m} min`;
  }

  function eventLabel(e) {
    const status = e.end <= new Date() ? ', terminé' : (e.start <= new Date() ? ', en cours' : '');
    const cat = e.cat.label.toLowerCase() === e.title.toLowerCase() ? '' : `, ${e.cat.label}`;
    return `${e.title}${cat}, ${fmtDate.format(e.start)}, de ${fmtTime.format(e.start)} à ${fmtTime.format(e.end)}${status}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Filtering ----------
  function visibleEvents() {
    const q = state.query.trim().toLowerCase();
    return state.events.filter((e) =>
      !state.hidden.has(e.cat.id) &&
      (!q || e.title.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q)));
  }

  function upcomingEvents() {
    const now = new Date();
    return visibleEvents().filter((e) => e.end > now).sort((a, b) => a.start - b.start);
  }

  // ---------- Filters ----------
  function renderFilters() {
    const wrap = $('filters');
    wrap.querySelectorAll('.chip').forEach((c) => c.remove());
    for (const cat of CATEGORIES) {
      const count = state.events.filter((e) => e.cat.id === cat.id).length;
      if (!count) continue;
      const label = document.createElement('label');
      label.className = 'chip';
      label.innerHTML = `
        <input type="checkbox" ${state.hidden.has(cat.id) ? '' : 'checked'}>
        <span class="sw" aria-hidden="true" style="background:${cat.color}"></span>
        <span class="label">${cat.label}</span>
        <span class="count"><span aria-hidden="true">${count}</span><span class="sr-only">, ${plural(count, 'séance', 'séances')}</span></span>`;
      label.querySelector('input').addEventListener('change', (ev) => {
        if (ev.target.checked) state.hidden.delete(cat.id); else state.hidden.add(cat.id);
        localStorage.setItem('hiddenCats', JSON.stringify([...state.hidden]));
        refresh();
        announce(`${cat.label} ${ev.target.checked ? 'affichés' : 'masqués'}. ${plural(visibleEvents().length, 'cours affiché', 'cours affichés')}.`);
      });
      wrap.appendChild(label);
    }
  }

  // ---------- Stats (animated counters) ----------
  let statsShown = false;

  function animateNumber(el, to, duration = 1800) {
    const from = +el.dataset.value || 0;
    el.dataset.value = to;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderStats() {
    const now = new Date();
    const evts = visibleEvents();
    const hours = (list) => list.reduce((a, e) => a + (e.end - e.start), 0) / 3600000;
    const past = evts.filter((e) => e.end <= now);
    const totalH = hours(evts);
    const doneH = hours(past);
    const pct = totalH ? Math.round((doneH / totalH) * 100) : 0;

    state.stats = { total: evts.length, hours: Math.round(totalH), done: past.length, left: evts.length - past.length, pct };
    $('progress-label').textContent = `${Math.round(doneH)} h effectuées sur ${Math.round(totalH)} h au programme`;
    $('stat-total-sr').textContent = `${plural(evts.length, 'séance', 'séances')} au total`;
    $('stat-hours-sr').textContent = `${plural(Math.round(totalH), 'heure', 'heures')} de cours`;
    $('stat-done-sr').textContent = `${plural(past.length, 'séance effectuée', 'séances effectuées')}`;
    $('stat-left-sr').textContent = `${plural(evts.length - past.length, 'séance restante', 'séances restantes')}`;
    const track = $('progress-track');
    track.setAttribute('aria-valuenow', pct);
    track.setAttribute('aria-valuetext', `${pct} % de l'année effectuée`);
    if (statsShown) applyStats();
  }

  function applyStats() {
    const s = state.stats;
    if (!s) return;
    animateNumber($('stat-total'), s.total);
    animateNumber($('stat-hours'), s.hours);
    animateNumber($('stat-done'), s.done);
    animateNumber($('stat-left'), s.left);
    animateNumber($('progress-pct'), s.pct);
    $('progress-bar').style.width = s.pct + '%';
  }

  // ---------- Hero: next course + countdown ----------
  function renderNext() {
    const now = new Date();
    const next = upcomingEvents()[0];
    state.next = next || null;
    const tag = $('next-tag');
    if (!next) {
      tag.textContent = 'Terminé';
      tag.classList.remove('live');
      $('next-title').textContent = 'Plus de cours';
      $('next-when').textContent = 'Aucun cours à venir pour cette sélection.';
      $('countdown').style.display = 'none';
      $('countdown-sr').textContent = '';
      return;
    }
    const live = next.start <= now;
    tag.textContent = live ? '● En cours' : 'Prochain cours';
    tag.classList.toggle('live', live);
    $('next-title').textContent = next.title;
    $('next-when').textContent = `${fmtShort.format(next.start)} · ${fmtTime.format(next.start)} – ${fmtTime.format(next.end)}`;
    $('countdown').style.display = '';
    tickCountdown();
  }

  function tickCountdown() {
    const e = state.next;
    if (!e) return;
    const now = new Date();
    if (now >= e.end || (e.start <= now && !$('next-tag').classList.contains('live'))) {
      refresh();
      return;
    }
    const target = e.start > now ? e.start : e.end;
    let diff = Math.max(0, Math.floor((target - now) / 1000));
    const d = Math.floor(diff / 86400); diff %= 86400;
    const h = Math.floor(diff / 3600); diff %= 3600;
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    const box = $('countdown');
    box.querySelector('[data-u="d"]').textContent = pad(d);
    box.querySelector('[data-u="h"]').textContent = pad(h);
    box.querySelector('[data-u="m"]').textContent = pad(m);
    box.querySelector('[data-u="s"]').textContent = pad(s);

    const parts = [];
    if (d) parts.push(plural(d, 'jour', 'jours'));
    if (h) parts.push(plural(h, 'heure', 'heures'));
    if (!d) parts.push(plural(m, 'minute', 'minutes'));
    const srText = e.start > now ? `Commence dans ${parts.join(' ')}.` : `En cours, se termine dans ${parts.join(' ')}.`;
    const sr = $('countdown-sr');
    if (sr.textContent !== srText) sr.textContent = srText;
  }

  // ---------- Marquee ----------
  function renderMarquee() {
    const items = upcomingEvents().slice(0, 10);
    const track = $('marquee');
    if (!items.length) {
      track.innerHTML = '<span class="marquee-item">Fin du MSc 1 <span class="sep">✦</span></span>'.repeat(12);
      return;
    }
    let html = items.map((e) => `
      <span class="marquee-item">
        <em>${fmtMarquee.format(e.start).replace('.', '')} · ${fmtTime.format(e.start)}</em>
        ${escapeHtml(e.title)}
        <span class="sep">✦</span>
      </span>`).join('');
    while (items.length && html.split('marquee-item').length < 9) html += html;
    track.innerHTML = html + html;
  }

  // ---------- Upcoming list ----------
  function renderUpcoming() {
    const list = $('upcoming');
    const items = upcomingEvents().slice(0, 6);
    if (!items.length) {
      list.innerHTML = '<li class="up-item"><span class="up-title">Aucun cours à venir pour cette sélection</span></li>';
      return;
    }
    list.innerHTML = items.map((e, i) => `
      <li class="up-item">
        <button type="button" class="up-btn" data-uid="${escapeHtml(e.uid)}" data-cursor="Ouvrir" aria-label="${escapeHtml(eventLabel(e))}. Ouvrir la fiche.">
          <span class="up-idx" aria-hidden="true">${pad(i + 1)}</span>
          <span class="up-title"><span class="up-sw" aria-hidden="true" style="background:${e.cat.color}"></span>${escapeHtml(e.title)}</span>
          <span class="up-date">${fmtShort.format(e.start)}<small>${fmtTime.format(e.start)} – ${fmtTime.format(e.end)} · ${durationLabel(e.end - e.start)}</small></span>
          <span class="up-arrow" aria-hidden="true">↗</span>
        </button>
      </li>`).join('');
    list.querySelectorAll('.up-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const e = state.events.find((x) => x.uid === btn.dataset.uid);
        if (e) openDialog(e);
      });
    });
    bindCursorTargets(list);
  }

  // ---------- Dialog ----------
  function icsStamp(d) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  }

  function openDialog(e) {
    $('dlg-cat').textContent = e.cat.label;
    $('dlg-head').style.background = e.cat.color;
    $('dlg-title').textContent = e.title;
    $('dlg-date').textContent = fmtDate.format(e.start);
    $('dlg-time').textContent = `${fmtTime.format(e.start)} – ${fmtTime.format(e.end)}`;
    $('dlg-duration').textContent = durationLabel(e.end - e.start);
    $('dlg-desc').textContent = e.description || '—';
    document.querySelector('#event-dialog .close').style.color = e.cat.text;

    $('dlg-gcal').onclick = () => {
      const url = new URL('https://calendar.google.com/calendar/render');
      url.searchParams.set('action', 'TEMPLATE');
      url.searchParams.set('text', e.title);
      url.searchParams.set('dates', `${icsStamp(e.start)}/${icsStamp(e.end)}`);
      url.searchParams.set('details', e.description || '');
      window.open(url.toString(), '_blank', 'noopener');
    };
    $('dlg-ics').onclick = () => {
      const body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MSc1//Planning//FR',
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${icsStamp(new Date())}`,
        `DTSTART:${icsStamp(e.start)}`,
        `DTEND:${icsStamp(e.end)}`,
        `SUMMARY:${e.title}`,
        `DESCRIPTION:${e.description || ''}`,
        'END:VEVENT', 'END:VCALENDAR',
      ].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
      a.download = `${e.title.replace(/[^\w-]+/g, '_')}_${e.start.toISOString().slice(0, 10)}.ics`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    $('event-dialog').showModal();
  }

  // ---------- Custom cursor ----------
  const cursor = document.querySelector('.cursor');
  const cursorLabel = cursor.querySelector('.cursor-label');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function bindCursorTarget(el) {
    if (!finePointer || el.dataset.cursorBound) return;
    el.dataset.cursorBound = '1';
    el.addEventListener('mouseenter', () => {
      cursorLabel.textContent = el.dataset.cursor || '';
      cursor.classList.add('big');
    });
    el.addEventListener('mouseleave', () => cursor.classList.remove('big'));
  }

  function bindCursorTargets(root = document) {
    root.querySelectorAll('[data-cursor]').forEach(bindCursorTarget);
  }

  if (finePointer) {
    let cx = 0, cy = 0, tx = 0, ty = 0;
    window.addEventListener('mousemove', (ev) => {
      tx = ev.clientX; ty = ev.clientY;
      cursor.classList.add('visible');
    });
    document.addEventListener('mouseleave', () => cursor.classList.remove('visible'));
    const loop = () => {
      cx += (tx - cx) * 0.2;
      cy += (ty - cy) * 0.2;
      cursor.style.transform = `translate(${cx}px, ${cy}px)`;
      requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------- Calendar ----------
  const isMobile = window.matchMedia('(max-width: 700px)').matches;
  const hideWeekends = localStorage.getItem('hideWeekends') !== 'false';
  $('hide-weekends').checked = hideWeekends;

  let calendarReady = false;
  const calendar = new FullCalendar.Calendar($('calendar'), {
    locale: 'fr',
    timeZone: 'local',
    initialView: localStorage.getItem('view') || (isMobile ? 'listWeek' : 'timeGridWeek'),
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: isMobile ? 'dayGridMonth,listWeek' : 'multiMonthYear,dayGridMonth,timeGridWeek,listMonth',
    },
    buttonText: { today: "Aujourd'hui", year: 'Année', month: 'Mois', week: 'Semaine', list: 'Liste' },
    views: {
      multiMonthYear: { multiMonthMaxColumns: 4 },
      listMonth: { buttonText: 'Liste' },
      listWeek: { buttonText: 'Liste' },
    },
    weekends: !hideWeekends,
    nowIndicator: true,
    navLinks: true,
    height: 'auto',
    slotMinTime: '08:00:00',
    slotMaxTime: '19:00:00',
    allDaySlot: false,
    expandRows: true,
    dayMaxEvents: 3,
    eventInteractive: true,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
    eventClick: (info) => openDialog(info.event.extendedProps.raw),
    eventDidMount: (info) => {
      const e = info.event.extendedProps.raw;
      info.el.title = `${e.title} — ${fmtTime.format(e.start)} – ${fmtTime.format(e.end)}`;
      info.el.setAttribute('role', 'button');
      info.el.setAttribute('aria-label', `${eventLabel(e)}. Ouvrir la fiche.`);
      info.el.dataset.cursor = 'Voir';
      bindCursorTarget(info.el);
    },
    datesSet: (info) => {
      localStorage.setItem('view', info.view.type);
      if (!calendarReady) return;
      const n = visibleEvents().filter((e) => e.end > info.start && e.start < info.end).length;
      announce(`${info.view.title} : ${plural(n, 'cours', 'cours')}.`);
    },
    noEventsContent: 'Aucun cours sur cette période',
  });
  calendar.render();

  // Patch FullCalendar markup that screen readers / axe flag.
  function patchCalendarA11y() {
    const root = $('calendar');
    root.querySelectorAll('.fc-icon:not([aria-hidden])').forEach((el) => {
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('role');
    });
    root.querySelectorAll('.fc-more-link:not([role])').forEach((el) => {
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${el.textContent.trim()} cours, afficher tous les cours du jour`);
    });
  }
  new MutationObserver(patchCalendarA11y).observe($('calendar'), { childList: true, subtree: true });
  patchCalendarA11y();

  function toFcEvents() {
    const now = new Date();
    return visibleEvents().map((e) => ({
      id: e.uid,
      title: e.title,
      start: e.start,
      end: e.end,
      backgroundColor: e.cat.color,
      borderColor: e.cat.color,
      textColor: e.cat.text,
      ...(e.end < now ? { backgroundColor: '#e3e6ec', textColor: '#3d414b' } : {}),
      classNames: e.end < now ? ['past'] : [],
      extendedProps: { raw: e },
    }));
  }

  function refresh() {
    calendar.removeAllEventSources();
    calendar.addEventSource(toFcEvents());
    renderStats();
    renderNext();
    renderMarquee();
    renderUpcoming();
  }

  // ---------- Scroll effects ----------
  const nav = document.querySelector('.nav');
  const hero = document.querySelector('.hero');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > hero.offsetHeight - 80);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
      if (en.target.classList.contains('stat') && !statsShown) {
        statsShown = true;
        applyStats();
      }
    }
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // ---------- Controls ----------
  let searchTimer;
  $('search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = ev.target.value;
      refresh();
      const n = visibleEvents().length;
      announce(state.query.trim() ? `${plural(n, 'cours trouvé', 'cours trouvés')}.` : `Recherche effacée, ${plural(n, 'cours affiché', 'cours affichés')}.`);
    }, 400);
  });

  $('hide-weekends').addEventListener('change', (ev) => {
    localStorage.setItem('hideWeekends', ev.target.checked);
    calendar.setOption('weekends', !ev.target.checked);
  });

  $('next-open').addEventListener('click', () => {
    if (!state.next) return;
    calendar.changeView(isMobile ? 'listWeek' : 'timeGridWeek', state.next.start);
    $('calendrier').scrollIntoView({ behavior: 'smooth' });
    $('calendrier').focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // Shortcuts only apply when focus is inside the calendar section (WCAG 2.1.4).
    if (!ev.target.closest || !ev.target.closest('#calendrier')) return;
    if (ev.key === 'ArrowLeft') calendar.prev();
    else if (ev.key === 'ArrowRight') calendar.next();
    else if (ev.key.toLowerCase() === 't') calendar.today();
    else if (ev.key === '/') {
      ev.preventDefault();
      $('calendrier').scrollIntoView({ behavior: 'smooth' });
      $('search').focus({ preventScroll: true });
    }
  });

  $('event-dialog').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) ev.currentTarget.close();
  });

  bindCursorTargets();

  // ---------- Loader + data ----------
  const loaderCount = $('loader-count');
  let loadPct = 0;
  const loaderTimer = setInterval(() => {
    loadPct = Math.min(99, loadPct + Math.ceil(Math.random() * 12));
    loaderCount.textContent = pad(loadPct);
  }, 60);

  function finishLoading() {
    clearInterval(loaderTimer);
    loaderCount.textContent = '100';
    setTimeout(() => {
      document.body.classList.add('loaded');
      document.body.classList.remove('is-loading');
      $('main').setAttribute('aria-busy', 'false');
      calendar.updateSize();
      calendarReady = true;
      const n = state.next;
      if (n) {
        announce(`Planning chargé. ${n.start <= new Date() ? 'Cours en cours' : 'Prochain cours'} : ${eventLabel(n)}.`);
      }
    }, 350);
  }

  const minDelay = new Promise((r) => setTimeout(r, 900));
  const data = fetch(ICS_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      state.events = parseICS(text).map((e) => {
        const title = normalizeTitle(e.summary || 'Sans titre');
        return { ...e, title, end: e.end || e.start, cat: categorize(title) };
      });
      renderFilters();
      refresh();
      setInterval(tickCountdown, 1000);
    })
    .catch((err) => {
      $('next-title').textContent = 'Erreur';
      $('next-when').textContent = `Impossible de charger le calendrier (${err.message})`;
    });

  Promise.all([data, minDelay]).then(finishLoading);
})();
