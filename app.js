(function () {
  'use strict';

  const ICS_URL = 'calendar.ics';

  const CATEGORIES = [
    { id: 'msc1', label: 'MSc 1', color: '#0b5cff', match: (s) => /^msc\s*1$/i.test(s) },
    { id: 'premsc', label: 'Pré MSc', color: '#8b5cf6', match: (s) => /^pr[ée]\s*msc/i.test(s) },
    { id: 'kickoff', label: 'Kick-off', color: '#f59e0b', match: (s) => /kick-?off/i.test(s) },
    { id: 'seminar', label: 'Séminaires', color: '#10b981', match: (s) => /s[ée]minaire/i.test(s) },
    { id: 'other', label: 'Événements', color: '#ef4444', match: () => true },
  ];

  const state = {
    events: [],
    hidden: new Set(JSON.parse(localStorage.getItem('hiddenCats') || '[]')),
    query: '',
  };

  // ---------- ICS parsing ----------
  function unfold(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unescapeText(v) {
    return v
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  function parseDate(v) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
    if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }

  function parseICS(text) {
    const lines = unfold(text).split('\n');
    const out = [];
    let cur = null;
    for (const line of lines) {
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
        case 'LOCATION': cur.location = unescapeText(value).trim(); break;
        case 'DTSTART': cur.start = parseDate(value); break;
        case 'DTEND': cur.end = parseDate(value); break;
      }
    }
    return out.filter((e) => e.start);
  }

  function categorize(summary) {
    return CATEGORIES.find((c) => c.match(summary || ''));
  }

  function normalizeTitle(summary) {
    return /^msc\s*1$/i.test(summary) ? 'MSc 1' : summary;
  }

  // ---------- Formatting ----------
  const fmtDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  function durationLabel(ms) {
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
  }

  function relative(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `dans ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `dans ${hours} h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'demain' : `dans ${days} jours`;
  }

  // ---------- Sidebar ----------
  function renderFilters() {
    const wrap = document.getElementById('filters');
    wrap.innerHTML = '';
    for (const cat of CATEGORIES) {
      const count = state.events.filter((e) => e.cat.id === cat.id).length;
      if (!count) continue;
      const label = document.createElement('label');
      label.className = 'filter';
      label.innerHTML = `
        <input type="checkbox" ${state.hidden.has(cat.id) ? '' : 'checked'}>
        <span class="swatch" style="background:${cat.color};border-color:${cat.color}"></span>
        <span class="label">${cat.label}</span>
        <span class="count">${count}</span>`;
      label.querySelector('input').addEventListener('change', (ev) => {
        if (ev.target.checked) state.hidden.delete(cat.id); else state.hidden.add(cat.id);
        localStorage.setItem('hiddenCats', JSON.stringify([...state.hidden]));
        refresh();
      });
      wrap.appendChild(label);
    }
  }

  function renderStats() {
    const now = new Date();
    const evts = visibleEvents();
    const totalMs = evts.reduce((a, e) => a + (e.end - e.start), 0);
    const doneMs = evts.filter((e) => e.end <= now).reduce((a, e) => a + (e.end - e.start), 0);
    const done = evts.filter((e) => e.end <= now).length;
    document.getElementById('stat-total').textContent = evts.length;
    document.getElementById('stat-hours').textContent = Math.round(totalMs / 3600000);
    document.getElementById('stat-done').textContent = done;
    document.getElementById('stat-left').textContent = evts.length - done;
    const pct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-label').textContent =
      `${pct} % des heures effectuées (${Math.round(doneMs / 3600000)} h / ${Math.round(totalMs / 3600000)} h)`;
  }

  function renderNext() {
    const now = new Date();
    const box = document.getElementById('next-event');
    const evts = visibleEvents().sort((a, b) => a.start - b.start);
    const live = evts.find((e) => e.start <= now && e.end > now);
    const next = live || evts.find((e) => e.start > now);
    if (!next) {
      box.innerHTML = '<span class="muted">Aucun cours à venir 🎉</span>';
      return;
    }
    const badge = live
      ? `<span class="countdown live">● En cours · fin à ${fmtTime.format(next.end)}</span>`
      : `<span class="countdown">${relative(next.start - now)}</span>`;
    box.innerHTML = `
      <div class="title" style="color:${next.cat.color}">${escapeHtml(next.title)}</div>
      <div class="when">${fmtShort.format(next.start)}<br>${fmtTime.format(next.start)} – ${fmtTime.format(next.end)}</div>
      ${badge}`;
    box.style.cursor = 'pointer';
    box.onclick = () => {
      calendar.changeView('timeGridWeek', next.start);
    };
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

  function toFcEvents() {
    const now = new Date();
    return visibleEvents().map((e) => ({
      id: e.uid,
      title: e.title,
      start: e.start,
      end: e.end,
      backgroundColor: e.cat.color,
      borderColor: e.cat.color,
      classNames: e.end < now ? ['past'] : [],
      extendedProps: { raw: e },
    }));
  }

  // ---------- Dialog ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function icsStamp(d) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  }

  function openDialog(e) {
    document.getElementById('dlg-title').textContent = e.title;
    document.getElementById('dlg-color').style.background = e.cat.color;
    document.getElementById('dlg-date').textContent = fmtDate.format(e.start);
    document.getElementById('dlg-time').textContent = `${fmtTime.format(e.start)} – ${fmtTime.format(e.end)}`;
    document.getElementById('dlg-duration').textContent = durationLabel(e.end - e.start);
    document.getElementById('dlg-desc').textContent = e.description || '—';

    document.getElementById('dlg-gcal').onclick = () => {
      const url = new URL('https://calendar.google.com/calendar/render');
      url.searchParams.set('action', 'TEMPLATE');
      url.searchParams.set('text', e.title);
      url.searchParams.set('dates', `${icsStamp(e.start)}/${icsStamp(e.end)}`);
      url.searchParams.set('details', e.description || '');
      window.open(url.toString(), '_blank', 'noopener');
    };
    document.getElementById('dlg-ics').onclick = () => {
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
      const blob = new Blob([body], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${e.title.replace(/[^\w\-]+/g, '_')}_${e.start.toISOString().slice(0, 10)}.ics`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    document.getElementById('event-dialog').showModal();
  }

  // ---------- Calendar ----------
  const isMobile = window.matchMedia('(max-width: 700px)').matches;
  const hideWeekends = localStorage.getItem('hideWeekends') !== 'false';
  document.getElementById('hide-weekends').checked = hideWeekends;

  const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
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
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
    eventClick: (info) => openDialog(info.event.extendedProps.raw),
    eventDidMount: (info) => {
      const e = info.event.extendedProps.raw;
      info.el.title = `${e.title}\n${fmtTime.format(e.start)} – ${fmtTime.format(e.end)}`;
    },
    datesSet: (info) => localStorage.setItem('view', info.view.type),
    noEventsContent: 'Aucun cours sur cette période',
  });
  calendar.render();

  function refresh() {
    calendar.removeAllEventSources();
    calendar.addEventSource(toFcEvents());
    renderStats();
    renderNext();
  }

  // ---------- Controls ----------
  let searchTimer;
  document.getElementById('search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = ev.target.value;
      refresh();
    }, 150);
  });

  document.getElementById('hide-weekends').addEventListener('change', (ev) => {
    localStorage.setItem('hideWeekends', ev.target.checked);
    calendar.setOption('weekends', !ev.target.checked);
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme !== 'dark';
    if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
    if (ev.key === 'ArrowLeft') calendar.prev();
    else if (ev.key === 'ArrowRight') calendar.next();
    else if (ev.key === 't') calendar.today();
    else if (ev.key === '/') { ev.preventDefault(); document.getElementById('search').focus(); }
  });

  document.getElementById('event-dialog').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) ev.currentTarget.close();
  });

  // ---------- Load ----------
  fetch(ICS_URL)
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
      setInterval(renderNext, 60000);
    })
    .catch((err) => {
      document.getElementById('next-event').textContent = `Erreur de chargement du calendrier (${err.message})`;
    });
})();
