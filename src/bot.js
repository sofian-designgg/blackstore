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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ---------- CONFIG À ADAPTER ----------

const CONFIG = {
  shopCategoryId: '1482068032070090812',
  pingRoleId: '1482108909429981265',
  avisChannelId: '1482065735726403829', // ancien ID (optionnel)
  avisChannelName: '🍂・proof', // nom du salon d'avis
  statsCategoryId: '1483556393519943913',
  allowedLinkRoleId: '1482108953503731963',
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
  guildId: { type: String, index: true },
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

const avisSchema = new mongoose.Schema({
  guildId: { type: String, index: true },
  shopChannelId: String,
  sellerId: String,
  buyerId: String,
  note: Number,
  createdAt: { type: Date, default: () => new Date() }
});

const Shop = mongoose.model('Shop', shopSchema);
const Warn = mongoose.model('Warn', warnSchema);
const Avis = mongoose.model('Avis', avisSchema);

// Config par serveur (ex: salon d'avis, auto-rôle, stats)
const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, unique: true, index: true },
  avisChannelId: { type: String, default: null },
  joinRoleId: { type: String, default: null },
  allowedLinkRoleId: { type: String, default: null },
  statsTotalMembersChannelId: { type: String, default: null },
  statsOnlineMembersChannelId: { type: String, default: null },
  statsProofChannelId: { type: String, default: null },
  statsStoreChannelId: { type: String, default: null }
});

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

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

  // Mise à jour des salons de stats toutes les 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      for (const guild of client.guilds.cache.values()) {
        await updateGuildStats(guild);
      }
    } catch (err) {
      console.error('Erreur mise à jour stats', err);
    }
  });
});

// ---------- STATS SERVEUR ----------

async function ensureStatsChannels(guild) {
  const guildId = guild.id;
  let cfg = await GuildConfig.findOne({ guildId });

  const category = guild.channels.cache.get(CONFIG.statsCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return null;

  const everyoneRole = guild.roles.everyone;

  async function getOrCreateVoice(idKey, baseName) {
    let channel = null;
    if (cfg && cfg[idKey]) {
      channel = guild.channels.cache.get(cfg[idKey]) || null;
    }
    if (!channel) {
      channel = await guild.channels.create({
        name: baseName,
        type: ChannelType.GuildVoice,
        parent: category,
        permissionOverwrites: [
          {
            id: everyoneRole.id,
            allow: [PermissionsBitField.Flags.ViewChannel],
            deny: [PermissionsBitField.Flags.Connect]
          }
        ]
      });
      cfg = await GuildConfig.findOneAndUpdate(
        { guildId },
        { [idKey]: channel.id },
        { upsert: true, new: true }
      );
    }
    return channel;
  }

  const totalMembersChannel = await getOrCreateVoice(
    'statsTotalMembersChannelId',
    '🖤・Total: 0'
  );
  const onlineMembersChannel = await getOrCreateVoice(
    'statsOnlineMembersChannelId',
    '🖤・En ligne: 0'
  );
  const proofChannel = await getOrCreateVoice('statsProofChannelId', '🖤・Proofs: 0');
  const storeChannel = await getOrCreateVoice('statsStoreChannelId', '🖤・Stores: 0');

  return {
    totalMembersChannel,
    onlineMembersChannel,
    proofChannel,
    storeChannel
  };
}

async function updateGuildStats(guild) {
  try {
    const guildId = guild.id;
    const cfg = await GuildConfig.findOne({ guildId });
    if (!cfg) return;

    const category = guild.channels.cache.get(CONFIG.statsCategoryId);
    if (!category || category.type !== ChannelType.GuildCategory) return;

    const totalMembersChannel = cfg.statsTotalMembersChannelId
      ? guild.channels.cache.get(cfg.statsTotalMembersChannelId)
      : null;
    const onlineMembersChannel = cfg.statsOnlineMembersChannelId
      ? guild.channels.cache.get(cfg.statsOnlineMembersChannelId)
      : null;
    const proofChannel = cfg.statsProofChannelId
      ? guild.channels.cache.get(cfg.statsProofChannelId)
      : null;
    const storeChannel = cfg.statsStoreChannelId
      ? guild.channels.cache.get(cfg.statsStoreChannelId)
      : null;

    // Si aucun salon n'est configuré, on ne fait rien (il faut d'abord !stats)
    if (!totalMembersChannel && !onlineMembersChannel && !proofChannel && !storeChannel) {
      return;
    }

    const members = await guild.members.fetch();
    const totalMembers = members.size;
    const onlineMembers = members.filter(
      (m) => m.presence && m.presence.status && m.presence.status !== 'offline'
    ).size;

    const totalProofs = await Avis.countDocuments({ guildId });
    const totalStores = await Shop.countDocuments({ guildId });

    if (totalMembersChannel) {
      await totalMembersChannel.setName(`🖤・Total: ${totalMembers}`).catch(() => {});
    }
    if (onlineMembersChannel) {
      await onlineMembersChannel.setName(`🖤・En ligne: ${onlineMembers}`).catch(() => {});
    }
    if (proofChannel) {
      await proofChannel.setName(`🖤・Proofs: ${totalProofs}`).catch(() => {});
    }
    if (storeChannel) {
      await storeChannel.setName(`🖤・Stores: ${totalStores}`).catch(() => {});
    }
  } catch (err) {
    console.error(`Erreur updateGuildStats pour ${guild.id}`, err);
  }
}

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
      guildId: guild.id,
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

  // Met à jour les stats de stores immédiatement
  try {
    await updateGuildStats(guild);
  } catch (err) {
    console.error('Erreur update stats après création shop', err);
  }
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
  if (!message.guild) return;

  // Autoriser les liens uniquement si le membre a le rôle autorisé (ou admin)
  const member = message.member;
  if (member) {
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (isAdmin) return;

    const guildCfg = await GuildConfig.findOne({ guildId: message.guild.id }).catch(() => null);
    const allowedRoleId = guildCfg?.allowedLinkRoleId || CONFIG.allowedLinkRoleId;
    if (allowedRoleId && member.roles.cache.has(allowedRoleId)) {
      return;
    }
  }

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
  const guildId = message.guild.id;
  const guildCfg = await GuildConfig.findOne({ guildId }).catch(() => null);

  const configuredAvisId = guildCfg?.avisChannelId || CONFIG.avisChannelId;

  const isRightChannel =
    message.channel.id === configuredAvisId ||
    message.channel.name === CONFIG.avisChannelName;

  if (!isRightChannel) {
    await message.reply('❌ Tu dois utiliser cette commande dans le salon d\'avis dédié (`#🍂・proof`).');
    return;
  }

  const args = message.content.trim().split(/\s+/);
  if (args.length < 2) {
    await message.reply('❌ Utilisation : `!pr @shopOwner`');
    return;
  }

  const mentioned = message.mentions.users.first();
  if (!mentioned) {
    await message.reply('❌ Tu dois mentionner le vendeur (`!pr @pseudo`).');
    return;
  }

  const guild = message.guild;
  if (!guild) return;

  // Trouver le shop du vendeur mentionné (même serveur)
  const shop = await Shop.findOne({
    ownerId: mentioned.id,
    $or: [{ guildId: guild.id }, { guildId: null }, { guildId: { $exists: false } }]
  });

  if (!shop) {
    await message.reply('❌ Ce vendeur ne possède pas de shop enregistré sur ce serveur.');
    return;
  }

  const shopChannel = await client.channels.fetch(shop.channelId).catch(() => null);
  if (!shopChannel || shopChannel.type !== ChannelType.GuildText) {
    await message.reply(
      '⚠️ Le salon de shop lié à ce vendeur est introuvable (supprimé ?). Un admin peut faire `!registershop @vendeur` dans le salon du shop pour le re-lier.'
    );
    return;
  }

  // Vérifier que le salon est bien sur ce serveur
  if (shopChannel.guildId !== guild.id) {
    await message.reply('❌ Ce shop appartient à un autre serveur.');
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

  // Enregistrement de l'avis pour les stats
  try {
    await Avis.create({
      guildId,
      shopChannelId: shop.channelId,
      sellerId: mentioned.id,
      buyerId: message.author.id,
      note
    });

    // Met à jour les stats de proofs immédiatement
    await updateGuildStats(guild);
  } catch (err) {
    console.error('Erreur enregistrement avis', err);
  }
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

    if (content === '!setavis') {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent configurer le salon d\'avis.');
        return;
      }

      const guildId = message.guild.id;
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { avisChannelId: message.channel.id },
        { upsert: true, new: true }
      );

      await message.reply('✅ Ce salon est maintenant configuré comme **salon d\'avis** pour la commande `!pr`.');
      return;
    }

    if (content.startsWith('!setjoinrole')) {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent configurer le rôle à l\'arrivée.');
        return;
      }

      const role = message.mentions.roles.first();
      if (!role) {
        await message.reply('❌ Utilisation : `!setjoinrole @role`');
        return;
      }

      const guildId = message.guild.id;
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { joinRoleId: role.id },
        { upsert: true, new: true }
      );

      await message.reply(`✅ Le rôle ${role} sera maintenant donné automatiquement aux nouveaux membres à leur arrivée.`);
      return;
    }

    if (content.startsWith('!setlinkrole')) {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent configurer le rôle autorisé à envoyer des liens.');
        return;
      }

      const role = message.mentions.roles.first();
      if (!role) {
        await message.reply('❌ Utilisation : `!setlinkrole @role`');
        return;
      }

      const guildId = message.guild.id;
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { allowedLinkRoleId: role.id },
        { upsert: true, new: true }
      );

      await message.reply(`✅ Seuls les membres avec ${role} (ou les admins) peuvent maintenant envoyer des liens.`);
      return;
    }

    if (content.startsWith('!registershop')) {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent enregistrer un shop.');
        return;
      }

      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        await message.reply('❌ Utilisation : `!registershop @user` (à utiliser dans le salon du shop).');
        return;
      }

      const guild = message.guild;
      const channel = message.channel;

      await Shop.findOneAndUpdate(
        { channelId: channel.id },
        {
          channelId: channel.id,
          guildId: guild.id,
          ownerId: targetUser.id,
          createdAt: new Date(),
          createdBy: message.author.id,
          pingCount: 0,
          pingWindowStart: new Date()
        },
        { upsert: true, new: true }
      );

      await message.reply(`✅ Ce salon est maintenant enregistré comme le shop de ${targetUser}. La commande \`!pr @${targetUser.user.username}\` fonctionnera.`);
      return;
    }

    if (content === '!stats') {
      const member = message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await message.reply('❌ Seuls les administrateurs peuvent configurer les salons de statistiques.');
        return;
      }

      const guild = message.guild;
      const created = await ensureStatsChannels(guild);
      if (!created) {
        await message.reply('⚠️ Impossible de créer les salons de stats. Vérifie que l\'ID de catégorie est correct dans le bot.');
        return;
      }

      await updateGuildStats(guild);
      await message.reply('✅ Les salons de statistiques ont été créés/mis à jour en haut de la catégorie configurée.');
      return;
    }

    if (content === '!ping') {
      await handlePing(message);
      return;
    }

    if (content.startsWith('!pr')) {
      await handleAvisCommand(message);
      return;
    }
  } catch (err) {
    console.error('Erreur messageCreate', err);
  }
});

// ---------- AUTO-RÔLE À L'ARRIVÉE ----------

client.on('guildMemberAdd', async (member) => {
  try {
    const guildId = member.guild.id;
    const cfg = await GuildConfig.findOne({ guildId }).catch(() => null);
    if (!cfg || !cfg.joinRoleId) return;

    const role = member.guild.roles.cache.get(cfg.joinRoleId);
    if (!role) return;

    await member.roles.add(role, 'Auto-rôle à l\'arrivée (config bot)');
  } catch (err) {
    console.error('Erreur auto-rôle à l\'arrivée', err);
  }
});

// ---------- COMMANDE LEGIT ----------

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();
    if (content === '!legit') {
      const msg = await message.channel.send('❓ **Est-ce qu\'on est legit ?**');
      await msg.react('✅');
      await msg.react('❌');
    }
  } catch (err) {
    console.error('Erreur commande !legit', err);
  }
});

// ---------- CONNEXION ----------

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Tu dois mettre ton token de bot dans un fichier .env (DISCORD_TOKEN=...)');
  process.exit(1);
}

client.login(token);

