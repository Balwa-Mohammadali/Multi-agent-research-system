const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* drifting signal dust (skipped for reduced motion) */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#dust'), x = c.getContext('2d');
  let w, h, P = [], m = { x: -999, y: -999 };
  const init = () => {
    w = c.width = innerWidth; h = c.height = innerHeight;
    P = Array.from({ length: Math.min(70, w / 18 | 0) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .3, vy: -Math.random() * .35 - .05,
      c: Math.random() > .75 ? '255,181,71' : '25,227,193'
    }));
  };
  addEventListener('resize', init);
  addEventListener('mousemove', e => { m.x = e.clientX; m.y = e.clientY; });
  init();
  (function frame() {
    x.clearRect(0, 0, w, h);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < 0 || p.x > w) p.vx *= -1;
      x.fillStyle = `rgba(${p.c},.7)`; x.beginPath(); x.arc(p.x, p.y, 1.6, 0, 7); x.fill();
      for (const q of P) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 110) { x.strokeStyle = `rgba(25,227,193,${.13 * (1 - d / 110)})`; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); }
      }
      const dm = Math.hypot(p.x - m.x, p.y - m.y);
      if (dm < 150) { x.strokeStyle = `rgba(255,181,71,${.4 * (1 - dm / 150)})`; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(m.x, m.y); x.stroke(); }
    }
    requestAnimationFrame(frame);
  })();
})();

/* cursor light on cards */
document.addEventListener('mousemove', e => {
  const card = e.target.closest?.('.card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--x', e.clientX - r.left + 'px');
  card.style.setProperty('--y', e.clientY - r.top + 'px');
});

/* pipeline */
const NAMES = ['', 'Search agent', 'Reader agent', 'Writer', 'Critic'];
const START = ['', 'Searching the web for sources', 'Scraping the most relevant page', 'Drafting the report', 'Reviewing the report'];
let es, clock, t0, report = '', topic = '';

function log(msg, cls = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  const t = document.createElement('em');
  t.textContent = new Date().toLocaleTimeString([], { hour12: false });
  d.append(t, msg);
  $('#term').querySelectorAll('.cur').forEach(n => n.classList.remove('cur'));
  $('#term').append(d);
  $('#term').scrollTop = 1e9;
  return d;
}

function setStep(n, status, preview) {
  const node = $(`.node[data-s="${n}"]`), t = node.querySelector('.t');
  clearInterval(clock);
  if (status === 'active') {
    node.classList.add('active');
    t0 = Date.now();
    t.textContent = 'working 0s';
    clock = setInterval(() => t.textContent = `working ${Math.round((Date.now() - t0) / 1000)}s`, 500);
    log(START[n] + '...', 'go cur');
  } else {
    node.classList.replace('active', 'done');
    t.textContent = `done in ${Math.round((Date.now() - t0) / 1000)}s`;
    $('#fill').style.width = Math.min(100, n / 3 * 100) + '%';
    log(`${NAMES[n]} finished`, 'ok');
    const pk = node.querySelector('.peek');
    if (preview) { pk.textContent = preview.replace(/\s+/g, ' ').trim(); pk.classList.add('show'); }
  }
}

function reset() {
  $$('.node').forEach(n => { n.className = 'node'; n.querySelector('.t').textContent = 'waiting'; });
  $('#fill').style.width = '0';
  $$('.peek').forEach(p => { p.textContent = ''; p.classList.remove('show'); });
  $('#term').innerHTML = '';
  $('#out').hidden = true;
  $('#err').hidden = true;
  $('#arc').style.strokeDashoffset = 326.7;
  $('#num').textContent = '0';
}

function busy(on) {
  $('#go').disabled = on;
  $('#relay').classList.toggle('running', on);
  $('#status').classList.toggle('busy', on);
  $('#status').lastChild.textContent = on ? 'Agents working' : 'Agents ready';
}

function start(q) {
  if (!q || q.length < 3) return;
  if (es) es.close();
  topic = q;
  $('#topic').value = q;
  reset();
  busy(true);
  $('#run').hidden = false;
  $('#run').scrollIntoView({ behavior: 'smooth', block: 'start' });
  log(`Topic: ${q}`);

  es = new EventSource('/api/research?topic=' + encodeURIComponent(q));
  es.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.event === 'step') setStep(d.step, d.status, d.preview);
    else if (d.event === 'done') { es.close(); busy(false); show(d); }
    else if (d.event === 'error') fail(d.message);
  };
  es.onerror = () => { if (es.readyState !== 2) fail('Lost connection to the server. Check that uvicorn is still running.'); };
}

function fail(msg) {
  es.close(); clearInterval(clock); busy(false);
  $$('.node.active').forEach(n => n.classList.remove('active'));
  log('Something went wrong', 'bad');
  $('#err').textContent = 'The pipeline stopped: ' + msg;
  $('#err').hidden = false;
}

const md = s => DOMPurify.sanitize(marked.parse(s), { ADD_ATTR: ['target'] });

function show(d, fresh = true) {
  report = d.report;
  log('Report ready', 'ok');
  const words = d.report.trim().split(/\s+/).length;
  $('#meta').textContent = `${words} words, about ${Math.max(1, Math.round(words / 200))} min read`;
  const vm = d.feedback.match(/verdict:?\s*\n?\s*([^\n]+)/i);
  $('#verdict').textContent = vm ? vm[1].replace(/[*_]/g, '') : '';
  if (fresh) { save({ topic, report: d.report, feedback: d.feedback, search: d.search }); toast('Report ready'); }
  $('#title').textContent = topic;
  $('#report').innerHTML = md(d.report);
  $('#fb').innerHTML = md(d.feedback);
  $$('#report a, #fb a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  $('#out').hidden = false;

  const urls = [...new Set((d.search.match(/https?:\/\/[^\s)]+/g) || []))].slice(0, 6);
  $('#srcCard').hidden = !urls.length;
  $('#src').innerHTML = '';
  urls.forEach(u => {
    const a = document.createElement('a');
    a.href = u; a.textContent = u.replace(/^https?:\/\/(www\.)?/, ''); a.target = '_blank'; a.rel = 'noopener noreferrer';
    $('#src').append(a);
  });

  const m = d.feedback.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  const score = m ? Math.min(10, +m[1]) : 0;
  const arc = $('#arc');
  arc.style.stroke = score >= 8 ? '#19e3c1' : score >= 6 ? '#ffb547' : '#ff6b6b';
  setTimeout(() => arc.style.strokeDashoffset = 326.7 * (1 - score / 10), 150);
  const t = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t) / 1600);
    $('#num').textContent = (score * (1 - Math.pow(1 - p, 3))).toFixed(score % 1 ? 1 : 0);
    if (p < 1) requestAnimationFrame(tick); else $('#num').textContent = score;
  })(t);
  setTimeout(() => $('#out').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

$('#form').addEventListener('submit', e => { e.preventDefault(); start($('#topic').value.trim()); });
$('#chips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') start(e.target.textContent); });
$('#copy').onclick = async e => {
  await navigator.clipboard.writeText(report);
  e.target.textContent = 'Copied';
  setTimeout(() => e.target.textContent = 'Copy', 1500);
};
$('#dl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }));
  a.download = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
};

/* progress bar, shortcut, toast */
addEventListener('scroll', () => {
  const h = document.documentElement;
  $('#prog').style.transform = `scaleX(${scrollY / ((h.scrollHeight - innerHeight) || 1)})`;
}, { passive: true });
addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#topic').focus(); }
});
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3300);
}

/* typing placeholder */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ex = $$('#chips button').map(b => b.textContent), inp = $('#topic'), base = 'What should we research?';
  let i = 0, j = 0, del = false;
  inp.addEventListener('focus', () => inp.placeholder = base);
  (function tick() {
    if (document.activeElement !== inp && !inp.value) {
      const s = ex[i];
      j += del ? -1 : 1;
      inp.placeholder = s.slice(0, j) || base;
      if (!del && j === s.length) { del = true; return setTimeout(tick, 1600); }
      if (del && j === 0) { del = false; i = (i + 1) % ex.length; }
    }
    setTimeout(tick, del ? 25 : 60);
  })();
})();

/* recent reports (saved in this browser) */
const KEY = 'relay-history';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
function save(item) {
  try { localStorage.setItem(KEY, JSON.stringify([item, ...load().filter(h => h.topic !== item.topic)].slice(0, 6))); } catch {}
  renderRecent();
}
function renderRecent() {
  const box = $('#recent'), list = load();
  box.innerHTML = '';
  box.hidden = !list.length;
  if (!list.length) return;
  const l = document.createElement('span');
  l.textContent = 'Recent reports';
  box.append(l);
  list.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = item.topic;
    b.onclick = () => openSaved(item);
    box.append(b);
  });
}
function openSaved(item) {
  if (es) es.close();
  clearInterval(clock); busy(false); reset();
  topic = item.topic; $('#topic').value = topic;
  $('#run').hidden = false;
  $$('.node').forEach(n => { n.classList.add('done'); n.querySelector('.t').textContent = 'saved'; });
  $('#fill').style.width = '100%';
  log('Opened a saved report', 'ok');
  show(item, false);
}
renderRecent();