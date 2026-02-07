# Setup Strava - Guide pas a pas

## 1. Creer une application Strava

1. Va sur **https://www.strava.com/settings/api**
2. Remplis le formulaire :
   - **Application Name** : Coach Trail
   - **Category** : Training
   - **Club** : (laisser vide)
   - **Website** : https://dreamskid.github.io/coach-trail
   - **Authorization Callback Domain** : localhost
3. Note ton **Client ID** et **Client Secret**

## 2. Obtenir le token d'autorisation

Ouvre ce lien dans ton navigateur (remplace XXXXX par ton Client ID) :

```
https://www.strava.com/oauth/authorize?client_id=XXXXX&response_type=code&redirect_uri=http://localhost&scope=read,activity:read_all&approval_prompt=force
```

Clique "Authorize". Tu seras redirige vers une page qui ne charge pas (localhost).
C'est normal. Copie le `code` dans l'URL :

```
http://localhost/?state=&code=XXXXXXXXXXXXXXXXX&scope=read,activity:read_all
```

## 3. Echanger le code contre un refresh token

Dans un terminal, lance :

```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=XXXXX \
  -d client_secret=XXXXX \
  -d code=XXXXX \
  -d grant_type=authorization_code
```

Tu recevras une reponse JSON avec un `refresh_token`. Note-le.

## 4. Ajouter les secrets au repo GitHub

Va sur https://github.com/dreamskid/coach-trail/settings/secrets/actions

Ajoute 3 secrets :

| Secret | Valeur |
|--------|--------|
| `STRAVA_CLIENT_ID` | Ton Client ID |
| `STRAVA_CLIENT_SECRET` | Ton Client Secret |
| `STRAVA_REFRESH_TOKEN` | Le refresh token obtenu |

## 5. Tester

Va sur https://github.com/dreamskid/coach-trail/actions

Clique sur "Sync Strava Activities" puis "Run workflow".

Si tout va bien, un fichier `data/strava-activities.json` apparaitra
et tes activites seront visibles dans l'onglet "Activites" du dashboard.

## Fonctionnement automatique

Le workflow tourne chaque jour a 7h du matin (heure francaise).
Il recupere tes 30 dernieres activites Strava, les sauvegarde en JSON,
et le dashboard les affiche automatiquement.

Aucune action requise au quotidien. C'est 100% automatique.
