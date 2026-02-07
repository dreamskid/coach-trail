#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'coach-log.json');

function readData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return { daily: [], longterm: {} };
    }
}

function writeData(data) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 1e6) reject(new Error('Too large')); });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    });
}

function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // GET / — UI
    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
    }

    // GET /api/data
    if (req.method === 'GET' && url.pathname === '/api/data') {
        json(res, 200, readData());
        return;
    }

    // POST /api/save
    if (req.method === 'POST' && url.pathname === '/api/save') {
        try {
            const payload = await parseBody(req);
            const data = readData();

            // Upsert daily entry
            if (payload.daily) {
                const entry = payload.daily;
                const idx = data.daily.findIndex(d => d.date === entry.date);
                if (idx >= 0) data.daily[idx] = entry;
                else data.daily.push(entry);
                data.daily.sort((a, b) => a.date.localeCompare(b.date));
            }

            // Merge longterm
            if (payload.longterm) {
                data.longterm = { ...data.longterm, ...payload.longterm };
            }

            // Merge settings
            if (payload.settings) {
                data.settings = { ...data.settings, ...payload.settings };
            }

            writeData(data);
            json(res, 200, { ok: true });
        } catch (e) {
            json(res, 400, { error: e.message });
        }
        return;
    }

    // POST /api/publish
    if (req.method === 'POST' && url.pathname === '/api/publish') {
        try {
            const cwd = __dirname;
            execSync('git add data/coach-log.json', { cwd });
            const today = new Date().toISOString().slice(0, 10);
            execSync(`git commit -m "Coach log: ${today}"`, { cwd });
            execSync('git push origin main', { cwd });
            json(res, 200, { ok: true, message: 'Pushed to main' });
        } catch (e) {
            const msg = e.stderr ? e.stderr.toString() : e.message;
            if (msg.includes('nothing to commit')) {
                json(res, 200, { ok: true, message: 'Nothing to commit' });
            } else {
                json(res, 500, { error: msg });
            }
        }
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`\n  Back Office Coach Trail`);
    console.log(`  http://localhost:${PORT}\n`);
});

// ===== HTML UI =====
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Back Office — Coach Trail</title>
<style>
:root {
    --bg: #0f1117;
    --bg-card: #1a1d27;
    --bg-card-alt: #21242f;
    --border: #2a2d3a;
    --text: #e4e4e7;
    --text-muted: #8b8fa3;
    --accent: #3b82f6;
    --accent-light: #60a5fa;
    --green: #22c55e;
    --green-dark: #15803d;
    --yellow: #eab308;
    --orange: #f97316;
    --red: #ef4444;
    --red-dark: #991b1b;
    --radius: 12px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 20px;
}

.container { max-width: 700px; margin: 0 auto; }

h1 { font-size: 22px; font-weight: 700; margin-bottom: 20px; letter-spacing: -0.5px; }
h1 span { color: var(--accent); }

.card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    margin-bottom: 16px;
}

.card h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 16px;
}

.field { margin-bottom: 16px; }
.field label {
    display: block;
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 6px;
    font-weight: 600;
}

input[type="date"],
input[type="number"],
input[type="text"],
textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
}

input:focus, textarea:focus { border-color: var(--accent); }
textarea { resize: vertical; min-height: 80px; }

/* Slider */
.slider-row {
    display: flex;
    align-items: center;
    gap: 12px;
}
.slider-row input[type="range"] {
    flex: 1;
    -webkit-appearance: none;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    outline: none;
}
.slider-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
}
.slider-val {
    min-width: 44px;
    text-align: center;
    font-weight: 700;
    font-size: 18px;
}

/* Toggles */
.toggle-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}
.toggle-btn {
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card-alt);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
}
.toggle-btn:hover { border-color: var(--accent); }
.toggle-btn.active {
    background: #0a1a0f;
    border-color: var(--green-dark);
    color: var(--green);
}
.toggle-btn.active-red {
    background: #1a0a0a;
    border-color: var(--red-dark);
    color: var(--red);
}

/* Chips */
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.chip {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--bg-card-alt);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}
.chip:hover { border-color: var(--accent); }
.chip.active {
    background: #0a1a0f;
    border-color: var(--green-dark);
    color: var(--green);
}

/* Buttons */
.actions {
    display: flex;
    gap: 12px;
    margin-top: 20px;
}
.btn {
    flex: 1;
    padding: 14px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.15s;
}
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-save { background: var(--accent); color: white; }
.btn-publish { background: var(--green); color: white; }

/* Toast */
.toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    padding: 12px 24px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    opacity: 0;
    transition: all 0.3s;
    z-index: 1000;
}
.toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
.toast.success { background: var(--green-dark); color: var(--green); }
.toast.error { background: var(--red-dark); color: var(--red); }

/* Collapsible */
.collapsible-header {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
}
.collapsible-header .arrow {
    transition: transform 0.2s;
    font-size: 12px;
}
.collapsible-header.open .arrow { transform: rotate(90deg); }
.collapsible-body { display: none; margin-top: 16px; }
.collapsible-body.open { display: block; }

/* No-session toggle */
.no-session { margin-left: 12px; }
</style>
</head>
<body>
<div class="container">
    <h1>Back Office <span>Coach Trail</span></h1>

    <!-- Date picker -->
    <div class="card">
        <div class="field">
            <label>Date</label>
            <input type="date" id="f-date">
        </div>
    </div>

    <!-- Metriques -->
    <div class="card">
        <h2>Metriques du jour</h2>

        <div class="field">
            <label>Soleaire <span id="sol-color" style="font-size:11px;"></span></label>
            <div class="slider-row">
                <input type="range" id="f-soleaire" min="0" max="10" step="0.5" value="0">
                <span class="slider-val" id="sol-val">0</span>
            </div>
        </div>

        <div class="field">
            <label>RPE
                <button class="toggle-btn no-session" id="f-no-session" onclick="toggleNoSession()">Pas de seance</button>
            </label>
            <div class="slider-row" id="rpe-row">
                <input type="range" id="f-rpe" min="0" max="10" step="0.5" value="5">
                <span class="slider-val" id="rpe-val">5</span>
            </div>
        </div>

        <div class="field">
            <label>Sommeil (heures)</label>
            <input type="number" id="f-sommeil" min="0" max="14" step="0.25" placeholder="7.5">
        </div>

        <div class="field">
            <label>Body Battery (0-100)</label>
            <input type="number" id="f-bb" min="0" max="100" step="1" placeholder="80">
        </div>
    </div>

    <!-- Hygiene -->
    <div class="card">
        <h2>Hygiene de vie</h2>
        <div class="toggle-row">
            <button class="toggle-btn" id="f-diner" onclick="toggleBtn('f-diner')">Diner leger</button>
            <button class="toggle-btn" id="f-nicotine" onclick="toggleBtn('f-nicotine', true)">Nicotine</button>
            <button class="toggle-btn" id="f-hydratation" onclick="toggleBtn('f-hydratation')">Hydratation OK</button>
        </div>
    </div>

    <!-- Renfo checks -->
    <div class="card">
        <h2>Renforcement / Soins</h2>
        <div class="chips" id="checks-chips"></div>
        <div class="field" style="margin-top: 12px;">
            <input type="text" id="f-check-custom" placeholder="Ajouter un exercice..." onkeydown="if(event.key==='Enter'){addCustomChip();event.preventDefault();}">
        </div>
    </div>

    <!-- Verdict -->
    <div class="card">
        <h2>Coach</h2>
        <div class="field">
            <label>Verdict coach</label>
            <textarea id="f-verdict" placeholder="Commentaire du jour..."></textarea>
        </div>
        <div class="field">
            <label>Phase</label>
            <input type="text" id="f-phase" placeholder="bloc0, bloc1...">
        </div>
    </div>

    <!-- Longterm (collapsible) -->
    <div class="card">
        <div class="collapsible-header" onclick="toggleCollapsible(this)">
            <span class="arrow">&#9654;</span>
            <h2 style="margin-bottom:0;">Trajectoire long terme</h2>
        </div>
        <div class="collapsible-body" id="longterm-section">
            <div class="field">
                <label>Statut</label>
                <div class="toggle-row">
                    <button class="toggle-btn" id="lt-repos" onclick="setLtStatus('repos')">Repos/Soin</button>
                    <button class="toggle-btn" id="lt-en_retard" onclick="setLtStatus('en_retard')">En retard</button>
                    <button class="toggle-btn" id="lt-dans_les_temps" onclick="setLtStatus('dans_les_temps')">Dans les temps</button>
                    <button class="toggle-btn" id="lt-avance" onclick="setLtStatus('avance')">En avance</button>
                </div>
            </div>
            <div class="field">
                <label>Bloc actuel</label>
                <input type="text" id="lt-block" placeholder="Bloc 0 — Reprise & Soin">
            </div>
            <div class="field">
                <label>Prochaine course</label>
                <input type="text" id="lt-next-race" placeholder="Cabornis (8 mars)">
            </div>
            <div class="field">
                <label>Trajectoire</label>
                <input type="text" id="lt-trajectory" placeholder="Phase de soin, pas encore en retard">
            </div>
        </div>
    </div>

    <!-- Settings (collapsible) -->
    <div class="card">
        <div class="collapsible-header" onclick="toggleCollapsible(this)">
            <span class="arrow">&#9654;</span>
            <h2 style="margin-bottom:0;">Reglages</h2>
        </div>
        <div class="collapsible-body" id="settings-section">
            <div class="field">
                <label>GitHub Token (sync Strava/Garmin)</label>
                <input type="password" id="f-gh-token" placeholder="ghp_xxxxxxxxxxxx...">
                <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Stocke en base64 dans coach-log.json. Partage entre tous les devices.</p>
            </div>
        </div>
    </div>

    <!-- Actions -->
    <div class="actions">
        <button class="btn btn-save" onclick="save()">Sauvegarder</button>
        <button class="btn btn-publish" onclick="publish()">Publier</button>
    </div>
</div>

<div class="toast" id="toast"></div>

<script>
const DEFAULT_CHECKS = ['Iso mollets', 'PPG haut du corps', 'PPG complete', 'Iso / excentriques', 'Test phase 2', 'Retest saut'];
let activeChecks = {};
let noSession = false;
let ltStatus = '';
let allData = { daily: [], longterm: {} };

// Init
const dateInput = document.getElementById('f-date');
dateInput.value = new Date().toISOString().slice(0, 10);
dateInput.addEventListener('change', () => loadEntry());

const solSlider = document.getElementById('f-soleaire');
const solVal = document.getElementById('sol-val');
const solColor = document.getElementById('sol-color');
solSlider.addEventListener('input', () => {
    const v = parseFloat(solSlider.value);
    solVal.textContent = v;
    solVal.style.color = soleaireColor(v);
    solColor.textContent = v <= 1 ? '(top)' : v <= 3 ? '(ok)' : v <= 5 ? '(attention)' : '(alerte)';
    solColor.style.color = soleaireColor(v);
});

const rpeSlider = document.getElementById('f-rpe');
const rpeVal = document.getElementById('rpe-val');
rpeSlider.addEventListener('input', () => {
    rpeVal.textContent = rpeSlider.value;
});

function soleaireColor(v) {
    if (v <= 1) return '#22c55e';
    if (v <= 3) return '#eab308';
    if (v <= 5) return '#f97316';
    return '#ef4444';
}

function toggleNoSession() {
    noSession = !noSession;
    const btn = document.getElementById('f-no-session');
    btn.classList.toggle('active', noSession);
    document.getElementById('rpe-row').style.opacity = noSession ? '0.3' : '1';
    rpeSlider.disabled = noSession;
}

function toggleBtn(id, isRed) {
    const btn = document.getElementById(id);
    const cls = isRed ? 'active-red' : 'active';
    btn.classList.toggle(cls);
}

function toggleCollapsible(el) {
    el.classList.toggle('open');
    el.nextElementSibling.classList.toggle('open');
}

function setLtStatus(status) {
    ltStatus = status;
    ['repos', 'en_retard', 'dans_les_temps', 'avance'].forEach(s => {
        document.getElementById('lt-' + s).classList.toggle('active', s === status);
    });
}

// Checks chips
function renderChips() {
    const container = document.getElementById('checks-chips');
    container.innerHTML = '';
    const allItems = [...new Set([...DEFAULT_CHECKS, ...Object.keys(activeChecks).filter(k => !DEFAULT_CHECKS.includes(k))])];
    allItems.forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'chip' + (activeChecks[item] ? ' active' : '');
        chip.textContent = item;
        chip.onclick = () => {
            activeChecks[item] = !activeChecks[item];
            chip.classList.toggle('active', activeChecks[item]);
        };
        container.appendChild(chip);
    });
}

function addCustomChip() {
    const input = document.getElementById('f-check-custom');
    const val = input.value.trim();
    if (!val) return;
    activeChecks[val] = true;
    input.value = '';
    renderChips();
}

renderChips();

// Load existing data
fetch('/api/data')
    .then(r => r.json())
    .then(data => {
        allData = data;
        loadEntry();
    })
    .catch(() => {});

function loadEntry() {
    const date = dateInput.value;
    const entry = allData.daily.find(d => d.date === date);

    if (entry) {
        solSlider.value = entry.soleaire ?? 0;
        solSlider.dispatchEvent(new Event('input'));
        rpeSlider.value = entry.rpe ?? 5;
        rpeSlider.dispatchEvent(new Event('input'));
        noSession = entry.rpe === null;
        document.getElementById('f-no-session').classList.toggle('active', noSession);
        document.getElementById('rpe-row').style.opacity = noSession ? '0.3' : '1';
        rpeSlider.disabled = noSession;
        document.getElementById('f-sommeil').value = entry.sommeil_h ?? '';
        document.getElementById('f-bb').value = entry.body_battery ?? '';
        document.getElementById('f-diner').classList.toggle('active', !!entry.diner);
        document.getElementById('f-nicotine').classList.toggle('active-red', !!entry.nicotine);
        document.getElementById('f-hydratation').classList.toggle('active', !!entry.hydratation);
        document.getElementById('f-verdict').value = entry.verdict || '';
        document.getElementById('f-phase').value = entry.phase || '';

        // Checks
        activeChecks = {};
        if (entry.checks) {
            Object.keys(entry.checks).forEach(k => { activeChecks[k] = entry.checks[k]; });
        }
        renderChips();
    } else {
        // Reset form
        solSlider.value = 0;
        solSlider.dispatchEvent(new Event('input'));
        rpeSlider.value = 5;
        rpeSlider.dispatchEvent(new Event('input'));
        noSession = false;
        document.getElementById('f-no-session').classList.remove('active');
        document.getElementById('rpe-row').style.opacity = '1';
        rpeSlider.disabled = false;
        document.getElementById('f-sommeil').value = '';
        document.getElementById('f-bb').value = '';
        document.getElementById('f-diner').classList.remove('active');
        document.getElementById('f-nicotine').classList.remove('active-red');
        document.getElementById('f-hydratation').classList.remove('active');
        document.getElementById('f-verdict').value = '';
        document.getElementById('f-phase').value = '';
        activeChecks = {};
        renderChips();
    }

    // Longterm
    const lt = allData.longterm || {};
    if (lt.status) setLtStatus(lt.status);
    document.getElementById('lt-block').value = lt.current_block || '';
    document.getElementById('lt-next-race').value = lt.next_race || '';
    document.getElementById('lt-trajectory').value = lt.trajectory || '';

    // Settings
    const settings = allData.settings || {};
    if (settings.gh_sync_token_b64) {
        try { document.getElementById('f-gh-token').value = atob(settings.gh_sync_token_b64); } catch(e) {}
    }
}

function buildPayload() {
    const date = dateInput.value;
    const sommeil = document.getElementById('f-sommeil').value;
    const bb = document.getElementById('f-bb').value;

    const checks = {};
    Object.keys(activeChecks).forEach(k => {
        checks[k] = !!activeChecks[k];
    });

    const daily = {
        date: date,
        soleaire: parseFloat(solSlider.value),
        rpe: noSession ? null : parseFloat(rpeSlider.value),
        diner: document.getElementById('f-diner').classList.contains('active'),
        nicotine: document.getElementById('f-nicotine').classList.contains('active-red'),
        hydratation: document.getElementById('f-hydratation').classList.contains('active'),
        sommeil_h: sommeil !== '' ? parseFloat(sommeil) : null,
        body_battery: bb !== '' ? parseInt(bb) : null,
        verdict: document.getElementById('f-verdict').value.trim() || null,
        phase: document.getElementById('f-phase').value.trim() || null,
        checks: checks
    };

    const payload = { daily: daily };

    // Include longterm if section was opened and has values
    const ltBlock = document.getElementById('lt-block').value.trim();
    const ltNextRace = document.getElementById('lt-next-race').value.trim();
    const ltTraj = document.getElementById('lt-trajectory').value.trim();

    if (ltStatus || ltBlock || ltNextRace || ltTraj) {
        const weeksToOcc = Math.ceil((new Date('2026-08-27') - new Date(date)) / (7 * 24 * 60 * 60 * 1000));
        payload.longterm = {
            updated: date,
            status: ltStatus || undefined,
            occ_weeks_remaining: weeksToOcc,
            current_block: ltBlock || undefined,
            next_race: ltNextRace || undefined,
            trajectory: ltTraj || undefined
        };
    }

    // Settings (token)
    const ghToken = document.getElementById('f-gh-token').value.trim();
    if (ghToken) {
        payload.settings = { gh_sync_token_b64: btoa(ghToken) };
    }

    return payload;
}

function toast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(() => { t.classList.remove('show'); }, 3000);
}

async function save() {
    try {
        const payload = buildPayload();
        const r = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await r.json();
        if (r.ok) {
            // Refresh local data
            const refreshed = await fetch('/api/data').then(r => r.json());
            allData = refreshed;
            toast('Sauvegarde OK', 'success');
        } else {
            toast('Erreur: ' + result.error, 'error');
        }
    } catch (e) {
        toast('Erreur: ' + e.message, 'error');
    }
}

async function publish() {
    const btn = document.querySelector('.btn-publish');
    btn.disabled = true;
    btn.textContent = 'Publication...';
    try {
        const r = await fetch('/api/publish', { method: 'POST' });
        const result = await r.json();
        if (r.ok) {
            toast(result.message || 'Publie !', 'success');
        } else {
            toast('Erreur: ' + result.error, 'error');
        }
    } catch (e) {
        toast('Erreur: ' + e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Publier';
}
</script>
</body>
</html>`;
