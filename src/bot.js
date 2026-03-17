require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const cron = require('node-cron');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ---------- CONFIG À ADAPTER ----------

const CONFIG = {
  shopCategoryId: '1482068032070090812',
  pingRoleId: '1482108909429981265',
  avisChannelId: '1482065735726403829',
  shopPriceEuros: 3,
  shopNamePrefix: '💸・',
  maxPingsPerWindow: 3,
  pingWindowDays: 5,
  muteDurationDays: 5,
  maxWarns: 5,
  shopRentDays: 14,
  inviteLink: 'https://discord.gg/sayuri'
};

// ---------- MONGODB (RAILWAY) ----------

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('Tu dois configurer MONGO_URL dans les variables d\'environnement (Railway).');
  process.exit(1);
}

mongoose
  .connect(mongoUrl, {
    serverSelectionTimeoutMS: 30000
  })
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch((err) => {
    console.error('❌ Erreur connexion MongoDB', err);
    process.exit(1);
  });

// ---------- SCHÉMAS MONGOOSE ----------

const shopSchema = new mongoose.Schema({
  channelId: { type: String, unique: true, index: true },
  ownerId: String,
  createdAt: { type: Date, default: () => new Date() },
  createdBy: String,
  pingCount: { type: Number, default: 0 },
  pingWindowStart: { type: Date, default: () => new Date() }
});

const warnSchema = new mongoose.Schema({
  userId: { type: String, unique: true, index: true },
  count: { type: Number, default: 0 }
});

const Shop = mongoose.model('Shop', shopSchema);
const Warn = mongoose.model('Warn', warnSchema);

// ---------- UTILITAIRES TEMPS ----------

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// ---------- READY ----------

client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  // Reset automatique des pings toutes les 12h (on vérifie fenêtres de 5 jours)
  cron.schedule('0 */12 * * *', async () => {
    const now = new Date();
    try {
      const shops = await Shop.find({});
      const updates = [];
      for (const shop of shops) {
        if (!shop.pingWindowStart) continue;
        const start = new Date(shop.pingWindowStart);
        const diffDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= CONFIG.pingWindowDays) {
          shop.pingCount = 0;
          shop.pingWindowStart = now;
          updates.push(shop.save());
        }
      }
      if (updates.length) await Promise.all(updates);
    } catch (err) {
      console.error('Erreur reset automatique des pings', err);
    }
  });

  // Rappel loyer shops tous les jours
  cron.schedule('0 10 * * *', () => {
    checkShopRents().catch(console.error);
  });
});

// ---------- GESTION SHOPS ----------

async function createShop(message, targetMember) {
  const guild = message.guild;
  if (!guild) return;

  const category = guild.channels.cache.get(CONFIG.shopCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await message.reply('⚠️ La catégorie de shops est introuvable ou invalide. Vérifie l\'ID dans le code.');
    return;
  }

  const channelName = `${CONFIG.shopNamePrefix}${targetMember.user.username}`;

  const everyoneRole = guild.roles.everyone;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      {
        id: everyoneRole.id,
        allow: [PermissionsBitField.Flags.ViewChannel],
        deny: [PermissionsBitField.Flags.SendMessages]
      },
      {
        id: targetMember.id,
        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel]
      }
    ]
  });

  const createdAt = new Date();

  await Shop.findOneAndUpdate(
    { channelId: channel.id },
    {
      ownerId: targetMember.id,
      createdAt,
      createdBy: message.author.id,
      pingCount: 0,
      pingWindowStart: createdAt
    },
    { upsert: true, new: true }
  );

  const createdByUser = message.author;
  const creationDate = createdAt.toLocaleString('fr-FR');

  await channel.send({
    content: [
      '🛒 **NOUVEAU SHOP OUVERT !**',
      '',
      `✨ **Shop de :** ${targetMember}`,
      `👑 **Shop via :** ${createdByUser}`,
      `📅 **Début :** ${creationDate}`,
      '',
      '📣 Tu peux utiliser la commande `!ping` ici pour ping `@everyone`.',
      `⚠️ Tu as droit à **${CONFIG.maxPingsPerWindow} pings** par **${CONFIG.pingWindowDays} jours**.`,
      '',
      '✅ Pense à rester sérieux, clair et honnête dans tes ventes.'
    ].join('\n')
  });

  await message.reply(`✅ Shop créé pour ${targetMember} dans ${channel}.`);
}

async function checkShopRents() {
  const now = new Date();
  const shops = await Shop.find({});
  for (const shop of shops) {
    try {
      const channel = await client.channels.fetch(shop.channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) continue;

      const createdAt = new Date(shop.createdAt);
      const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

      // Tous les 14 jours (approximatif : si diff est multiple de 14 ± 1 jour)
      if (diffDays >= CONFIG.shopRentDays && Math.round(diffDays) % CONFIG.shopRentDays === 0) {
        await channel.send({
          content: [
            '⚠️ **RAPPEL HÉBERGEMENT SHOP**',
            '',
            `💰 Tu dois payer **${CONFIG.shopPriceEuros}€** ton hébergement **ou booster le serveur** \`${CONFIG.inviteLink}\``,
            'sinon ton shop sera supprimé.',
            '',
            '⏳ Merci de régulariser dès que possible.'
          ].join('\n')
        });
      }
    } catch (err) {
      console.error('Erreur checkShopRents pour', shop.channelId, err);
    }
  }
}

// ---------- GESTION PINGS ----------

async function handlePing(message) {
  const guild = message.guild;
  if (!guild) return;

  const member = message.member;
  if (!member) return;

  // Seul le rôle ping + admins
  const hasPingRole = member.roles.cache.has(CONFIG.pingRoleId);
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!hasPingRole && !isAdmin) {
    await message.reply('❌ Tu n\'as pas la permission d\'utiliser cette commande.');
    return;
  }

  const channel = message.channel;

  const shop = await Shop.findOne({ channelId: channel.id });
  if (!shop) {
    await message.reply('❌ Cette commande ne peut être utilisée que dans un salon de shop.');
    return;
  }

  // Vérifier que c\'est bien le proprio du shop (ou admin)
  if (shop.ownerId !== member.id && !isAdmin) {
    await message.reply('❌ Seul le propriétaire de ce shop (ou un admin) peut ping ici.');
    return;
  }

  const now = new Date();
  const start = shop.pingWindowStart ? new Date(shop.pingWindowStart) : now;
  const diffDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays >= CONFIG.pingWindowDays) {
    shop.pingCount = 0;
    shop.pingWindowStart = now;
  }

  if (shop.pingCount >= CONFIG.maxPingsPerWindow) {
    await message.reply(`⏳ Tu as déjà utilisé tes **${CONFIG.maxPingsPerWindow} pings** pour cette période de **${CONFIG.pingWindowDays} jours**. Attends le reset automatique.`);
    await shop.save();
    return;
  }

  shop.pingCount += 1;
  await shop.save();

  const remaining = CONFIG.maxPingsPerWindow - shop.pingCount;

  await channel.send({
    content: [
      '📢 **ANNONCE SHOP**',
      '@everyone',
      '',
      `🛍️ ${member} vient de faire une **annonce**.`,
      `🔔 Il lui reste **${remaining}** ping(s) sur cette période.`,
      '',
      '✨ Profitez des offres du shop dès maintenant !'
    ].join('\n')
  });
}

// ---------- GESTION LIENS & AVERTISSEMENTS ----------

const LINK_REGEX = /(https?:\/\/|discord\.gg\/|www\.)/i;

async function handlePotentialLink(message) {
  if (message.author.bot) return;
  if (!LINK_REGEX.test(message.content)) return;

  try {
    await message.delete().catch(() => {});
  } catch (_) {}

  const userId = message.author.id;
  const warnDoc = await Warn.findOneAndUpdate(
    { userId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );
  const newCount = warnDoc.count;

  const remaining = Math.max(CONFIG.maxWarns - newCount, 0);

  await message.channel.send({
    content: [
      `⚠️ ${message.author}`,
      '',
      '🚫 Tu ne peux pas te pub gratuitement, contact un owner pour en discuter !',
      `❗ Attention il te reste **${remaining} avertissement(s)** avant une sanction.`
    ].join('\n')
  });

  if (newCount >= CONFIG.maxWarns) {
    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (member) {
      const muteMs = CONFIG.muteDurationDays * 24 * 60 * 60 * 1000;
      const until = addDays(new Date(), CONFIG.muteDurationDays);
      await member.timeout(muteMs, 'Trop de pubs / liens');
      await message.channel.send({
        content: [
          `🔇 ${member} a été **mute ${CONFIG.muteDurationDays} jours** pour abus de pubs / liens.`,
          `📆 Fin du mute estimée : **${until.toLocaleString('fr-FR')}**`
        ].join('\n')
      });
    }
    warnDoc.count = 0;
    await warnDoc.save();
  }
}

// ---------- SYSTÈME D\'AVIS ----------

async function handleAvisCommand(message) {
  if (message.channel.id !== CONFIG.avisChannelId) {
    await message.reply('❌ Tu dois utiliser cette commande dans le salon d\'avis dédié.');
    return;
  }

  const args = message.content.trim().split(/\s+/);
  if (args.length < 2) {
    await message.reply('❌ Utilisation : `+pr @shopOwner`');
    return;
  }

  const mentioned = message.mentions.users.first();
  if (!mentioned) {
    await message.reply('❌ Tu dois mentionner le vendeur (`+pr @pseudo`).');
    return;
  }

  const guild = message.guild;
  if (!guild) return;

  // Trouver le shop du vendeur mentionné
  const shop = await Shop.findOne({ ownerId: mentioned.id });

  if (!shop) {
    await message.reply('❌ Ce vendeur ne possède pas de shop enregistré.');
    return;
  }

  const shopChannel = await client.channels.fetch(shop.channelId).catch(() => null);
  if (!shopChannel || shopChannel.type !== ChannelType.GuildText) {
    await message.reply('⚠️ Le salon de shop lié à ce vendeur est introuvable.');
    return;
  }

  const filter = (m) => m.author.id === message.author.id;

  await message.reply('⭐ Merci pour ton retour ! Note le vendeur sur **10** (ex: `9/10`).');
  const noteMsg = await message.channel.awaitMessages({
    filter,
    max: 1,
    time: 60_000
  }).catch(() => null);

  if (!noteMsg || noteMsg.size === 0) {
    await message.reply('⏳ Temps dépassé. Recommence la commande si tu veux laisser un avis.');
    return;
  }

  const noteContent = noteMsg.first().content.trim();
  const noteMatch = noteContent.match(/(\d{1,2})/);
  const note = noteMatch ? parseInt(noteMatch[1], 10) : NaN;
  if (isNaN(note) || note < 0 || note > 10) {
    await message.reply('❌ Note invalide. Tu dois donner une note entre **0 et 10**.');
    return;
  }

  await message.reply('📝 Que voulais-tu exactement ? (décris ce que tu as commandé)');
  const commandeMsg = await message.channel.awaitMessages({
    filter,
    max: 1,
    time: 120_000
  }).catch(() => null);

  if (!commandeMsg || commandeMsg.size === 0) {
    await message.reply('⏳ Temps dépassé. Recommence la commande si tu veux laisser un avis.');
    return;
  }

  const commande = commandeMsg.first().content.trim();

  await message.reply('📦 Merci ! Enfin, explique comment s\'est passée la commande (temps, sérieux, etc).');
  const avisMsg = await message.channel.awaitMessages({
    filter,
    max: 1,
    time: 180_000
  }).catch(() => null);

  if (!avisMsg || avisMsg.size === 0) {
    await message.reply('⏳ Temps dépassé. Recommence la commande si tu veux laisser un avis.');
    return;
  }

  const avisTexte = avisMsg.first().content.trim();

  const baseContent = [
    '🧾 **NOUVEL AVIS CLIENT**',
    '',
    `👤 **Acheteur :** ${message.author}`,
    `🛍️ **Vendeur :** ${mentioned}`,
    `⭐ **Note :** ${note}/10`,
    '',
    `📦 **Commande :**\n${commande}`,
    '',
    `💬 **Avis :**\n${avisTexte}`,
    '',
    '📎 Merci d\'ajouter en réponse à ce fil une **preuve** (screen / reçu / etc.) pour valider l\'avis.'
  ].join('\n');

  // On poste l'avis dans le salon de shop sous forme de fil
  const avisMessage = await shopChannel.send({
    content: baseContent
  });

  const thread = await avisMessage.startThread({
    name: `Avis de ${message.author.username} (${note}/10)`,
    autoArchiveDuration: 10080 // 7 jours
  });

  await thread.send('📎 Merci de poster ici ta **preuve d\'achat / de réception** (screen / reçu / etc.).');

  await message.reply(`✅ Ton avis a bien été ajouté dans le shop de ${mentioned} (${shopChannel}).`);
}

// ---------- MESSAGE CREATE ----------

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return;

    // Anti lien / pubs
    await handlePotentialLink(message);

    if (!message.content) return;

    const content = message.content.trim();

    // Commandes texte
    if (content.startsWith('!create')) {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent créer des shops.');
        return;
      }

      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        await message.reply('❌ Utilisation : `!create @user`');
        return;
      }

      await createShop(message, targetUser);
      return;
    }

    if (content === '!ping') {
      await handlePing(message);
      return;
    }

    if (content.startsWith('+pr')) {
      await handleAvisCommand(message);
      return;
    }
  } catch (err) {
    console.error('Erreur messageCreate', err);
  }
});

// ---------- CONNEXION ----------

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Tu dois mettre ton token de bot dans un fichier .env (DISCORD_TOKEN=...)');
  process.exit(1);
}

client.login(token);

