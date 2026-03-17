# Bot Discord Black Store

Bot pour ton serveur **Black Store** avec :
- création de shops
- gestion de pings `@everyone`
- anti-pub / avertissements
- système d'avis clients

## Installation

1. Installer les dépendances :

```bash
npm install
```

2. Créer un fichier `.env` à la racine en copiant `.env.example` :

```bash
cp .env.example .env
```

Puis mettre ton token de bot :

```env
DISCORD_TOKEN=ton_token_ici
```

3. Lancer le bot :

```bash
npm start
```

## Commandes principales

- `!create @user` : (admin) crée un salon de shop pour l'utilisateur.
- `!ping` : dans un salon de shop, permet de ping `@everyone` (3 fois par 5 jours, rôle spécial + admin).
- `!pr @vendeur` : laisse un avis sur un vendeur, qui sera posté dans son salon de shop en fil.

