# Skill : Coach Trail Expert

Ce skill encode toute la connaissance architecturale du projet Coach Trail Dashboard.

## Architecture globale

### Fichiers principaux

| Fichier | Role | Modifiable par IA |
|---------|------|-------------------|
| `index.html` | Dashboard complet (CSS + HTML + JS inline) | Non directement |
| `backoffice.js` | Serveur Node.js (API + chat IA + tools) | Non directement |
| `data/coach-log.json` | Donnees quotidiennes Yohann | Oui (via tools) |
| `data/athlete-data.json` | Donnees dashboard Yohann | Oui (via tools) |
| `data/juliette/coach-log.json` | Donnees quotidiennes Juliette | Oui (via tools) |
| `data/juliette/athlete-data.json` | Donnees dashboard Juliette | Oui (via tools) |
| `semaines/YYYY-Wxx.md` | Plans semaine Yohann (Markdown) | Oui (write_week_plan) |
| `juliette/semaines/YYYY-Wxx.md` | Plans semaine Juliette (Markdown) | Oui (write_week_plan) |
| `profil.md` / `juliette/profil.md` | Profil athlete Markdown | Oui (write_reference_file) |
| `blessures.md` / `juliette/blessures.md` | Suivi blessures Markdown | Oui (write_reference_file) |
| `zones-entrainement.md` / `juliette/zones-entrainement.md` | Zones FC Markdown | Oui (write_reference_file) |
| `calendrier-2026.md` / `juliette/calendrier-2026.md` | Calendrier Markdown | Oui (write_reference_file) |
| `data/strava-activities.json` | Activites Strava (sync GitHub Actions) | Non |
| `data/garmin-activities.json` | Activites Garmin (sync GitHub Actions) | Non |
| `data/garmin-wellness.json` | Donnees sante Garmin (sommeil, VFC, stress) | Non |

### Stack technique

- **Frontend** : HTML/CSS/JS inline dans `index.html`, zero framework, zero build
- **Backend** : Node.js natif (`http` module), port 3000, `backoffice.js`
- **IA** : Anthropic API (claude-opus-4-6) via `@anthropic-ai/sdk`
- **Sync** : GitHub Actions (Strava + Garmin sync)
- **Deploiement** : `dreamskid.github.io/coach-trail/` (GitHub Pages) + ngrok pour le chat

## Multi-athlete

### Pattern prefix

Le dashboard supporte 2 athletes : Yohann et Juliette.

```javascript
var ATHLETES = {
    yohann: {
        prefix: '',        // IDs sans prefixe : 'overview', 'week', etc.
        dataDir: 'data/',
        injuryKey: 'soleaire',
        weekSubId: 'week'
    },
    juliette: {
        prefix: 'j-',     // IDs prefixes : 'j-overview', 'j-week', etc.
        dataDir: 'data/juliette/',
        injuryKey: 'genou',
        weekSubId: 'j-week'
    }
};
```

### Regles multi-athlete

- **Selecteur** : 2 boutons au-dessus de la tab-bar (`#athlete-yohann` / `#athlete-juliette`)
- **Wrappers DOM** : `#athlete-yohann` et `#athlete-juliette`, classe `athlete-content`
- **IDs DOM** : Yohann sans prefixe (`overview`), Juliette prefixee `j-` (`j-overview`)
- **Donnees** : `_coachLogByAthlete[athlete]`, `_activitiesByAthlete[athlete]`, `_athleteDataByAthlete[athlete]`, `_weekPlanByAthlete[athlete]`
- **Zones FC** : `_fcZonesByAthlete[athlete]` — zones par athlete, pas globales
- **Scoping DOM** : toujours `document.getElementById('athlete-' + athlete).querySelector(...)`, jamais `document.querySelector(...)` sans scope
- **Lazy loading** : `_loadedAthletes[athlete]` — charge les donnees au premier switch

### Backoffice multi-athlete

- Param `?athlete=yohann|juliette` sur GET/POST
- Config par maps : `DATA_FILES`, `ATHLETE_DATA_FILES`, `WEEK_DIRS`, `ACTIVITY_FILES`, etc.

## Pipeline de chargement

### Phase 1 : 5 fetch paralleles

```javascript
function loadAthleteData(athlete) {
    Promise.all([
        fetchCoachLog(athlete),       // GET /api/data?athlete=X
        fetchWeekPlan(athlete),       // GET /api/week-plan?athlete=X (&week=current + next if Thu+)
        fetchActivities(athlete),     // GET data/strava-activities.json + garmin-activities.json
        fetchGarminData(athlete),     // GET data/garmin-wellness.json
        fetchAthleteProfile(athlete)  // GET /api/athlete-data?athlete=X
    ]).then(function(results) { ... });
}
```

### Phase 2 : Render sequentiel coordonne

Ordre critique (ne pas changer) :

1. `renderProfile()` + `renderZones()` — zones necessaires pour activity matching
2. `renderInjury()`, `renderCalendar()`, `renderPredictions()`, etc.
3. `applyWeekPlan()` — cree les elements DOM `.week-day`
4. `buildTodayCard()` — **DEPLACE** l'element du plan vers `#today-container` (ne clone PAS)
5. `markPastDays()` — ajoute `day-past` aux jours passes
6. `initManualChecks()` — UNE SEULE FOIS
7. `initDayMetrics()` — UNE SEULE FOIS
8. `matchWeekActivities()` — matching activites vs plan
9. `applyCoachLog()` — badges protocole, eval, injury journal/chart
10. `renderGarminWellness()` + `renderActivitiesList()`

### Point critique : buildTodayCard DEPLACE l'element

`buildTodayCard()` prend l'element `.week-day[data-date="aujourd'hui"]` du plan semaine et le DEPLACE dans `#today-container`. Il insere un placeholder dans le plan. Resultat : UN SEUL element `.week-day` par date dans tout le DOM. Zero duplication, zero sync necessaire.

### Refresh cible apres modifications IA

`refreshAfterModification(athlete, modifications)` ne re-fetch que les sources concernees :
- `daily`/`longterm`/`evaluation` → re-fetch coach-log
- `week_plan` → re-fetch week plan
- `athlete_data` → re-fetch athlete profile

## Endpoints API

| Method | Path | Params | Retour |
|--------|------|--------|--------|
| GET | `/api/data` | `?athlete=` | coach-log.json complet |
| POST | `/api/save` | `?athlete=` | body: `{daily, dailyBatch, longterm, settings}` |
| GET | `/api/week-plan` | `?athlete=&week=` | Plan semaine parse en JSON |
| GET | `/api/athlete-data` | `?athlete=` | athlete-data.json complet |
| POST | `/api/chat` | body: `{athlete, message}` | `{response, modifications, usage}` |
| GET | `/api/chat-history` | `?athlete=` | Historique chat |
| POST | `/api/chat-clear` | `?athlete=` | Clear chat |
| GET | `/api/costs` | - | Suivi budget API |
| POST | `/api/publish` | `?athlete=` | Git commit + push |

Tous les GET API ont `Cache-Control: no-store`.

## Outils IA (12 tools)

| Outil | Action | Modifie | Auto-calculs |
|-------|--------|---------|-------------|
| `read_coach_log` | Lire coach-log | - | - |
| `update_daily` | Creer/modifier entree jour | coach-log.json | - |
| `update_longterm` | Modifier trajectoire | coach-log.json | - |
| `read_week_plan` | Lire plan semaine | - | - |
| `write_week_plan` | Ecrire plan semaine | semaines/YYYY-Wxx.md | - |
| `read_activities` | Lire activites Strava/Garmin | - | - |
| `read_wellness` | Lire donnees sante Garmin | - | - |
| `read_race_history` | Lire historique courses | - | - |
| `read_race_predictions` | Lire previsions courses | - | - |
| `update_evaluation` | Modifier evaluation 10D | coach-log.json | Archive previous |
| `update_athlete_data` | Modifier dashboard | athlete-data.json | IMC, RFC, zones Karvonen |
| `write_reference_file` | Modifier fichier Markdown | profil/blessures/zones/etc. | - |

### Validation des inputs

`validateToolInput()` est appele AVANT `executeTool()`. Rejette :
- `update_daily` : date pas YYYY-MM-DD, soleaire/genou/rpe hors 0-10, body_battery hors 0-100
- `update_athlete_data` : section hors liste autorisee, data null
- `write_week_plan` : week pas YYYY-Wxx, content > 50Ko
- `write_reference_file` : file hors liste, content > 100Ko
- `update_longterm` : status hors enum

### File locking

`withFileLock(filePath, fn)` — mutex par fichier pour eviter les conflits entre save frontend et tools IA.

## Schemas JSON

### coach-log.json

```json
{
  "daily": [
    {
      "date": "YYYY-MM-DD",
      "soleaire": 0-10 | null,    // Yohann: soleaire, Juliette: genou
      "genou": 0-10 | null,
      "rpe": 0-10 | null,
      "sommeil_h": number | null,
      "body_battery": 0-100 | null,
      "verdict": "string | null",
      "phase": "string | null",
      "diner": boolean,
      "nicotine": boolean,
      "hydratation": boolean,
      "checks": { "Nom seance": true/false, ... }
    }
  ],
  "longterm": {
    "status": "repos|en_forme|en_retard|dans_les_temps|avance",
    "current_block": "string",
    "next_race": "string",
    "trajectory": "string",
    "protocol_phase": 1-5,
    "evaluation": {
      "current": { "date", "trigger", "scores": {10 dims}, "reasons", "global_comment" },
      "history": [...]
    }
  },
  "settings": { "gh_sync_token_obf": "..." }
}
```

### athlete-data.json

```json
{
  "profile": {
    "age": number, "height_cm": number, "weight_kg": number,
    "imc": number (auto), "fc_repos": number, "fc_max": number,
    "rfc": number (auto), "vo2max": number, "vma": number|null,
    "vma_tested": boolean, "running_stones": number, "races_count": number,
    "longest_race": "string",
    "utmb_pic": number, "utmb_20k": number, "utmb_50k": number,
    "utmb_100k": number|null, "utmb_100m": number|null
  },
  "zones": [{ "label": "Z1-Z5", "min": bpm, "max": bpm }],
  "injury": {
    "location": "string", "episode": number, "detail": "string",
    "status": "active|healing|managing",
    "tests": [{ "name", "value", "color": "green|yellow|orange|red" }],
    "context": [{ "label", "value" }],
    "protocol": [{ "phase", "entry", "content", "status": "en_cours|a_venir|termine" }],
    "prevention": [{ "action", "frequency" }],
    "history": [{ "num", "location", "side", "severity", "resolution" }]
  },
  "calendar": {
    "races": [{ "date", "name", "distance", "dplus", "objective": "A|B|C|done", "result", "note" }],
    "periodisation": [{ "bloc", "badge_class", "period", "focus", "races" }],
    "gap_analysis": [{ "indicator", "current", "target", "gap", "color" }]
  },
  "predictions": [{ "name", "date", "distance", "edition_info", "border_color", "rows": [...], "notes" }],
  "projection": { "title", "scenarios": [{ "label", "value", "detail", "color" }] },
  "work_axes": [{ "rank", "name", "impact", "impact_color", "tool", "success" }],
  "race_history": [{ "name", "date", "distance", "dplus", "time", "ranking", "utmb_index", "highlight" }],
  "index_progression": { "start_index", "start_date", "current_index", "current_date", "gain_text" },
  "health_factors": [{ "name", "current", "color", "impact", "target" }],
  "health_note": "string",
  "health_perf_impact": "string",
  "health_intro": "string"
}
```

## Pieges courants

1. **UTF-8** : Toujours `'utf8'` pour `readFileSync` ET `writeFileSync`
2. **Scoping DOM** : Jamais query `.week-day` sans scoper au container athlete (`#athlete-{name}`)
3. **initDayMetrics()** : Appele UNE SEULE FOIS par cycle de render (jamais dans les loaders individuels)
4. **Parametre athlete** : Toujours passer `athlete` en parametre a chaque fonction
5. **Cache** : `cache: 'no-store'` sur tous les fetch API
6. **injuryKey** : Dynamique — `soleaire` pour Yohann, `genou` pour Juliette
7. **FC Zones** : Per-athlete dans `_fcZonesByAthlete[athlete]`, pas un global
8. **buildTodayCard** : DEPLACE l'element, ne le clone PAS. Un seul `.week-day` par date.
9. **Validation** : `validateToolInput()` est appele avant `executeTool()` — les inputs invalides sont rejetes
10. **File locking** : Les ecritures concurrentes sont protegees par `withFileLock()`

## Procedures de test

### Lancer le serveur

```bash
ANTHROPIC_API_KEY=sk-ant-xxx node backoffice.js
```

### Tests curl

```bash
# Lire coach-log
curl http://localhost:3000/api/data?athlete=yohann

# Lire athlete-data
curl http://localhost:3000/api/athlete-data?athlete=yohann

# Lire plan semaine
curl http://localhost:3000/api/week-plan?athlete=yohann

# Sauvegarder une entree quotidienne
curl -X POST http://localhost:3000/api/save?athlete=yohann \
  -H 'Content-Type: application/json' \
  -d '{"daily":{"date":"2026-02-09","rpe":5,"soleaire":3}}'

# Envoyer un message au chat
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"athlete":"yohann","message":"Comment va mon soleaire ?"}'
```

### Verifications navigateur

1. **Doublons** : changer RPE sur la carte Aujourd'hui → Sauvegarder → Refresh → valeur persistee
2. **IA** : dire "je fais 82 kg" au chat → poids mis a jour dans Vue d'ensemble
3. **Zones** : dire "ma FC max est 185" → zones recalculees, barre FC visible
4. **Multi-athlete** : switcher Juliette → toutes les donnees sont celles de Juliette
5. **Console** : zero erreur JS apres chaque test
