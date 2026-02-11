#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = 3000;
const DATA_FILES = {
    yohann: path.join(__dirname, 'data', 'coach-log.json'),
    juliette: path.join(__dirname, 'data', 'juliette', 'coach-log.json')
};

const CHAT_HISTORY_FILES = {
    yohann: path.join(__dirname, 'data', 'chat-history.json'),
    juliette: path.join(__dirname, 'data', 'juliette', 'chat-history.json')
};

const ATHLETE_CONTEXT_FILES = {
    yohann: {
        profil: path.join(__dirname, 'profil.md'),
        blessures: path.join(__dirname, 'blessures.md'),
        zones: path.join(__dirname, 'zones-entrainement.md'),
        calendrier: path.join(__dirname, 'calendrier-2026.md')
    },
    juliette: {
        profil: path.join(__dirname, 'juliette', 'profil.md'),
        blessures: path.join(__dirname, 'juliette', 'blessures.md'),
        zones: path.join(__dirname, 'juliette', 'zones-entrainement.md'),
        calendrier: path.join(__dirname, 'juliette', 'calendrier-2026.md')
    }
};

const WEEK_DIRS = {
    yohann: path.join(__dirname, 'semaines'),
    juliette: path.join(__dirname, 'juliette', 'semaines')
};

const ACTIVITY_FILES = {
    yohann: {
        strava: path.join(__dirname, 'data', 'strava-activities.json'),
        garmin: path.join(__dirname, 'data', 'garmin-activities.json'),
        wellness: path.join(__dirname, 'data', 'garmin-wellness.json')
    },
    juliette: {
        strava: path.join(__dirname, 'data', 'juliette', 'strava-activities.json'),
        garmin: path.join(__dirname, 'data', 'juliette', 'garmin-activities.json'),
        wellness: path.join(__dirname, 'data', 'juliette', 'garmin-wellness.json')
    }
};

const RACE_HISTORY_FILES = {
    yohann: path.join(__dirname, 'courses', 'historique-courses.md'),
    juliette: path.join(__dirname, 'juliette', 'courses', 'historique-courses.md')
};

const RACE_PREDICTIONS_FILES = {
    yohann: path.join(__dirname, 'courses', 'previsions-2026.md'),
    juliette: path.join(__dirname, 'juliette', 'courses', 'previsions-2026.md')
};

const ATHLETE_DATA_FILES = {
    yohann: path.join(__dirname, 'data', 'athlete-data.json'),
    juliette: path.join(__dirname, 'data', 'juliette', 'athlete-data.json')
};

function readAthleteData(athlete) {
    const file = ATHLETE_DATA_FILES[athlete] || ATHLETE_DATA_FILES.yohann;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return {}; }
}

function writeAthleteData(data, athlete) {
    const file = ATHLETE_DATA_FILES[athlete] || ATHLETE_DATA_FILES.yohann;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// ===== FILE LOCKING =====
const _fileLocks = {};
function withFileLock(filePath, fn) {
    if (!_fileLocks[filePath]) _fileLocks[filePath] = Promise.resolve();
    _fileLocks[filePath] = _fileLocks[filePath].then(fn).catch(e => { throw e; });
    return _fileLocks[filePath];
}

// ===== TOOL INPUT VALIDATION =====
function validateToolInput(toolName, input) {
    const errors = [];

    switch (toolName) {
        case 'update_daily': {
            if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
                errors.push('date doit etre au format YYYY-MM-DD');
            }
            const f = input.fields || {};
            if (f.soleaire != null && (typeof f.soleaire !== 'number' || f.soleaire < 0 || f.soleaire > 10)) {
                errors.push('soleaire doit etre un nombre entre 0 et 10');
            }
            if (f.genou != null && (typeof f.genou !== 'number' || f.genou < 0 || f.genou > 10)) {
                errors.push('genou doit etre un nombre entre 0 et 10');
            }
            if (f.rpe != null && f.rpe !== null && (typeof f.rpe !== 'number' || f.rpe < 0 || f.rpe > 10)) {
                errors.push('rpe doit etre un nombre entre 0 et 10');
            }
            if (f.body_battery != null && f.body_battery !== null && (typeof f.body_battery !== 'number' || f.body_battery < 0 || f.body_battery > 100)) {
                errors.push('body_battery doit etre un nombre entre 0 et 100');
            }
            break;
        }
        case 'update_athlete_data': {
            const allowedSections = ['profile', 'zones', 'injury', 'calendar', 'predictions', 'projection', 'work_axes', 'race_history', 'index_progression', 'health_factors', 'health_note', 'health_perf_impact', 'health_intro'];
            if (!input.section || !allowedSections.includes(input.section)) {
                errors.push('section doit etre une des valeurs: ' + allowedSections.join(', '));
            }
            if (input.data == null) {
                errors.push('data ne peut pas etre null/undefined');
            }
            break;
        }
        case 'write_week_plan': {
            if (!input.week || !/^\d{4}-W\d{2}$/.test(input.week)) {
                errors.push('week doit etre au format YYYY-Wxx');
            }
            if (typeof input.content !== 'string') {
                errors.push('content doit etre une string');
            } else if (input.content.length > 50000) {
                errors.push('content depasse 50Ko');
            }
            break;
        }
        case 'write_reference_file': {
            const allowedFiles = ['profil', 'blessures', 'zones', 'calendrier', 'previsions', 'race_history'];
            if (!input.file || !allowedFiles.includes(input.file)) {
                errors.push('file doit etre une des valeurs: ' + allowedFiles.join(', '));
            }
            if (typeof input.content !== 'string') {
                errors.push('content doit etre une string');
            } else if (input.content.length > 100000) {
                errors.push('content depasse 100Ko');
            }
            break;
        }
        case 'update_longterm': {
            const f2 = input.fields || {};
            const allowedStatuses = ['repos', 'en_forme', 'en_retard', 'dans_les_temps', 'avance'];
            if (f2.status && !allowedStatuses.includes(f2.status)) {
                errors.push('status doit etre une des valeurs: ' + allowedStatuses.join(', '));
            }
            break;
        }
    }

    if (errors.length > 0) {
        return { valid: false, error: 'Validation error: ' + errors.join('; ') };
    }
    return { valid: true };
}

// ===== ARRAY TRUNCATION WARNING =====
function checkArrayTruncation(toolName, input, athlete) {
    if (toolName !== 'update_athlete_data') return null;
    const arraySections = ['predictions', 'work_axes', 'race_history', 'health_factors'];
    if (!arraySections.includes(input.section)) return null;
    if (!Array.isArray(input.data)) return null;

    const existing = readAthleteData(athlete);
    const existingArr = existing[input.section];
    if (!Array.isArray(existingArr) || existingArr.length === 0) return null;

    if (input.data.length < existingArr.length * 0.5) {
        const msg = `Troncature detectee: ${input.data.length} items envoyes pour ${input.section} (existant: ${existingArr.length}). Envoie le tableau COMPLET.`;
        console.warn('[BLOCKED]', msg);
        return msg;
    }
    return null;
}

// ===== ANTHROPIC CLIENT =====
const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

// ===== CHAT HISTORY =====
function getChatHistoryFile(athlete) {
    return CHAT_HISTORY_FILES[athlete] || CHAT_HISTORY_FILES.yohann;
}

function readChatHistory(athlete) {
    try {
        return JSON.parse(fs.readFileSync(getChatHistoryFile(athlete), 'utf8'));
    } catch {
        return { messages: [] };
    }
}

function writeChatHistory(history, athlete) {
    const file = getChatHistoryFile(athlete);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Prune: keep max 200 messages
    if (history.messages && history.messages.length > 200) {
        history.messages = history.messages.slice(-200);
    }
    fs.writeFileSync(file, JSON.stringify(history, null, 2) + '\n', 'utf8');
}

// ===== SYSTEM PROMPT BUILDER =====
function readFileOrEmpty(filePath) {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function buildSystemPrompt(athlete) {
    const ctx = ATHLETE_CONTEXT_FILES[athlete] || ATHLETE_CONTEXT_FILES.yohann;
    const claudeMd = readFileOrEmpty(path.join(__dirname, 'CLAUDE.md'));
    const profil = readFileOrEmpty(ctx.profil);
    const blessures = readFileOrEmpty(ctx.blessures);
    const zones = readFileOrEmpty(ctx.zones);
    const calendrier = readFileOrEmpty(ctx.calendrier);

    const name = athlete === 'juliette' ? 'Juliette Sailland' : 'Yohann Tschudi';
    const injury = athlete === 'juliette'
        ? 'fissure meniscale genou droit (gestion chronique)'
        : 'fragilite chronique bilaterale jonction mollet/soleaire (4 episodes)';
    const objectif = athlete === 'juliette'
        ? 'Grand to Grand Ultra (20 sept 2026, 275km / 6 etapes, Arizona)'
        : 'OCC (27 aout 2026, 57km / 3500 D+, UTMB week)';

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekNum = getISOWeek(now);
    const weekStr = now.getFullYear() + '-W' + String(weekNum).padStart(2, '0');
    const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const monthNames = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

    function dateFr(d) {
        return dayNames[d.getDay()] + ' ' + d.getDate() + ' ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
    }
    function dateISO(d) { return d.toISOString().slice(0, 10); }

    // Pre-compute next 14 days so the AI never guesses day-of-week
    const next14 = [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        next14.push(dateISO(d) + ' = ' + dateFr(d));
    }

    // Compute days until each race
    function daysUntil(dateStr) {
        const target = new Date(dateStr + 'T00:00:00');
        return Math.round((target - now) / 86400000);
    }
    function weeksUntil(dateStr) {
        return Math.round(daysUntil(dateStr) / 7);
    }

    let racesCountdown;
    if (athlete === 'juliette') {
        racesCountdown = [
            { name: 'GRV 100K Ventoux', date: '2026-04-25' },
            { name: 'Maxi-Race 57km', date: '2026-05-23' },
            { name: 'Pierres Dorees', date: '2026-07-04' },
            { name: 'Grand to Grand Ultra (OBJ A)', date: '2026-09-20' }
        ];
    } else {
        racesCountdown = [
            { name: 'Cabornis', date: '2026-03-08' },
            { name: 'MMT', date: '2026-04-26' },
            { name: 'Marathon-eXperience', date: '2026-05-31' },
            { name: 'Monistrail', date: '2026-06-14' },
            { name: 'OCC (OBJ A)', date: '2026-08-27' }
        ];
    }
    const countdownStr = racesCountdown.map(r => {
        const d = daysUntil(r.date);
        const w = weeksUntil(r.date);
        if (d < 0) return r.name + ' : PASSEE (il y a ' + Math.abs(d) + ' jours)';
        if (d === 0) return r.name + ' : AUJOURD\'HUI !';
        return r.name + ' : J-' + d + ' (' + w + ' semaines)';
    }).join('\n');

    return `Tu es un coach trail running et cross-training. Francais, tutoiement, direct.
Tu reponds dans un CHAT MOBILE (telephone) — pas de titres #, pas de tableaux |, pas de ---. Utilise **gras**, listes, et texte court.
Hors-sujet trail/sport → "Je suis ton coach trail. Pose-moi une question sur ton entrainement."

${claudeMd}

=== DATE ===
Aujourd'hui : ${dateFr(now)} (${today}, semaine ${weekStr}).
Les 14 prochains jours :
${next14.join('\n')}
Courses : ${countdownStr}

=== ATHLETE : ${name} ===
Fragilite : ${injury}. Objectif A : ${objectif}.

${profil}

=== BLESSURES ===
${blessures}

=== ZONES ===
${zones}

=== CALENDRIER ===
${calendrier}

=== OUTILS ===
Tu as des outils pour lire et modifier toutes les donnees + internet (web_search).
Utilise-les. Lis avant de repondre. Lis le plan de semaine avant de parler d'un jour.
Ne reponds jamais de memoire quand tu peux verifier avec un outil.

=== DASHBOARD ===
L'outil update_athlete_data modifie les donnees affichees dans le dashboard en temps reel.
Utilise-le AUTOMATIQUEMENT quand l'athlete donne une info qui change un chiffre du dashboard :
- Poids, taille, FC repos, FC max, VO2max → section "profile"
- Zones FC → section "zones"
- Bilan blessure, tests, protocole → section "injury"
- Resultat de course, nouvelle course → section "calendar" ou "race_history"
- Previsions de temps → section "predictions"
- Facteurs sante (sommeil, nicotine, etc.) → section "health_factors"
N'oublie pas : modifie AUSSI le fichier markdown de reference (write_reference_file) pour garder la coherence.`;
}

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ===== WEEK PLAN PARSER =====
const DAY_OFFSETS = {
    'lundi': 0, 'mardi': 1, 'mercredi': 2, 'jeudi': 3, 'vendredi': 4, 'samedi': 5, 'dimanche': 6
};

function weekDayToDate(weekId, dayName) {
    // weekId = "2026-W07", dayName = "lundi"
    const match = weekId.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;
    const year = parseInt(match[1]);
    const week = parseInt(match[2]);
    // ISO week: Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7; // Mon=1..Sun=7
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
    const offset = DAY_OFFSETS[dayName.toLowerCase()] || 0;
    const result = new Date(monday);
    result.setUTCDate(monday.getUTCDate() + offset);
    return result.toISOString().slice(0, 10);
}

function badgeClassFromTitle(title) {
    const t = (title || '').toLowerCase();
    if (/natation|nage|piscine|swim/.test(t)) return 'badge-purple';
    if (/retest|test/.test(t)) return 'badge-red';
    if (/repos|off/.test(t)) return 'badge-grey';
    if (/sortie longue|long run/.test(t)) return 'badge-orange';
    if (/footing|trail|course/.test(t)) return 'badge-green';
    return 'badge-blue';
}

function parseWeekPlan(markdown, weekId) {
    const lines = markdown.split('\n');
    const result = {
        week: weekId,
        title: '',
        bloc: '',
        objective: '',
        volume: '',
        days: []
    };

    // Extract title from first H1/H2
    for (const line of lines) {
        const m = line.match(/^#+\s+(.+)/);
        if (m && !result.title) {
            result.title = m[1].trim();
            break;
        }
    }

    // Extract bloc
    for (const line of lines) {
        const m = line.match(/\*\*?\s*(?:Bloc|BLOC)\s*[:\s]*(.+?)\*\*?/i) || line.match(/^##\s+Bloc\s*:\s*(.+)/i);
        if (m) { result.bloc = m[1].trim(); break; }
    }
    // Fallback: extract bloc from title (e.g. "Bloc 0 : Reprise & Soin")
    if (!result.bloc && result.title) {
        const blocInTitle = result.title.match(/Bloc\s+\d+\s*[:\—\-]\s*(.+)/i);
        if (blocInTitle) {
            result.bloc = 'Bloc ' + result.title.match(/Bloc\s+(\d+)/i)[1] + ' — ' + blocInTitle[1].trim();
        }
    }

    // Extract objective
    for (const line of lines) {
        const m = line.match(/\*\*Objectif.*?\*\*\s*:\s*(.+)/i) || line.match(/\*\*Objectif.*?\*\*\s+(.+)/i);
        if (m) { result.objective = m[1].trim(); break; }
    }

    // Extract volume
    for (const line of lines) {
        const m = line.match(/\*\*Volume.*?\*\*\s*:\s*(.+)/i);
        if (m) { result.volume = m[1].trim(); break; }
    }

    // Detect format: table or headings
    const hasTable = lines.some(l => /^\|.*\|.*\|/.test(l) && /lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i.test(l));

    if (hasTable) {
        // Table format (Juliette)
        parseTableFormat(lines, weekId, result);
    } else {
        // Heading format (Yohann)
        parseHeadingFormat(lines, weekId, result);
    }

    return result;
}

function parseTableFormat(lines, weekId, result) {
    // Find the planning table
    const tableLines = [];
    let inTable = false;
    for (const line of lines) {
        if (/^\|.*\|/.test(line)) {
            if (/jour|seance|duree/i.test(line.toLowerCase())) { inTable = true; continue; }
            if (inTable && /^[\|\s-]+$/.test(line)) continue; // separator
            if (inTable) tableLines.push(line);
        } else if (inTable && tableLines.length > 0) {
            // Check if this is a second table (details) — stop
            break;
        }
    }

    tableLines.forEach(line => {
        const cells = line.split('|').map(s => s.trim()).filter(Boolean);
        if (cells.length < 2) return;

        const dayCell = cells[0]; // "Lundi 10"
        const dayMatch = dayCell.match(/(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*(\d+)?/i);
        if (!dayMatch) return;

        const dayName = dayMatch[1];
        const dayNum = dayMatch[2] ? parseInt(dayMatch[2]) : null;
        const date = weekDayToDate(weekId, dayName);

        const seance = cells[1] || '';
        const duree = cells[2] || '';
        const zone = cells[3] || '';
        const dplus = cells[4] || '';
        const notes = cells[5] || '';

        const title = seance;
        const isRepos = /repos/i.test(seance);

        let detailsHtml = '';
        if (!isRepos) {
            detailsHtml = '<strong>' + escapeHtml(seance) + '</strong>';
            if (duree) detailsHtml += ' ' + escapeHtml(duree);
            if (zone && zone !== '—' && zone !== '-') detailsHtml += ' <span class="text-blue">' + escapeHtml(zone) + '</span>';
            if (dplus && dplus !== '—' && dplus !== '-') detailsHtml += ' · D+ ' + escapeHtml(dplus);
            if (notes && notes !== '—' && notes !== '-') detailsHtml += '<br>' + escapeHtml(notes);
        } else {
            detailsHtml = '<strong>Repos complet</strong>';
            if (notes && notes !== '—' && notes !== '-') detailsHtml += '. ' + escapeHtml(notes);
        }

        const checks = isRepos ? [] : title.split(/[+,]/).map(s => s.trim()).filter(Boolean);

        result.days.push({
            date: date,
            dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase(),
            dayNum: dayNum || (date ? parseInt(date.slice(-2)) : null),
            title: title,
            detailsHtml: detailsHtml,
            checks: checks,
            badgeClass: badgeClassFromTitle(title),
            highlight: /retest|test/i.test(title)
        });
    });
}

function parseHeadingFormat(lines, weekId, result) {
    let currentDay = null;
    let detailLines = [];

    function flushDay() {
        if (!currentDay) return;
        // Build detailsHtml from bullet lines
        let html = '';
        detailLines.forEach(line => {
            // Parse "- **Séance** : xxx" format
            let cleaned = line.replace(/^-\s*/, '');
            // Skip "Réalisé", "FC moy réelle", "RPE" fields (template fields)
            if (/^\*\*R[eé]alis[eé]\*\*/i.test(cleaned)) return;
            if (/^\*\*FC moy/i.test(cleaned)) return;
            if (/^\*\*RPE\*\*\s*:\s*\/10/i.test(cleaned)) return;
            if (/^\*\*Terrain\*\*/i.test(cleaned)) return;
            // Convert markdown bold to HTML
            cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            // Convert zone references to colored spans
            cleaned = cleaned.replace(/(Z[1-5](?:-Z[1-5])?\s*\([^)]+\))/g, '<span class="text-blue">$1</span>');
            if (cleaned.trim()) {
                html += (html ? '<br>' : '') + cleaned.trim();
            }
        });
        currentDay.detailsHtml = html;
        // Extract checks from title (split on +)
        currentDay.checks = currentDay.title.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
        // Detect repos
        if (/repos|off/i.test(currentDay.title) && currentDay.checks.length <= 1) {
            currentDay.checks = [];
        }
        result.days.push(currentDay);
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match ### Lundi 9 fév. — Title
        const dayMatch = line.match(/^###\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d+)\s+[^—–\-]*[—–\-]\s*(.+)/i);
        if (dayMatch) {
            flushDay();
            const dayName = dayMatch[1];
            const dayNum = parseInt(dayMatch[2]);
            const title = dayMatch[3].trim();
            const date = weekDayToDate(weekId, dayName);
            currentDay = {
                date: date,
                dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase(),
                dayNum: dayNum,
                title: title,
                detailsHtml: '',
                checks: [],
                badgeClass: badgeClassFromTitle(title),
                highlight: /retest|test/i.test(title)
            };
            detailLines = [];
            continue;
        }

        // Also match ### Lundi 9 — Title (without month)
        const dayMatch2 = line.match(/^###\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d+)\s*[—–\-]\s*(.+)/i);
        if (!dayMatch && dayMatch2) {
            flushDay();
            const dayName = dayMatch2[1];
            const dayNum = parseInt(dayMatch2[2]);
            const title = dayMatch2[3].trim();
            const date = weekDayToDate(weekId, dayName);
            currentDay = {
                date: date,
                dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase(),
                dayNum: dayNum,
                title: title,
                detailsHtml: '',
                checks: [],
                badgeClass: badgeClassFromTitle(title),
                highlight: /retest|test/i.test(title)
            };
            detailLines = [];
            continue;
        }

        // Collect detail lines (bullets under the day heading)
        if (currentDay && /^-\s+/.test(line)) {
            detailLines.push(line);
        }

        // Stop collecting on next section (## or ---)
        if (currentDay && (/^##\s/.test(line) || /^---/.test(line))) {
            flushDay();
            currentDay = null;
            detailLines = [];
        }
    }
    flushDay();

    // Fallback: if no structured days found, try bold-format entries
    // e.g. "**Samedi 7 fév** : title" or "**Dimanche 8 fév** : title"
    if (result.days.length === 0) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const boldMatch = line.match(/\*\*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d+)[^*]*\*\*\s*[:：]\s*(.+)/i);
            if (boldMatch) {
                const dayName = boldMatch[1];
                const dayNum = parseInt(boldMatch[2]);
                const title = boldMatch[3].trim();
                const date = weekDayToDate(weekId, dayName);
                // Collect subsequent bullet lines as details
                let detailHtml = '';
                for (let j = i + 1; j < lines.length; j++) {
                    if (/^-\s+/.test(lines[j])) {
                        let cleaned = lines[j].replace(/^-\s*/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                        detailHtml += (detailHtml ? '<br>' : '') + cleaned.trim();
                    } else if (/^\*\*/.test(lines[j]) || /^##/.test(lines[j]) || /^---/.test(lines[j])) {
                        break;
                    }
                }
                if (!detailHtml) detailHtml = escapeHtml(title);
                result.days.push({
                    date: date,
                    dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase(),
                    dayNum: dayNum,
                    title: title,
                    detailsHtml: detailHtml,
                    checks: /repos|off/i.test(title) ? [] : title.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean),
                    badgeClass: badgeClassFromTitle(title),
                    highlight: /retest|test/i.test(title)
                });
            }
        }
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== CHAT TOOLS =====
const CHAT_TOOLS = [
    {
        name: 'read_coach_log',
        description: 'Lire le coach-log complet (daily entries + longterm trajectory). Utilise cet outil pour analyser la charge recente, la fatigue, les metriques de blessure.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'update_daily',
        description: 'Creer ou modifier une entree quotidienne dans le coach-log. Utilise apres un debrief pour enregistrer les donnees du jour.',
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
                fields: {
                    type: 'object',
                    description: 'Champs a mettre a jour (soleaire/genou, rpe, sommeil_h, body_battery, verdict, phase, diner, nicotine, hydratation, checks)',
                    properties: {
                        soleaire: { type: 'number' },
                        genou: { type: 'number' },
                        rpe: { type: ['number', 'null'] },
                        sommeil_h: { type: ['number', 'null'] },
                        body_battery: { type: ['integer', 'null'] },
                        verdict: { type: ['string', 'null'] },
                        phase: { type: ['string', 'null'] },
                        diner: { type: 'boolean' },
                        nicotine: { type: 'boolean' },
                        hydratation: { type: 'boolean' },
                        checks: { type: 'object' }
                    }
                }
            },
            required: ['date', 'fields']
        }
    },
    {
        name: 'update_longterm',
        description: 'Modifier la trajectoire long terme (status, bloc, next_race, trajectory). Utilise lors d\'un changement de phase ou bilan.',
        input_schema: {
            type: 'object',
            properties: {
                fields: {
                    type: 'object',
                    description: 'Champs longterm a mettre a jour',
                    properties: {
                        status: { type: 'string', enum: ['repos', 'en_forme', 'en_retard', 'dans_les_temps', 'avance'] },
                        current_block: { type: 'string' },
                        next_race: { type: 'string' },
                        trajectory: { type: 'string' }
                    }
                }
            },
            required: ['fields']
        }
    },
    {
        name: 'read_week_plan',
        description: 'Lire le plan d\'entrainement d\'une semaine (fichier semaines/YYYY-Wxx.md). Par defaut, lit la semaine en cours.',
        input_schema: {
            type: 'object',
            properties: {
                week: { type: 'string', description: 'Identifiant semaine au format YYYY-Wxx (ex: 2026-W07). Si omis, semaine en cours.' }
            },
            required: []
        }
    },
    {
        name: 'write_week_plan',
        description: 'Ecrire ou reecrire le plan d\'entrainement complet d\'une semaine (fichier semaines/YYYY-Wxx.md).',
        input_schema: {
            type: 'object',
            properties: {
                week: { type: 'string', description: 'Identifiant semaine au format YYYY-Wxx (ex: 2026-W08)' },
                content: { type: 'string', description: 'Contenu markdown complet du plan de la semaine' }
            },
            required: ['week', 'content']
        }
    },
    {
        name: 'read_activities',
        description: 'Lire les activites recentes Strava + Garmin (courses, natation, elliptique, velo). Contient FC, allure, distance, D+, duree.',
        input_schema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'Nombre d\'activites a retourner (defaut: 20, max: 50)' }
            },
            required: []
        }
    },
    {
        name: 'read_wellness',
        description: 'Lire les donnees sante Garmin : sommeil (duree, deep, REM, score), stress, FC repos, VO2max, body battery, pas. Contient un resume + donnees jour par jour.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'read_race_history',
        description: 'Lire l\'historique complet des courses : dates, distances, D+, temps, classements, UTMB Index, notes.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'read_race_predictions',
        description: 'Lire les PREVISIONS de temps pour les courses a venir (Cabornis, MMT, MaraXP, Monistrail, OCC). Contient temps estimes, index cibles, classements estimes, scenarios "si entrainement tenu", et notes tactiques. UTILISE CET OUTIL quand l\'athlete demande ses previsions, objectifs chrono, ou projections.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'update_evaluation',
        description: 'Modifier l\'evaluation de l\'athlete (10 dimensions notees sur 10 + commentaire global). Les 10 dimensions : progression, mental, gestion_effort, socle_aerobie, endurance_ultra, technique_descente, regularite, puissance_montee, resistance_musculaire, recuperation.',
        input_schema: {
            type: 'object',
            properties: {
                trigger: { type: 'string', description: 'Declencheur de l\'evaluation (ex: "Bilan mensuel", "Post-course", "Debrief blessure")' },
                scores: {
                    type: 'object',
                    description: 'Scores par dimension (1-10)',
                    properties: {
                        progression: { type: 'integer', minimum: 1, maximum: 10 },
                        mental: { type: 'integer', minimum: 1, maximum: 10 },
                        gestion_effort: { type: 'integer', minimum: 1, maximum: 10 },
                        socle_aerobie: { type: 'integer', minimum: 1, maximum: 10 },
                        endurance_ultra: { type: 'integer', minimum: 1, maximum: 10 },
                        technique_descente: { type: 'integer', minimum: 1, maximum: 10 },
                        regularite: { type: 'integer', minimum: 1, maximum: 10 },
                        puissance_montee: { type: 'integer', minimum: 1, maximum: 10 },
                        resistance_musculaire: { type: 'integer', minimum: 1, maximum: 10 },
                        recuperation: { type: 'integer', minimum: 1, maximum: 10 }
                    }
                },
                reasons: {
                    type: 'object',
                    description: 'Justification courte pour chaque score modifie'
                },
                global_comment: {
                    type: 'object',
                    description: 'Commentaire global',
                    properties: {
                        forces: { type: 'string' },
                        axes: { type: 'string' },
                        positionnement: { type: 'string' }
                    }
                }
            },
            required: ['trigger', 'scores']
        }
    },
    {
        name: 'update_athlete_data',
        description: 'Modifier les donnees du dashboard. Deep-merge pour objets, remplacement pour tableaux. IMPORTANT : respecte EXACTEMENT les schemas ci-dessous.\n\n'
            + 'SECTION "profile" (objet, deep-merge) :\n'
            + '  { weight_kg: number, height_cm: number, age: number, fc_repos: number, fc_max: number, vo2max: number, vma: number|null, vma_tested: bool, running_stones: number, races_count: number, longest_race: string, utmb_pic: number, utmb_20k: number, utmb_50k: number, utmb_100k: number|null, utmb_100m: number|null }\n'
            + '  Note : imc et rfc sont auto-calcules, ne les envoie pas.\n'
            + '  Note : quand fc_max ou fc_repos change, les zones FC sont auto-recalculees (Karvonen). Ne modifie PAS la section "zones" separement.\n\n'
            + 'SECTION "injury" (objet, deep-merge) :\n'
            + '  { location: string, episode: number, detail: string, status: "active"|"healing"|"managing", assessment_date: "YYYY-MM-DD"|null,\n'
            + '    tests: [{ name: string, value: string, color: "green"|"yellow"|"orange"|"red" }],\n'
            + '    context: [{ label: string, value: string }],\n'
            + '    observation: string,\n'
            + '    protocol: [{ phase: string, entry: string, content: string, status: "en_cours"|"a_venir"|"termine" }],\n'
            + '    decision_point: string|null,\n'
            + '    prevention: [{ action: string, frequency: string }],\n'
            + '    history: [{ num: number, location: string, side: string, severity: string, resolution: string }] }\n\n'
            + 'SECTION "calendar" (objet, deep-merge) :\n'
            + '  { races: [{ date: "YYYY-MM-DD", name: string, distance: string, dplus: string, objective: "A"|"B"|"C"|"done", result: string|null, note: string|null }],\n'
            + '    periodisation: [{ bloc: string, badge_class: string, period: string, focus: string, races: string }],\n'
            + '    gap_analysis: [{ indicator: string, current: string, target: string, gap: string, color: "green"|"yellow"|"orange"|"red" }] }\n\n'
            + 'SECTION "predictions" (tableau, remplacement) :\n'
            + '  [{ name: string, date: string, distance: string, edition_info: string, border_color: "yellow"|"orange"|"red",\n'
            + '     rows: [{ label: string, value: string, bold: bool, green: bool }],\n'
            + '     notes: string }]\n\n'
            + 'SECTION "projection" (objet|null) :\n'
            + '  { title: string, scenarios: [{ label: string, value: string, detail: string, color: "green"|"blue"|"orange"|"red" }] }\n\n'
            + 'SECTION "work_axes" (tableau) :\n'
            + '  [{ rank: number, name: string, impact: string, impact_color: "red"|"orange"|"yellow", tool: string, success: string }]\n\n'
            + 'SECTION "race_history" (tableau) :\n'
            + '  [{ name: string, date: string, distance: string, dplus: string, time: string, ranking: string, utmb_index: number, highlight: bool }]\n\n'
            + 'SECTION "index_progression" (objet) :\n'
            + '  { start_index: number, start_date: string, current_index: number, current_date: string, gain_text: string }\n\n'
            + 'SECTION "health_factors" (tableau) :\n'
            + '  [{ name: string, current: string, color: "green"|"yellow"|"orange"|"red", impact: string, target: string }]\n\n'
            + 'SECTIONS "health_note", "health_perf_impact", "health_intro" : string simple.',
        input_schema: {
            type: 'object',
            properties: {
                section: {
                    type: 'string',
                    enum: ['profile', 'zones', 'injury', 'calendar', 'predictions', 'projection', 'work_axes', 'race_history', 'index_progression', 'health_factors', 'health_note', 'health_perf_impact', 'health_intro'],
                    description: 'Section du dashboard a modifier. NE PAS utiliser "zones" directement — les zones sont auto-calculees quand on modifie fc_max ou fc_repos dans "profile".'
                },
                data: {
                    description: 'Donnees partielles a merger. RESPECTER le schema exact de la section (voir description de l\'outil). Pour les objets : envoyer SEULEMENT les champs qui changent. Pour les tableaux : envoyer le tableau COMPLET.'
                }
            },
            required: ['section', 'data']
        }
    },
    {
        name: 'write_reference_file',
        description: 'Modifier un fichier de reference markdown. Fichiers disponibles : profil (donnees physiques, historique), blessures (suivi blessures, protocoles), zones (zones FC et allures), calendrier (courses 2026, periodisation), previsions (previsions de temps courses 2026), race_history (historique complet des courses). Tu recois le contenu COMPLET du fichier — pas un diff, pas un extrait.',
        input_schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    enum: ['profil', 'blessures', 'zones', 'calendrier', 'previsions', 'race_history'],
                    description: 'Quel fichier modifier'
                },
                content: {
                    type: 'string',
                    description: 'Contenu markdown COMPLET du fichier (remplace entierement le fichier existant). IMPORTANT : lis le fichier d\'abord avec l\'outil de lecture correspondant, puis modifie et renvoie le contenu complet.'
                }
            },
            required: ['file', 'content']
        }
    }
];

// ===== TOOL EXECUTION =====
function executeTool(toolName, toolInput, athlete) {
    const modifications = [];
    let result;

    switch (toolName) {
        case 'read_coach_log': {
            const data = readData(athlete);
            result = JSON.stringify(data, null, 2);
            break;
        }
        case 'update_daily': {
            const data = readData(athlete);
            const date = toolInput.date;
            const fields = toolInput.fields || {};
            let idx = data.daily.findIndex(d => d.date === date);
            if (idx >= 0) {
                Object.assign(data.daily[idx], fields);
            } else {
                data.daily.push({ date, ...fields });
                data.daily.sort((a, b) => a.date.localeCompare(b.date));
            }
            writeData(data, athlete);
            modifications.push({ type: 'daily', date });
            result = 'Entree du ' + date + ' mise a jour.';
            break;
        }
        case 'update_longterm': {
            const data = readData(athlete);
            const fields = toolInput.fields || {};
            data.longterm = { ...data.longterm, ...fields, updated: new Date().toISOString().slice(0, 10) };
            writeData(data, athlete);
            modifications.push({ type: 'longterm' });
            result = 'Trajectoire long terme mise a jour.';
            break;
        }
        case 'read_week_plan': {
            let week = toolInput.week;
            if (!week) {
                const now = new Date();
                week = now.getFullYear() + '-W' + String(getISOWeek(now)).padStart(2, '0');
            }
            const weekDir = WEEK_DIRS[athlete] || WEEK_DIRS.yohann;
            const filePath = path.join(weekDir, week + '.md');
            try {
                result = fs.readFileSync(filePath, 'utf8');
            } catch {
                result = 'Aucun plan trouve pour la semaine ' + week + '.';
            }
            break;
        }
        case 'write_week_plan': {
            const week = toolInput.week;
            const content = toolInput.content;
            const weekDir = WEEK_DIRS[athlete] || WEEK_DIRS.yohann;
            fs.mkdirSync(weekDir, { recursive: true });
            const filePath = path.join(weekDir, week + '.md');
            fs.writeFileSync(filePath, content, 'utf8');
            modifications.push({ type: 'week_plan', week });
            result = 'Plan semaine ' + week + ' ecrit.';
            break;
        }
        case 'read_activities': {
            const files = ACTIVITY_FILES[athlete] || ACTIVITY_FILES.yohann;
            const limit = Math.min(toolInput.limit || 20, 50);
            let strava = [], garmin = [];
            try { strava = JSON.parse(fs.readFileSync(files.strava, 'utf8')); } catch {}
            try { garmin = JSON.parse(fs.readFileSync(files.garmin, 'utf8')); } catch {}
            // Merge and sort by date desc, take most recent
            const all = [...strava.map(a => ({...a, source: a.source || 'strava'})), ...garmin.map(a => ({...a, source: a.source || 'garmin'}))];
            all.sort((a, b) => (b.start_date_local || '').localeCompare(a.start_date_local || ''));
            // Deduplicate by date+type (keep strava version as it has more data)
            const seen = new Set();
            const unique = all.filter(a => {
                const key = (a.start_date_local || '').slice(0, 16) + '|' + (a.type || a.sport_type || '');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            result = JSON.stringify(unique.slice(0, limit), null, 2);
            break;
        }
        case 'read_wellness': {
            const files = ACTIVITY_FILES[athlete] || ACTIVITY_FILES.yohann;
            try {
                result = fs.readFileSync(files.wellness, 'utf8');
            } catch {
                result = 'Pas de donnees wellness disponibles.';
            }
            break;
        }
        case 'read_race_history': {
            const raceFile = RACE_HISTORY_FILES[athlete] || RACE_HISTORY_FILES.yohann;
            try {
                result = fs.readFileSync(raceFile, 'utf8');
            } catch {
                result = 'Pas d\'historique de courses disponible.';
            }
            break;
        }
        case 'read_race_predictions': {
            const predFile = RACE_PREDICTIONS_FILES[athlete] || RACE_PREDICTIONS_FILES.yohann;
            try {
                result = fs.readFileSync(predFile, 'utf8');
            } catch {
                result = 'Pas de previsions de courses disponibles.';
            }
            break;
        }
        case 'update_evaluation': {
            const data = readData(athlete);
            if (!data.longterm) data.longterm = {};
            const prevEval = data.longterm.evaluation || {};
            const prevCurrent = prevEval.current || null;
            const history = prevEval.history || [];

            // Archive previous evaluation in history
            if (prevCurrent) {
                history.push(prevCurrent);
            }

            // Build new evaluation
            const newEval = {
                date: new Date().toISOString().slice(0, 10),
                trigger: toolInput.trigger,
                scores: { ...(prevCurrent ? prevCurrent.scores : {}), ...toolInput.scores },
                reasons: { ...(prevCurrent ? prevCurrent.reasons : {}), ...(toolInput.reasons || {}) },
                global_comment: toolInput.global_comment || (prevCurrent ? prevCurrent.global_comment : { forces: '', axes: '', positionnement: '' })
            };

            data.longterm.evaluation = { current: newEval, history };
            writeData(data, athlete);
            modifications.push({ type: 'evaluation' });
            result = 'Evaluation mise a jour (' + toolInput.trigger + ').';
            break;
        }
        case 'update_athlete_data': {
            const ad = readAthleteData(athlete);
            const section = toolInput.section;
            if (Array.isArray(toolInput.data)) {
                ad[section] = toolInput.data;
            } else if (typeof toolInput.data === 'object' && toolInput.data !== null) {
                if (typeof ad[section] === 'object' && ad[section] !== null && !Array.isArray(ad[section])) {
                    ad[section] = deepMerge(ad[section], toolInput.data);
                } else {
                    ad[section] = toolInput.data;
                }
            } else {
                ad[section] = toolInput.data;
            }
            // Auto-calculate derived fields for profile
            if (section === 'profile' && ad.profile) {
                const p = ad.profile;
                if (p.weight_kg && p.height_cm) {
                    p.imc = Math.round(p.weight_kg / ((p.height_cm / 100) ** 2) * 10) / 10;
                }
                if (p.fc_max && p.fc_repos) {
                    p.rfc = p.fc_max - p.fc_repos;
                }
            }
            // Auto-recalculate zones when profile FC changes or zones format is wrong
            if ((section === 'profile' || section === 'zones') && ad.profile && ad.profile.fc_max && ad.profile.fc_repos) {
                const rfc = ad.profile.fc_max - ad.profile.fc_repos;
                const fcR = ad.profile.fc_repos;
                const needsRecalc = section === 'profile'
                    || !Array.isArray(ad.zones)
                    || ad.zones.length === 0
                    || !ad.zones[0].min;
                if (needsRecalc) {
                    const pcts = [[50,60],[60,70],[70,80],[80,90],[90,100]];
                    ad.zones = pcts.map(function(p, i) {
                        return { label: 'Z' + (i+1), min: Math.round(fcR + rfc * p[0] / 100), max: Math.round(fcR + rfc * p[1] / 100) };
                    });
                }
            }
            writeAthleteData(ad, athlete);
            modifications.push({ type: 'athlete_data', section });
            result = 'Donnees ' + section + ' mises a jour dans le dashboard.';
            break;
        }
        case 'write_reference_file': {
            const ctx = ATHLETE_CONTEXT_FILES[athlete] || ATHLETE_CONTEXT_FILES.yohann;
            const fileMap = {
                profil: ctx.profil,
                blessures: ctx.blessures,
                zones: ctx.zones,
                calendrier: ctx.calendrier,
                previsions: (RACE_PREDICTIONS_FILES[athlete] || RACE_PREDICTIONS_FILES.yohann),
                race_history: (RACE_HISTORY_FILES[athlete] || RACE_HISTORY_FILES.yohann)
            };
            const filePath = fileMap[toolInput.file];
            if (!filePath) {
                result = 'Fichier inconnu: ' + toolInput.file;
                break;
            }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, toolInput.content, 'utf8');
            modifications.push({ type: 'reference', file: toolInput.file });
            result = 'Fichier ' + toolInput.file + ' mis a jour.';
            break;
        }
        default:
            result = 'Outil inconnu: ' + toolName;
    }

    return { result, modifications };
}

// ===== COST TRACKING =====
const COST_FILE = path.join(__dirname, 'data', 'api-costs.json');
const COST_PER_M_INPUT = 15;   // Opus: $15 / 1M input tokens
const COST_PER_M_OUTPUT = 75;  // Opus: $75 / 1M output tokens
const DAILY_BUDGET_USD = 6;    // $6/jour max
const MONTHLY_BUDGET_USD = 50; // $50/mois max

const BUDGET_JOKES_DAILY = [
    'Je suis ton coach, pas ton psy. Reviens demain.',
    'Va voir Yohann, il est de bon conseil. Et gratuit.',
    'Casse pas ton PEL pour me parler.',
    'T\'as claque {cost} aujourd\'hui. Mon comptable pleure.',
    'Meme ton soleaire a besoin de repos. Moi aussi.',
    '{cost} en une journee... tu veux pas plutot courir ?',
    'Budget crame. Va faire du gainage, c\'est gratuit.',
    'Claude a besoin de dormir aussi. Reviens demain.',
    'T\'as depense {cost}. C\'est plus cher que ta licence UTMB par jour.',
    'Fin de service. Je vais faire mes iso mollets.',
    '{cost} claques. A ce rythme tu finances l\'OCC en tokens.',
    'Mon Body Battery est a 0. Recharge demain.',
    'Meme Juliette depense moins que toi.',
    '{cost}... Tu sais que pour ce prix tu peux acheter 3 gels ?',
    'Le protocole du jour : repos vocal. Reviens demain.',
];

const BUDGET_JOKES_MONTHLY = [
    'Budget du mois explose ({cost}). On se retrouve le 1er.',
    '{cost} ce mois-ci. Tu veux pas investir dans des chaussures plutot ?',
    'Meme l\'UTMB coute moins cher par mois. Reviens le mois prochain.',
];

function todayParis() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD
}

function readCosts() {
    try { return JSON.parse(fs.readFileSync(COST_FILE, 'utf8')); }
    catch { return { daily: {}, monthly: {} }; }
}

function writeCosts(costs) {
    fs.writeFileSync(COST_FILE, JSON.stringify(costs, null, 2) + '\n', 'utf8');
}

function trackCost(usage) {
    if (!usage) return;
    const costs = readCosts();
    const today = todayParis();
    const month = today.slice(0, 7);
    const inputCost = (usage.input_tokens || 0) / 1_000_000 * COST_PER_M_INPUT;
    const outputCost = (usage.output_tokens || 0) / 1_000_000 * COST_PER_M_OUTPUT;
    const totalCost = inputCost + outputCost;

    if (!costs.daily[today]) costs.daily[today] = 0;
    if (!costs.monthly[month]) costs.monthly[month] = 0;
    costs.daily[today] = Math.round((costs.daily[today] + totalCost) * 10000) / 10000;
    costs.monthly[month] = Math.round((costs.monthly[month] + totalCost) * 10000) / 10000;

    // Clean old daily entries (keep 30 days)
    const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffStr = cutoffDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    for (const d of Object.keys(costs.daily)) {
        if (d < cutoffStr) delete costs.daily[d];
    }

    writeCosts(costs);
    console.log(`[cost] +$${totalCost.toFixed(4)} (${usage.input_tokens}in/${usage.output_tokens}out) | jour: $${costs.daily[today].toFixed(2)}/${DAILY_BUDGET_USD} | mois: $${costs.monthly[month].toFixed(2)}/${MONTHLY_BUDGET_USD}`);
    return costs;
}

function checkBudget() {
    const costs = readCosts();
    const today = todayParis();
    const month = today.slice(0, 7);
    const dailyCost = costs.daily[today] || 0;
    const monthlyCost = costs.monthly[month] || 0;

    if (dailyCost >= DAILY_BUDGET_USD) {
        const joke = BUDGET_JOKES_DAILY[Math.floor(Math.random() * BUDGET_JOKES_DAILY.length)];
        return joke.replace(/\{cost\}/g, '$' + dailyCost.toFixed(2));
    }
    if (monthlyCost >= MONTHLY_BUDGET_USD) {
        const joke = BUDGET_JOKES_MONTHLY[Math.floor(Math.random() * BUDGET_JOKES_MONTHLY.length)];
        return joke.replace(/\{cost\}/g, '$' + monthlyCost.toFixed(2));
    }
    return null;
}

// ===== CHAT API HANDLER =====
const _rateLimitMap = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 messages per minute

async function handleChat(athlete, message) {
    if (!anthropic) {
        throw new Error('ANTHROPIC_API_KEY non configuree. Lancez le serveur avec ANTHROPIC_API_KEY=sk-ant-xxx node backoffice.js');
    }

    // Budget check
    const budgetError = checkBudget();
    if (budgetError) throw new Error(budgetError);

    // Rate limiting
    const now = Date.now();
    if (!_rateLimitMap[athlete]) _rateLimitMap[athlete] = [];
    _rateLimitMap[athlete] = _rateLimitMap[athlete].filter(t => now - t < RATE_LIMIT_WINDOW);
    if (_rateLimitMap[athlete].length >= RATE_LIMIT_MAX) {
        throw new Error('Trop de messages. Attends un peu avant de renvoyer.');
    }
    _rateLimitMap[athlete].push(now);

    // Load history, add user message
    const history = readChatHistory(athlete);
    history.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    });
    writeChatHistory(history, athlete);

    // Build API messages — estimate tokens and trim to fit budget
    const systemPrompt = buildSystemPrompt(athlete);
    const TOKEN_BUDGET = 20000; // keep well under 30K/min rate limit
    const systemTokensEstimate = Math.ceil(systemPrompt.length / 3.5);
    const toolsTokensEstimate = 1500; // CHAT_TOOLS schema ~1500 tokens
    const budgetForMessages = TOKEN_BUDGET - systemTokensEstimate - toolsTokensEstimate;

    let recentMessages = history.messages.slice(-10);
    // Trim oldest messages until we fit the budget
    while (recentMessages.length > 2) {
        const msgTokens = recentMessages.reduce((sum, m) => sum + Math.ceil((m.content || '').length / 3.5), 0);
        if (msgTokens <= budgetForMessages) break;
        recentMessages = recentMessages.slice(1);
    }
    const apiMessages = recentMessages.map(m => ({ role: m.role, content: m.content }));

    const allModifications = [];

    let response;
    let iterations = 0;
    const MAX_ITERATIONS = 8;
    let currentMessages = apiMessages;

    while (iterations < MAX_ITERATIONS) {
        iterations++;
        let retries = 0;
        while (true) {
            try {
                response = await Promise.race([
                    anthropic.messages.create({
                        model: 'claude-opus-4-6',
                        max_tokens: 4096,
                        system: systemPrompt,
                        tools: [
                            { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
                            ...CHAT_TOOLS
                        ],
                        messages: currentMessages
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: API did not respond within 60s')), 60000))
                ]);
                trackCost(response.usage);
                break;
            } catch (apiErr) {
                if (apiErr.status === 429 && retries < 3) {
                    retries++;
                    const wait = retries * 15000; // 15s, 30s, 45s
                    console.log(`[chat] Rate limited, retry ${retries}/3 in ${wait/1000}s...`);
                    await new Promise(r => setTimeout(r, wait));
                } else {
                    throw apiErr;
                }
            }
        }

        if (response.stop_reason === 'tool_use') {
            // Execute all tool calls
            const toolResults = [];
            for (const block of response.content) {
                if (block.type === 'tool_use') {
                    // Validate input before execution
                    const validation = validateToolInput(block.name, block.input);
                    if (!validation.valid) {
                        console.warn('[validation]', block.name, validation.error);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: 'ERREUR: ' + validation.error
                        });
                        continue;
                    }
                    // Check for accidental array truncation
                    const truncErr = checkArrayTruncation(block.name, block.input, athlete);
                    if (truncErr) {
                        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ERREUR: ' + truncErr });
                        continue;
                    }
                    try {
                        const { result, modifications } = executeTool(block.name, block.input, athlete);
                        allModifications.push(...modifications);
                        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
                    } catch (toolErr) {
                        console.error('[tool-error]', block.name, toolErr.message);
                        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ERREUR: ' + toolErr.message });
                    }
                }
            }

            // Add assistant response + tool results to messages and continue
            currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: response.content },
                ...toolResults.map(tr => ({ role: 'user', content: [tr] }))
            ];
        } else {
            // end_turn — extract text
            break;
        }
    }

    // Extract final text response
    let textResponse = '';
    for (const block of response.content) {
        if (block.type === 'text') {
            textResponse += block.text;
        }
    }

    // Save assistant response to history
    history.messages.push({
        role: 'assistant',
        content: textResponse,
        timestamp: new Date().toISOString()
    });
    writeChatHistory(history, athlete);

    return {
        response: textResponse,
        modifications: allModifications,
        usage: response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : null
    };
}

// ===== CORS HELPER =====
const ALLOWED_ORIGINS = [
    'https://dreamskid.github.io',
    'http://localhost',
    'http://127.0.0.1',
    'null' // file:// protocol sends "null" as origin
];
function setCorsHeaders(res, req) {
    var origin = req && req.headers && req.headers.origin || '';
    var allowed = ALLOWED_ORIGINS.some(function(o) { return origin === o || origin.startsWith(o); })
        || origin.includes('.ngrok') || origin.includes('.ngrok-free');
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');
}

// ===== ATHLETE VALIDATION =====
const VALID_ATHLETES = ['yohann', 'juliette'];
function validateAthlete(raw) {
    var a = (raw || 'yohann').toLowerCase();
    return VALID_ATHLETES.includes(a) ? a : 'yohann';
}

function getDataFile(athlete) {
    return DATA_FILES[athlete] || DATA_FILES.yohann;
}

function readData(athlete) {
    try {
        return JSON.parse(fs.readFileSync(getDataFile(athlete), 'utf8'));
    } catch {
        return { daily: [], longterm: {} };
    }
}

function writeData(data, athlete) {
    var file = getDataFile(athlete);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readDataLocked(athlete) {
    return withFileLock(getDataFile(athlete), () => readData(athlete));
}

function writeDataLocked(data, athlete) {
    return withFileLock(getDataFile(athlete), () => writeData(data, athlete));
}

function readAthleteDataLocked(athlete) {
    const file = ATHLETE_DATA_FILES[athlete] || ATHLETE_DATA_FILES.yohann;
    return withFileLock(file, () => readAthleteData(athlete));
}

function writeAthleteDataLocked(data, athlete) {
    const file = ATHLETE_DATA_FILES[athlete] || ATHLETE_DATA_FILES.yohann;
    return withFileLock(file, () => writeAthleteData(data, athlete));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('error', err => reject(err));
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
        setCorsHeaders(res, req);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        const athlete = validateAthlete(url.searchParams.get('athlete'));
        const d = readData(athlete);
        const today = d.daily && d.daily.find(e => e.date === todayParis());
        console.log('[DATA]', athlete, 'today:', today ? JSON.stringify(today) : 'none');
        json(res, 200, d);
        return;
    }

    // POST /api/save
    if (req.method === 'POST' && url.pathname === '/api/save') {
        setCorsHeaders(res, req);
        try {
            const payload = await parseBody(req);
            const athlete = validateAthlete(url.searchParams.get('athlete'));
            console.log('[SAVE]', athlete, JSON.stringify(payload).slice(0, 500));

            await withFileLock(getDataFile(athlete), () => {
                const data = readData(athlete);

                // Upsert daily entry (merge into existing)
                if (payload.daily) {
                    const entry = payload.daily;
                    const idx = data.daily.findIndex(d => d.date === entry.date);
                    if (idx >= 0) {
                        Object.keys(entry).forEach(k => { data.daily[idx][k] = entry[k]; });
                    } else {
                        data.daily.push(entry);
                    }
                    data.daily.sort((a, b) => a.date.localeCompare(b.date));
                }

                // Batch upsert daily entries (merge each into existing)
                // Safety: never overwrite non-null soleaire/rpe/genou with null
                const METRIC_KEYS = ['soleaire', 'rpe', 'genou'];
                if (payload.dailyBatch && Array.isArray(payload.dailyBatch)) {
                    payload.dailyBatch.forEach(entry => {
                        const idx = data.daily.findIndex(d => d.date === entry.date);
                        if (idx >= 0) {
                            Object.keys(entry).forEach(k => {
                                if (METRIC_KEYS.includes(k) && entry[k] == null && data.daily[idx][k] != null) {
                                    return; // Don't overwrite existing metric with null
                                }
                                data.daily[idx][k] = entry[k];
                            });
                        } else {
                            data.daily.push(entry);
                        }
                    });
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

                writeData(data, athlete);
            });
            json(res, 200, { ok: true });
        } catch (e) {
            json(res, 400, { error: e.message });
        }
        return;
    }

    // GET /api/athlete-data — All dashboard data for an athlete
    if (req.method === 'GET' && url.pathname === '/api/athlete-data') {
        setCorsHeaders(res, req);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        const athlete = validateAthlete(url.searchParams.get('athlete'));
        json(res, 200, readAthleteData(athlete));
        return;
    }

    // POST /api/publish
    if (req.method === 'POST' && url.pathname === '/api/publish') {
        try {
            const athlete = validateAthlete(url.searchParams.get('athlete'));
            const dataFile = athlete === 'juliette' ? 'data/juliette/coach-log.json' : 'data/coach-log.json';
            const cwd = __dirname;
            execSync('git add -- ' + JSON.stringify(dataFile), { cwd });
            const today = new Date().toISOString().slice(0, 10);
            const name = athlete === 'juliette' ? 'Juliette' : 'Yohann';
            const commitMsg = 'Coach log ' + name + ': ' + today;
            execSync('git commit -m ' + JSON.stringify(commitMsg), { cwd });
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

    // GET /api/week-plan — Parse and return week plan as JSON
    if (req.method === 'GET' && url.pathname === '/api/week-plan') {
        setCorsHeaders(res, req);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        const athlete = validateAthlete(url.searchParams.get('athlete'));
        let week = url.searchParams.get('week');
        if (!week) {
            const now = new Date();
            week = now.getFullYear() + '-W' + String(getISOWeek(now)).padStart(2, '0');
        }
        const weekDir = WEEK_DIRS[athlete] || WEEK_DIRS.yohann;
        const filePath = path.join(weekDir, week + '.md');
        try {
            const md = fs.readFileSync(filePath, 'utf8');
            const plan = parseWeekPlan(md, week);
            json(res, 200, plan);
        } catch {
            json(res, 200, { notFound: true, week: week });
        }
        return;
    }

    // ===== CORS Preflight =====
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res, req);
        res.writeHead(204);
        res.end();
        return;
    }

    // POST /api/chat — Send a message to the coach AI
    if (req.method === 'POST' && url.pathname === '/api/chat') {
        setCorsHeaders(res, req);
        try {
            const payload = await parseBody(req);
            const athlete = payload.athlete || 'yohann';
            const message = payload.message;
            if (!message || !message.trim()) {
                json(res, 400, { error: 'Message vide' });
                return;
            }
            const result = await handleChat(athlete, message.trim());
            json(res, 200, result);
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // GET /api/chat-history — Load chat history
    if (req.method === 'GET' && url.pathname === '/api/chat-history') {
        setCorsHeaders(res, req);
        const athlete = validateAthlete(url.searchParams.get('athlete'));
        json(res, 200, readChatHistory(athlete));
        return;
    }

    // POST /api/chat-clear — Clear chat history (new conversation)
    if (req.method === 'POST' && url.pathname === '/api/chat-clear') {
        setCorsHeaders(res, req);
        const athlete = validateAthlete(url.searchParams.get('athlete'));
        writeChatHistory({ messages: [] }, athlete);
        json(res, 200, { ok: true });
        return;
    }

    // GET /api/costs — View API cost tracking
    if (req.method === 'GET' && url.pathname === '/api/costs') {
        setCorsHeaders(res, req);
        const costs = readCosts();
        const today = todayParis();
        const month = today.slice(0, 7);
        json(res, 200, {
            today: { cost: costs.daily[today] || 0, budget: DAILY_BUDGET_USD },
            month: { cost: costs.monthly[month] || 0, budget: MONTHLY_BUDGET_USD },
            daily_history: costs.daily
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`\n  Back Office Coach Trail`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  Chat IA : ${anthropic ? 'actif' : 'inactif (ANTHROPIC_API_KEY manquante)'}\n`);
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

    <!-- Athlete selector -->
    <div class="card">
        <div class="toggle-row" style="margin-bottom: 0;">
            <button class="toggle-btn active" id="ath-yohann" onclick="switchAthlete('yohann')">Yohann</button>
            <button class="toggle-btn" id="ath-juliette" onclick="switchAthlete('juliette')">Juliette</button>
        </div>
    </div>

    <!-- Date picker -->
    <div class="card">
        <div class="field">
            <label>Date</label>
            <input type="date" id="f-date">
        </div>
    </div>

    <!-- Metriques -->
    <div class="card">
        <h2>M\u00e9triques du jour</h2>

        <div class="field">
            <label><span id="injury-label">Sol\u00e9aire</span> <span id="sol-color" style="font-size:11px;"></span></label>
            <div class="slider-row">
                <input type="range" id="f-soleaire" min="0" max="10" step="0.5" value="0">
                <span class="slider-val" id="sol-val">0</span>
            </div>
        </div>

        <div class="field">
            <label>RPE
                <button class="toggle-btn no-session" id="f-no-session" onclick="toggleNoSession()">Pas de s\u00e9ance</button>
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

    <!-- Hygi\u00e8ne -->
    <div class="card">
        <h2>Hygi\u00e8ne de vie</h2>
        <div class="toggle-row">
            <button class="toggle-btn" id="f-diner" onclick="toggleBtn('f-diner')">D\u00eener l\u00e9ger</button>
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
                    <button class="toggle-btn" id="lt-en_forme" onclick="setLtStatus('en_forme')">En forme</button>
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
            <h2 style="margin-bottom:0;">R\u00e9glages</h2>
        </div>
        <div class="collapsible-body" id="settings-section">
            <div class="field">
                <label>GitHub Token (sync Strava/Garmin)</label>
                <input type="password" id="f-gh-token" placeholder="ghp_xxxxxxxxxxxx...">
                <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Stock\u00e9 en base64 dans coach-log.json. Partag\u00e9 entre tous les devices.</p>
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
const INJURY_CONFIG = {
    yohann: { key: 'soleaire', label: 'Sol\u00e9aire' },
    juliette: { key: 'genou', label: 'Genou droit' }
};
const DEFAULT_CHECKS_MAP = {
    yohann: ['Iso mollets', 'PPG haut du corps', 'PPG compl\u00e8te', 'Iso / excentriques', 'Test phase 2', 'Retest saut'],
    juliette: ['Renfo quadriceps', '\u00c9tirements', 'PPG quadriceps', 'Glace genou']
};
let currentAthlete = 'yohann';
let activeChecks = {};
let noSession = false;
let ltStatus = '';
let allData = { daily: [], longterm: {} };

function switchAthlete(athlete) {
    if (athlete === currentAthlete) return;
    currentAthlete = athlete;
    document.getElementById('ath-yohann').classList.toggle('active', athlete === 'yohann');
    document.getElementById('ath-juliette').classList.toggle('active', athlete === 'juliette');
    // Update injury label
    var ic = INJURY_CONFIG[athlete] || INJURY_CONFIG.yohann;
    document.getElementById('injury-label').textContent = ic.label;
    // Reload data for this athlete
    fetch('/api/data?athlete=' + athlete)
        .then(r => r.json())
        .then(data => { allData = data; loadEntry(); renderChips(); })
        .catch(() => {});
}

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
    ['repos', 'en_forme', 'en_retard', 'dans_les_temps', 'avance'].forEach(s => {
        document.getElementById('lt-' + s).classList.toggle('active', s === status);
    });
}

// Checks chips
function renderChips() {
    const container = document.getElementById('checks-chips');
    container.innerHTML = '';
    const DEFAULT_CHECKS = DEFAULT_CHECKS_MAP[currentAthlete] || DEFAULT_CHECKS_MAP.yohann;
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
fetch('/api/data?athlete=' + currentAthlete)
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
        var injKey = (INJURY_CONFIG[currentAthlete] || INJURY_CONFIG.yohann).key;
        solSlider.value = entry[injKey] ?? 0;
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

    var injKey = (INJURY_CONFIG[currentAthlete] || INJURY_CONFIG.yohann).key;
    const daily = {
        date: date,
        [injKey]: parseFloat(solSlider.value),
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
        const targetDate = currentAthlete === 'juliette' ? '2026-09-20' : '2026-08-27';
        const weeksToTarget = Math.ceil((new Date(targetDate) - new Date(date)) / (7 * 24 * 60 * 60 * 1000));
        const weeksKey = currentAthlete === 'juliette' ? 'g2g_weeks_remaining' : 'occ_weeks_remaining';
        payload.longterm = {
            updated: date,
            status: ltStatus || undefined,
            [weeksKey]: weeksToTarget,
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
        const r = await fetch('/api/save?athlete=' + currentAthlete, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await r.json();
        if (r.ok) {
            // Refresh local data
            const refreshed = await fetch('/api/data?athlete=' + currentAthlete).then(r => r.json());
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
        const r = await fetch('/api/publish?athlete=' + currentAthlete, { method: 'POST' });
        const result = await r.json();
        if (r.ok) {
            toast(result.message || 'Publi\u00e9 !', 'success');
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
