// ── app.js · AI Roundtable ─────────────────────────────────────────────────
// Fetches config.json on load. To change models/rounds/personas, edit config.json only.

let CONFIG   = null;
let convo    = [];
let round    = 0;
let paused   = false;
let running  = false;
let stopped  = false;

// ── LOAD CONFIG ──────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('./config.json?v=' + Date.now());
    if (!res.ok) throw new Error('Could not load config.json — ' + res.status);
    CONFIG = await res.json();
    applyConfig();
  } catch(e) {
    document.getElementById('config-error').textContent = '⚠ ' + e.message;
    document.getElementById('config-error').style.display = '';
  }
}

function applyConfig() {
  // Title
  document.getElementById('app-title').textContent   = CONFIG.title;
  document.getElementById('app-subtitle').textContent = CONFIG.subtitle;

  // Suggested topics dropdown
  const sel = document.getElementById('topic-suggestions');
  CONFIG.suggested_topics.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t.length > 60 ? t.slice(0,60)+'…' : t;
    sel.appendChild(opt);
  });

  // Agent cards
  const grid = document.getElementById('agent-grid');
  grid.innerHTML = '';
  CONFIG.agents.forEach(ag => {
    grid.innerHTML += `
      <div class="ac" id="card-${ag.id}" style="--col:${ag.color}">
        <div class="ac-emoji">${ag.emoji}</div>
        <div class="ac-name">${ag.name}</div>
        <div class="ac-model">${ag.model} · ${ag.provider}</div>
        <div class="ac-role">${ag.role}</div>
        <div class="ac-status" id="st-${ag.id}">Standby</div>
      </div>`;
  });

  // Round pips
  const totalRounds = CONFIG.debate_rounds + (CONFIG.conclusion_round ? 1 : 0);
  const pipsEl = document.getElementById('round-pips');
  pipsEl.innerHTML = '';
  for (let i = 1; i <= totalRounds; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.id = 'p' + i;
    if (i === totalRounds && CONFIG.conclusion_round) {
      pip.style.opacity = '0.4';
      pip.style.background = '#4ade80';
      pip.title = 'Conclusion Round';
    }
    pipsEl.appendChild(pip);
  }
  updateRoundLabel(0);

  // Empty feed message
  const names = CONFIG.agents.map(a => `<code>${a.name}</code>`).join(', ');
  document.getElementById('feed-empty-models').innerHTML = names;
}

// ── KEY ───────────────────────────────────────────────────────────────────────
const getKey = () => localStorage.getItem('groq_rt_key') || '';
function saveKey() {
  const v = document.getElementById('groq-key').value.trim();
  if (!v) { alert('Please paste your Groq key!'); return; }
  localStorage.setItem('groq_rt_key', v);
  document.getElementById('key-ok').style.display = '';
  sysmsg('✓ Groq key saved — ready to debate! ⚡');
}
function initKey() {
  const k = getKey();
  if (k) {
    document.getElementById('groq-key').value = k;
    document.getElementById('key-ok').style.display = '';
  }
}

// ── TOPIC SUGGESTION ─────────────────────────────────────────────────────────
function onSuggestionSelect() {
  const v = document.getElementById('topic-suggestions').value;
  if (v) document.getElementById('topic').value = v;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
function buildSystem(ag) {
  const others = CONFIG.agents.filter(a => a.id !== ag.id).map(a => `${a.name} (${a.provider})`).join(' and ');
  return `You are ${ag.name} by ${ag.provider}. You're in a live debate with ${others}, all running on Groq.
Personality: ${ag.personality}
Rules: ${ag.style}`;
}

function buildPrompt(agId, topic) {
  if (!convo.length)
    return `Topic: "${topic}"\n\nYou go first. Open the debate with your sharpest take.`;
  const log = convo.slice(-8).map(m => {
    const a = CONFIG.agents.find(x => x.id === m.id);
    return `${a.name}: ${m.text}`;
  }).join('\n\n');
  return `Topic: "${topic}"\n\nConversation so far:\n${log}\n\nYour turn. Respond directly and move the debate forward.`;
}

function buildConclusionPrompt(agId, topic) {
  const log = convo.slice(-9).map(m => {
    const a = CONFIG.agents.find(x => x.id === m.id);
    return `${a.name}: ${m.text}`;
  }).join('\n\n');
  return `Topic: "${topic}"\n\nFull debate:\n${log}\n\nThis is the FINAL CONCLUSION round. Based on everything discussed, state ONE clear, concise problem statement (2 sentences max) that best captures the core challenge. Begin with "My final problem statement:"`;
}

// ── GROQ API ──────────────────────────────────────────────────────────────────
async function callGroq(ag, promptText, isConclusion = false) {
  const key = getKey();
  if (!key) throw new Error('No Groq key — paste it above and click Save');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: ag.model,
      max_tokens: isConclusion ? 120 : 200,
      temperature: isConclusion ? 0.6 : 0.88,
      messages: [
        { role: 'system', content: buildSystem(ag) },
        { role: 'user',   content: promptText },
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    let msg = `Groq ${res.status}`;
    try { msg = JSON.parse(e).error?.message || msg; } catch(_) {}
    throw new Error(msg);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content?.trim() || null;
}

// ── RENDER ────────────────────────────────────────────────────────────────────
const nowStr = () => new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const esc    = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const feedEl = () => document.getElementById('feed');
function hideEmpty() { document.getElementById('feed-empty')?.remove(); }

function sysmsg(html) {
  hideEmpty();
  const el = document.createElement('div');
  el.className = 'msg ms';
  el.innerHTML = `<div class="av sys-av">·</div><div class="mbody"><div class="mmeta"><span class="mname sys-name">System</span><span class="mtime">${nowStr()}</span></div><p class="mtext sys-text">${html}</p></div>`;
  feedEl().appendChild(el); feedEl().scrollTop = 9999;
}

function showTyping(ag) {
  hideEmpty();
  const el = document.createElement('div');
  el.className = 'msg'; el.id = `typing-${ag.id}`;
  el.style.setProperty('--col', ag.color);
  el.innerHTML = `<div class="av" style="background:${ag.color}18;border-color:${ag.color}44">${ag.emoji}</div><div class="mbody"><div class="mmeta"><span class="mname" style="color:${ag.color}">${ag.name}</span><span class="mtime">${nowStr()}</span></div><div class="typing"><span style="background:${ag.color}"></span><span style="background:${ag.color}"></span><span style="background:${ag.color}"></span></div></div>`;
  feedEl().appendChild(el); feedEl().scrollTop = 9999;
  setSt(ag.id, 'Thinking…', ag.color); setCard(ag.id, true, ag.color);
}
function rmTyping(id) { document.getElementById(`typing-${id}`)?.remove(); }

function addMsg(ag, text, isConclusion = false) {
  rmTyping(ag.id);
  const el = document.createElement('div');
  el.className = 'msg';
  const badge = isConclusion ? `<span class="conclusion-badge">✦ Final Statement</span>` : '';
  el.innerHTML = `<div class="av" style="background:${ag.color}18;border-color:${ag.color}44">${ag.emoji}</div><div class="mbody"><div class="mmeta"><span class="mname" style="color:${ag.color}">${ag.name}</span><span class="mtime">${nowStr()}</span>${badge}</div><p class="mtext">${esc(text)}</p></div>`;
  feedEl().appendChild(el); feedEl().scrollTop = 9999;
  setSt(ag.id, 'Done ✓', ag.color); setCard(ag.id, false, ag.color);
  if (!isConclusion) convo.push({ id: ag.id, text });
}

function setSt(id, msg, color) {
  const el = document.getElementById(`st-${id}`);
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg.includes('Thinking') ? color : '';
}
function setCard(id, on, color) {
  const el = document.getElementById(`card-${id}`);
  if (!el) return;
  el.style.borderColor = on ? color : '';
  el.style.boxShadow   = on ? `0 0 28px -4px ${color}` : '';
}
function updateRoundLabel(n) {
  const total = CONFIG ? CONFIG.debate_rounds + (CONFIG.conclusion_round ? 1 : 0) : 10;
  document.getElementById('round-label').textContent = `Round ${n} / ${total}`;
  for (let i = 1; i <= total; i++) {
    const p = document.getElementById(`p${i}`);
    if (p && i !== total) p.className = 'pip' + (i <= n ? ' go' : '');
  }
}

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitUnpause() { while (paused && !stopped) await wait(300); }

async function startDebate() {
  if (!CONFIG) { alert('Config not loaded yet. Please refresh.'); return; }
  const topic = document.getElementById('topic').value.trim();
  if (!topic) { alert('Please enter a topic!'); return; }
  if (!getKey()) { alert('Please paste your Groq API key above!'); return; }

  running=true; stopped=false; paused=false; round=0; convo=[];
  document.getElementById('go-btn').disabled = true;
  document.getElementById('pause-btn').style.display = '';
  document.getElementById('reset-btn').style.display = '';
  document.getElementById('topic').disabled = true;
  updateRoundLabel(0);

  const n = CONFIG.agents.length;
  const r = CONFIG.debate_rounds;
  sysmsg(`🎙 Topic: <strong>${esc(topic)}</strong> — ${n} models · ${r} debate rounds + conclusion`);
  await wait(500);

  // DEBATE ROUNDS
  while (!stopped && round < CONFIG.debate_rounds) {
    round++; updateRoundLabel(round);
    for (const ag of CONFIG.agents) {
      if (stopped) break;
      await waitUnpause(); if (stopped) break;
      showTyping(ag);
      await wait(600 + Math.random() * 400);
      await waitUnpause(); if (stopped) { rmTyping(ag.id); setCard(ag.id, false, ag.color); break; }
      try {
        const text = await callGroq(ag, buildPrompt(ag.id, topic));
        if (text) addMsg(ag, text);
        else { rmTyping(ag.id); setCard(ag.id, false, ag.color); setSt(ag.id, 'No response', ''); }
      } catch(e) {
        rmTyping(ag.id); setCard(ag.id, false, ag.color); setSt(ag.id, 'Error ✗', '#f87171');
        sysmsg(`⚠ <strong>${ag.name}</strong>: ${esc(e.message)}`);
      }
      await wait(CONFIG.inter_turn_delay_ms + Math.random() * 500);
    }
  }

  // CONCLUSION ROUND
  if (!stopped && CONFIG.conclusion_round) {
    const conclusionRound = CONFIG.debate_rounds + 1;
    updateRoundLabel(conclusionRound);
    const p10 = document.getElementById(`p${conclusionRound}`);
    if (p10) { p10.style.opacity = '1'; p10.style.background = '#4ade80'; p10.className = 'pip go'; }
    sysmsg('🏁 <strong>Conclusion Round</strong> — each model states their final problem statement!');
    await wait(700);
    for (const ag of CONFIG.agents) {
      if (stopped) break;
      await waitUnpause(); if (stopped) break;
      showTyping(ag);
      await wait(700 + Math.random() * 400);
      await waitUnpause(); if (stopped) { rmTyping(ag.id); setCard(ag.id, false, ag.color); break; }
      try {
        const text = await callGroq(ag, buildConclusionPrompt(ag.id, topic), true);
        if (text) addMsg(ag, text, true);
        else { rmTyping(ag.id); setCard(ag.id, false, ag.color); }
      } catch(e) {
        rmTyping(ag.id); setCard(ag.id, false, ag.color);
        sysmsg(`⚠ <strong>${ag.name}</strong>: ${esc(e.message)}`);
      }
      await wait(CONFIG.inter_turn_delay_ms);
    }
    sysmsg('✅ Done! See the <strong>Final Statements</strong> above. Hit Reset for a new topic.');
  }

  running = false;
  document.getElementById('go-btn').disabled = false;
  document.getElementById('pause-btn').style.display = 'none';
  CONFIG.agents.forEach(ag => { setCard(ag.id, false, ag.color); setSt(ag.id, 'Done', ''); });
}

function togglePause() {
  paused = !paused;
  document.getElementById('pause-btn').textContent = paused ? '▶ Resume' : '⏸ Pause';
  sysmsg(paused ? '⏸ Paused.' : '▶ Resumed.');
}

function resetAll() {
  stopped=true; paused=false; running=false;
  convo=[]; round=0;
  updateRoundLabel(0);
  document.getElementById('go-btn').disabled = false;
  document.getElementById('pause-btn').style.display = 'none';
  document.getElementById('reset-btn').style.display = 'none';
  document.getElementById('topic').disabled = false;
  document.getElementById('pause-btn').textContent = '⏸ Pause';
  document.getElementById('topic-suggestions').value = '';
  const names = CONFIG ? CONFIG.agents.map(a => `<code>${a.name}</code>`).join(', ') : '';
  document.getElementById('feed').innerHTML = `
    <div class="empty" id="feed-empty">
      <div class="empty-icon">🤖</div>
      <p>${names} will debate using a single Groq key.<br/>Pick a topic and press Start.</p>
    </div>`;
  if (CONFIG) CONFIG.agents.forEach(ag => { setCard(ag.id, false, ag.color); setSt(ag.id, 'Standby', ''); });
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initKey();
  loadConfig();
  document.getElementById('topic').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !running) startDebate();
  });
});
