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

## Commandes

### Shops
| Commande | Qui | Description |
|----------|-----|-------------|
| `!create @user` | Admin | Crée un salon shop `💸・pseudo` dans la catégorie des shops. Lie automatiquement le salon au vendeur. |
| `!linkshop @vendeur #salon` | Admin | Lie un salon à un vendeur (depuis n'importe où). Les avis `!pr @vendeur` iront dans ce salon. |
| `!registershop @vendeur` | Admin | Même chose, à utiliser **dans** le salon du shop. |
| `!ping` | Proprio + rôle ping ou Admin | Dans un shop, ping `@everyone` (3/5 jours). |

### Avis / Proof
| Commande | Qui | Description |
|----------|-----|-------------|
| `!pr @vendeur` | Tout le monde | Dans le salon proof, laisse un avis (note /10, commande, message). Posté dans le shop du vendeur + fil pour preuve. |
| `!setavis` | Admin | À utiliser dans le salon proof. Définit ce salon pour `!pr`. |

### Config
| Commande | Qui | Description |
|----------|-----|-------------|
| `!setjoinrole @role` | Admin | Rôle donné aux nouveaux membres à l'arrivée. |
| `!setlinkrole @role` | Admin | Rôle autorisé à envoyer des liens (autres = avertissement). |
| `!stats` | Admin | Crée les salons vocaux de stats (Total, En ligne, Proofs, Stores). |
| `!legit` | Tout le monde | Envoie « Est-ce qu'on est legit ? » avec ✅ et ❌. |

