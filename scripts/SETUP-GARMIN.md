# Setup Garmin Connect - Guide pas a pas

## Contexte

Garmin Connect utilise le MFA (authentification a 2 facteurs).
On ne peut pas utiliser email/password en CI. A la place, on genere
des **tokens** une seule fois en local, et on les stocke comme secret GitHub.

## 1. Generer les tokens (une seule fois)

```bash
pip install garminconnect
python scripts/garmin_auth.py
```

Le script te demande :
1. Ton email Garmin
2. Ton mot de passe Garmin
3. Le code MFA (recu par email ou via l'app Garmin Connect)

Il affiche ensuite une longue chaine base64 : c'est le token.

## 2. Ajouter le secret au repo GitHub

Va sur https://github.com/dreamskid/coach-trail/settings/secrets/actions

Ajoute 1 secret :

| Secret | Valeur |
|--------|--------|
| `GARMINTOKENS` | La chaine base64 generee par garmin_auth.py |

## 3. Tester

Va sur https://github.com/dreamskid/coach-trail/actions

Clique sur "Sync Data (Strava + Garmin)" puis "Run workflow".

Si tout va bien, un fichier `data/garmin-wellness.json` apparaitra
et l'onglet "Sante" du dashboard affichera tes donnees.

## 4. Tester en local

```bash
export GARMINTOKENS="<la chaine base64>"
python scripts/sync_garmin.py
```

## Fonctionnement automatique

Le workflow tourne chaque jour a 7h du matin (heure francaise).
Les tokens garth se rafraichissent automatiquement a chaque utilisation.

## Renouvellement des tokens

Si le workflow echoue avec une erreur d'authentification :
1. Relance `python scripts/garmin_auth.py` en local
2. Mets a jour le secret `GARMINTOKENS` sur GitHub

Cela ne devrait arriver que rarement (tokens invalides apres
un changement de mot de passe Garmin, par exemple).

## Donnees recuperees

| Metrique | Source API | Frequence |
|----------|-----------|-----------|
| Pas quotidiens | `get_stats()` | Quotidien |
| Sommeil (duree, phases, score) | `get_sleep_data()` | Quotidien |
| Body Battery | `get_body_battery()` | Quotidien |
| VO2max | `connectapi maxmet` | Ponctuel |
| FC repos | `get_rhr_day()` | Quotidien |
| VFC (HRV) | `get_hrv_data()` | Quotidien |
| Stress | `get_stress_data()` | Quotidien |
