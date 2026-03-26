# Bot Discord Black Store v2

Bot entièrement configurable via commandes — **aucun ID en dur**.

## Installation

```bash
npm install
```

Créer `.env` :
```
DISCORD_TOKEN=ton_token
MONGO_URL=ta_url_mongo_railway
```

```bash
npm start
```

## Configuration — tout se set directement sur le bot

Un **admin** configure tout via les commandes :

| Commande | Description |
|----------|-------------|
| `!setcategory shop #cat` | Catégorie des shops |
| `!setcategory stats #cat` | Catégorie des stats |
| `!setcategory ticket #cat` | Catégorie des tickets proof |
| `!setprf` ou `!setprf #salon` | Salon où les avis créent des fils |
| `!setticketstaffrole @role` | Rôle staff tickets (validation) |
| `!setticketmessage ...` | Texte embed ticket (vars: `{ORDER_ID}`, `{BUYER}`) |
| `!setpingrole @role` | Rôle pour !ping |
| `!setlinkrole @role` | Rôle autorisé liens |
| `!setjoinrole @role` | Rôle à l'arrivée |
| `!setshopprefix 💸・` | Préfixe des noms de shop |
| `!setloyer 3` | Prix hébergement (€) |
| `!setinvite https://...` | Lien serveur (rappel loyer) |
| `!setpings 3` | Nb pings par période |
| `!setpingdays 5` | Période pings (jours) |
| `!setwarns 5` | Avertissements avant mute |
| `!setmutedays 5` | Durée mute (jours) |
| `!setrentdays 14` | Rappel loyer (tous les X jours) |
| `!config` | Voir toute la config |

## Commandes

### Shops
- `!create @user` — Créer un shop (admin)
- `!linkshop @vendeur #salon` — Lier un salon à un vendeur
- `!registershop @vendeur` — Idem, dans le salon
- `!checkshop @vendeur` — Vérifier si un shop existe

### Usage
- `!ping` — Annonce dans ton shop (3/5 jours)
- `!prf` — Laisser un avis (questionnaire → fil dans le salon configuré)
- `!ticket` — Créer un ticket proof (ID commande + bouton -> envoi dans `!setprf`)
- `!stats` — Créer les salons de stats
- `!legit` — Poll "Est-ce qu'on est legit ?"
- `!help` — Liste des commandes
