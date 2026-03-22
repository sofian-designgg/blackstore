/**
 * Bot Discord Black Store
 * Propre et structuré - MongoDB (Railway)
 */

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

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  shopCategoryId: '1482068032070090812',
  statsCategoryId: '1483556393519943913',
  pingRoleId: '1482108909429981265',
  allowedLinkRoleId: '1482108953503731963',
  avisChannelName: '🍂・proof',
  shopNamePrefix: '💸・',
  shopPriceEuros: 3,
  maxPingsPerWindow: 3,
  pingWindowDays: 5,
  muteDurationDays: 5,
  maxWarns: 5,
  shopRentDays: 14,
  inviteLink: 'https://discord.gg/sayuri'
};

// ═══════════════════════════════════════════════════════════════
// CLIENT DISCORD
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// MONGODB
// ═══════════════════════════════════════════════════════════════

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('❌ MONGO_URL manquant dans les variables d\'environnement.');
  process.exit(1);
}

mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch((err) => {
    console.error('❌ Erreur MongoDB', err);
    process.exit(1);
  });

// Schémas
const Shop = mongoose.model('Shop', new mongoose.Schema({
  channelId: { type: String, unique: true, required: true },
  guildId: { type: String, required: true, index: true },
  ownerId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: String,
  pingCount: { type: Number, default: 0 },
  pingWindowStart: { type: Date, default: Date.now }
}));

const Warn = mongoose.model('Warn', new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  count: { type: Number, default: 0 }
}));

const Avis = mongoose.model('Avis', new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  shopChannelId: String,
  sellerId: String,
  buyerId: String,
  note: Number,
  createdAt: { type: Date, default: Date.now }
}));

const GuildConfig = mongoose.model('GuildConfig', new mongoose.Schema({
  guildId: { type: String, unique: true, required: true },
  avisChannelId: String,
  joinRoleId: String,
  allowedLinkRoleId: String,
  statsTotalMembersChannelId: String,
  statsOnlineMembersChannelId: String,
  statsProofChannelId: String,
  statsStoreChannelId: String
}));

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getGuildConfig(guildId) {
  return GuildConfig.findOne({ guildId }).lean();
}

async function getOrCreateGuildConfig(guildId, update = {}) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: update },
    { upsert: true, new: true }
  );
}

// Trouve le shop d'un vendeur sur ce serveur
async function getShopForSeller(guildId, ownerId) {
  const shop = await Shop.findOne({ ownerId, guildId }).lean();
  if (!shop) return null;
  return shop;
}

// ═══════════════════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);

  // Reset pings toutes les 12h
  cron.schedule('0 */12 * * *', async () => {
    const shops = await Shop.find({});
    const now = new Date();
    for (const shop of shops) {
      const start = new Date(shop.pingWindowStart);
      const diffDays = (now - start) / (1000 * 60 * 60 * 24);
      if (diffDays >= CONFIG.pingWindowDays) {
        shop.pingCount = 0;
        shop.pingWindowStart = now;
        await shop.save();
      }
    }
  });

  // Rappel loyer tous les jours 10h
  cron.schedule('0 10 * * *', () => checkShopRents());

  // Stats toutes les 5 min
  cron.schedule('*/5 * * * *', async () => {
    for (const guild of client.guilds.cache.values()) {
      updateGuildStats(guild).catch(console.error);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// CRÉATION / LIEN DE SHOP
// ═══════════════════════════════════════════════════════════════

async function createShop(guild, targetMember, createdByMember) {
  const category = guild.channels.cache.get(CONFIG.shopCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, error: 'Catégorie shops introuvable' };
  }

  const channelName = `${CONFIG.shopNamePrefix}${targetMember.user.username}`.slice(0, 100);
  const everyone = guild.roles.everyone;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      { id: everyone.id, allow: ['ViewChannel'], deny: ['SendMessages'] },
      { id: targetMember.id, allow: ['ViewChannel', 'SendMessages'] }
    ]
  });

  const now = new Date();
  await Shop.findOneAndUpdate(
    { channelId: channel.id },
    {
      channelId: channel.id,
      guildId: guild.id,
      ownerId: targetMember.id,
      createdAt: now,
      createdBy: createdByMember.id,
      pingCount: 0,
      pingWindowStart: now
    },
    { upsert: true }
  );

  await channel.send({
    content: [
      '🛒 **NOUVEAU SHOP OUVERT !**',
      '',
      `✨ **Shop de :** ${targetMember}`,
      `👑 **Shop via :** ${createdByMember}`,
      `📅 **Début :** ${now.toLocaleString('fr-FR')}`,
      '',
      '📣 Utilise `!ping` ici pour ping `@everyone`.',
      `⚠️ Tu as droit à **${CONFIG.maxPingsPerWindow} pings** par **${CONFIG.pingWindowDays} jours**.`
    ].join('\n')
  });

  await updateGuildStats(guild).catch(() => {});
  return { ok: true, channel };
}

async function linkShopToSeller(guild, channel, ownerMember, createdByMember) {
  const now = new Date();
  await Shop.findOneAndUpdate(
    { channelId: channel.id },
    {
      channelId: channel.id,
      guildId: guild.id,
      ownerId: ownerMember.id,
      createdAt: now,
      createdBy: createdByMember.id,
      pingCount: 0,
      pingWindowStart: now
    },
    { upsert: true }
  );
  await updateGuildStats(guild).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

async function ensureStatsChannels(guild) {
  const guildId = guild.id;
  const cfg = await getGuildConfig(guildId);
  const category = guild.channels.cache.get(CONFIG.statsCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return null;

  const everyone = guild.roles.everyone;

  async function getOrCreate(key, defaultName) {
    let ch = cfg?.[key] ? guild.channels.cache.get(cfg[key]) : null;
    if (!ch) {
      ch = await guild.channels.create({
        name: defaultName,
        type: ChannelType.GuildVoice,
        parent: category,
        permissionOverwrites: [
          { id: everyone.id, allow: ['ViewChannel'], deny: ['Connect'] }
        ]
      });
      await getOrCreateGuildConfig(guildId, { [key]: ch.id });
    }
    return ch;
  }

  await getOrCreate('statsTotalMembersChannelId', '🖤・Total: 0');
  await getOrCreate('statsOnlineMembersChannelId', '🖤・En ligne: 0');
  await getOrCreate('statsProofChannelId', '🖤・Proofs: 0');
  await getOrCreate('statsStoreChannelId', '🖤・Stores: 0');
  return true;
}

async function updateGuildStats(guild) {
  const guildId = guild.id;
  const cfg = await getGuildConfig(guildId);
  if (!cfg) return;

  const channels = {
    total: cfg.statsTotalMembersChannelId ? guild.channels.cache.get(cfg.statsTotalMembersChannelId) : null,
    online: cfg.statsOnlineMembersChannelId ? guild.channels.cache.get(cfg.statsOnlineMembersChannelId) : null,
    proof: cfg.statsProofChannelId ? guild.channels.cache.get(cfg.statsProofChannelId) : null,
    store: cfg.statsStoreChannelId ? guild.channels.cache.get(cfg.statsStoreChannelId) : null
  };

  if (!channels.total && !channels.online && !channels.proof && !channels.store) return;

  const members = await guild.members.fetch();
  const totalMembers = members.size;
  const onlineMembers = members.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
  const totalProofs = await Avis.countDocuments({ guildId });
  const totalStores = await Shop.countDocuments({ guildId });

  if (channels.total) await channels.total.setName(`🖤・Total: ${totalMembers}`).catch(() => {});
  if (channels.online) await channels.online.setName(`🖤・En ligne: ${onlineMembers}`).catch(() => {});
  if (channels.proof) await channels.proof.setName(`🖤・Proofs: ${totalProofs}`).catch(() => {});
  if (channels.store) await channels.store.setName(`🖤・Stores: ${totalStores}`).catch(() => {});
}

async function checkShopRents() {
  const shops = await Shop.find({});
  const now = new Date();
  for (const shop of shops) {
    try {
      const ch = await client.channels.fetch(shop.channelId).catch(() => null);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const created = new Date(shop.createdAt);
      const diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (diffDays >= CONFIG.shopRentDays && Math.round(diffDays) % CONFIG.shopRentDays === 0) {
        await ch.send({
          content: `⚠️ **RAPPEL HÉBERGEMENT**\n\n💰 Paiement **${CONFIG.shopPriceEuros}€** ou boost \`${CONFIG.inviteLink}\` — sinon suppression du shop.`
        });
      }
    } catch (e) { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// ANTI-LIENS
// ═══════════════════════════════════════════════════════════════

const LINK_REGEX = /(https?:\/\/|discord\.gg\/|www\.)/i;

async function handleLink(message) {
  if (!message.guild || message.author.bot || !LINK_REGEX.test(message.content)) return;
  const member = message.member;
  if (!member) return;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  const cfg = await getGuildConfig(message.guild.id);
  const allowedRole = cfg?.allowedLinkRoleId || CONFIG.allowedLinkRoleId;
  if (allowedRole && member.roles.cache.has(allowedRole)) return;

  await message.delete().catch(() => {});

  const warn = await Warn.findOneAndUpdate(
    { userId: message.author.id },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const remaining = Math.max(CONFIG.maxWarns - warn.count, 0);
  await message.channel.send({
    content: `⚠️ ${message.author}\n\n🚫 Tu ne peux pas te pub gratuitement, contact un owner !\n❗ Il te reste **${remaining}** avertissement(s).`
  });

  if (warn.count >= CONFIG.maxWarns) {
    await member.timeout(CONFIG.muteDurationDays * 24 * 60 * 60 * 1000, 'Abus pubs/liens');
    warn.count = 0;
    await warn.save();
    await message.channel.send(`🔇 ${member} mute **${CONFIG.muteDurationDays} jours** pour abus.`);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════════════════════

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || !message.content?.trim()) return;

    // Anti-liens en premier
    await handleLink(message);

    const content = message.content.trim();
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);

    // ─── !create
    if (content.startsWith('!create ')) {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ `!create @user`');
      const result = await createShop(message.guild, target, message.author);
      if (result.ok) return message.reply(`✅ Shop créé pour ${target} dans ${result.channel}.`);
      return message.reply('⚠️ ' + (result.error || 'Erreur'));
    }

    // ─── !linkshop / !registershop
    if (content.startsWith('!linkshop ') || content.startsWith('!registershop ')) {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      const target = message.mentions.members.first();
      if (!target) {
        return message.reply('❌ `!linkshop @vendeur #salon` ou `!registershop @vendeur` (dans le salon)');
      }
      const channelMatch = content.match(/<#(\d+)>/);
      const channel = channelMatch
        ? await message.guild.channels.fetch(channelMatch[1]).catch(() => null)
        : message.channel;
      if (!channel || channel.type !== ChannelType.GuildText) return message.reply('❌ Salon invalide.');
      await linkShopToSeller(message.guild, channel, target, message.author);
      return message.reply(`✅ ${channel} lié au shop de ${target}. \`!pr @${target.user.username}\` fonctionnera.`);
    }

    // ─── !checkshop
    if (content.startsWith('!checkshop ')) {
      const target = message.mentions.users.first();
      if (!target) return message.reply('❌ `!checkshop @vendeur`');
      const shop = await getShopForSeller(message.guild.id, target.id);
      if (!shop) return message.reply(`❌ Aucun shop enregistré pour ${target}.`);
      const ch = await client.channels.fetch(shop.channelId).catch(() => null);
      const status = ch ? `✅ ${ch}` : '⚠️ Salon supprimé (utilise !linkshop pour re-lier)';
      return message.reply(`📋 Shop de ${target} : ${status}`);
    }

    // ─── !setavis
    if (content === '!setavis') {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      await getOrCreateGuildConfig(message.guild.id, { avisChannelId: message.channel.id });
      return message.reply('✅ Salon d\'avis configuré pour `!pr`.');
    }

    // ─── !setjoinrole
    if (content.startsWith('!setjoinrole ')) {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ `!setjoinrole @role`');
      await getOrCreateGuildConfig(message.guild.id, { joinRoleId: role.id });
      return message.reply(`✅ Rôle ${role} donné à l'arrivée.`);
    }

    // ─── !setlinkrole
    if (content.startsWith('!setlinkrole ')) {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ `!setlinkrole @role`');
      await getOrCreateGuildConfig(message.guild.id, { allowedLinkRoleId: role.id });
      return message.reply(`✅ Seuls ${role} (et admins) peuvent envoyer des liens.`);
    }

    // ─── !stats
    if (content === '!stats') {
      if (!isAdmin) return message.reply('❌ Admin uniquement.');
      const ok = await ensureStatsChannels(message.guild);
      if (!ok) return message.reply('⚠️ Catégorie stats introuvable.');
      await updateGuildStats(message.guild);
      return message.reply('✅ Salons de stats créés/mis à jour.');
    }

    // ─── !ping
    if (content === '!ping') {
      const shop = await Shop.findOne({ channelId: message.channel.id });
      if (!shop) return message.reply('❌ Utilise ça dans un salon de shop.');
      const hasRole = message.member?.roles.cache.has(CONFIG.pingRoleId) || isAdmin;
      if (!hasRole) return message.reply('❌ Tu n\'as pas le rôle ping.');
      if (shop.ownerId !== message.member?.id && !isAdmin) return message.reply('❌ Seul le proprio (ou admin) peut ping.');

      const now = new Date();
      const start = new Date(shop.pingWindowStart);
      if ((now - start) / (1000 * 60 * 60 * 24) >= CONFIG.pingWindowDays) {
        shop.pingCount = 0;
        shop.pingWindowStart = now;
      }
      if (shop.pingCount >= CONFIG.maxPingsPerWindow) {
        await shop.save();
        return message.reply(`⏳ Plus de pings (${CONFIG.maxPingsPerWindow}/5j). Attends le reset.`);
      }
      shop.pingCount++;
      await shop.save();
      const rest = CONFIG.maxPingsPerWindow - shop.pingCount;
      return message.channel.send({
        content: `📢 **ANNONCE SHOP**\n@everyone\n\n🛍️ ${message.member} vient de faire une **annonce**.\n🔔 Il lui reste **${rest}** ping(s).\n\n✨ Profitez des offres !`
      });
    }

    // ─── !pr
    if (content.startsWith('!pr ')) {
      const cfg = await getGuildConfig(message.guild.id);
      const avisChannelId = cfg?.avisChannelId;
      const isAvisChannel = message.channel.id === avisChannelId || message.channel.name === CONFIG.avisChannelName;
      if (!isAvisChannel) return message.reply('❌ Utilise `!pr @vendeur` dans le salon proof (`#🍂・proof`).');

      const seller = message.mentions.users.first();
      if (!seller) return message.reply('❌ `!pr @vendeur`');

      const shop = await getShopForSeller(message.guild.id, seller.id);
      if (!shop) return message.reply(`❌ Aucun shop enregistré pour ${seller}. Un admin doit faire \`!linkshop @${seller.username} #salon\` ou \`!registershop @${seller.username}\` dans le salon du shop.`);

      let shopChannel = client.channels.cache.get(shop.channelId);
      if (!shopChannel) shopChannel = await client.channels.fetch(shop.channelId).catch(() => null);
      if (!shopChannel || shopChannel.type !== ChannelType.GuildText) {
        return message.reply(`⚠️ Le salon du shop de ${seller} est introuvable. Un admin peut faire \`!linkshop @${seller.username} #salon\` pour le re-lier.`);
      }
      if (shopChannel.guildId !== message.guild.id) return message.reply('❌ Ce shop est sur un autre serveur.');

      const filter = m => m.author.id === message.author.id;

      await message.reply('⭐ Note le vendeur sur **10** (ex: `9/10`).');
      const noteCol = await message.channel.awaitMessages({ filter, max: 1, time: 60_000 }).catch(() => null);
      const noteStr = noteCol?.first()?.content?.trim() || '';
      const noteNum = parseInt(noteStr.match(/(\d{1,2})/)?.[1] ?? 'x', 10);
      if (isNaN(noteNum) || noteNum < 0 || noteNum > 10) {
        return message.reply('❌ Note invalide (0-10). Recommence `!pr`.');
      }

      await message.reply('📝 Décris ce que tu as commandé.');
      const cmdCol = await message.channel.awaitMessages({ filter, max: 1, time: 120_000 }).catch(() => null);
      const commande = cmdCol?.first()?.content?.trim() || '—';

      await message.reply('📦 Explique comment s\'est passée la commande.');
      const avisCol = await message.channel.awaitMessages({ filter, max: 1, time: 180_000 }).catch(() => null);
      const avisTexte = avisCol?.first()?.content?.trim() || '—';

      const msg = await shopChannel.send({
        content: [
          '🧾 **NOUVEL AVIS CLIENT**',
          `👤 **Acheteur :** ${message.author}`,
          `🛍️ **Vendeur :** ${seller}`,
          `⭐ **Note :** ${noteNum}/10`,
          `📦 **Commande :** ${commande}`,
          `💬 **Avis :** ${avisTexte}`,
          '',
          '📎 Poste ta **preuve** en réponse à ce fil.'
        ].join('\n')
      });

      const thread = await msg.startThread({
        name: `Avis de ${message.author.username} (${noteNum}/10)`,
        autoArchiveDuration: 10080
      });
      await thread.send('📎 Poste ici ta preuve d\'achat.');

      await Avis.create({
        guildId: message.guild.id,
        shopChannelId: shop.channelId,
        sellerId: seller.id,
        buyerId: message.author.id,
        note: noteNum
      });
      await updateGuildStats(message.guild).catch(() => {});

      return message.reply(`✅ Avis posté dans le shop de ${seller} !`);
    }

    // ─── !legit
    if (content === '!legit') {
      const m = await message.channel.send('❓ **Est-ce qu\'on est legit ?**');
      await m.react('✅');
      await m.react('❌');
    }
  } catch (err) {
    console.error('Erreur messageCreate', err);
  }
});

// ─── Auto-rôle arrivée
client.on('guildMemberAdd', async (member) => {
  try {
    const cfg = await getGuildConfig(member.guild.id);
    if (!cfg?.joinRoleId) return;
    const role = member.guild.roles.cache.get(cfg.joinRoleId);
    if (role) await member.roles.add(role, 'Auto-rôle');
  } catch (e) { console.error('Auto-rôle', e); }
});

// ═══════════════════════════════════════════════════════════════
// DÉMARRAGE
// ═══════════════════════════════════════════════════════════════

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN manquant.');
  process.exit(1);
}
client.login(token);
