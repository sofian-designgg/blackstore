/**
 * Bot Discord Black Store v2
 * TOUT configurable via commandes !set — 100% sur le bot
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

const DEFAULTS = { shopNamePrefix: '💸・', shopPriceEuros: 3, maxPings: 3, pingDays: 5, muteDays: 5, maxWarns: 5, rentDays: 14, inviteLink: 'https://discord.gg/example' };

// ═══════════════════════════════════════════════════════════════
// CLIENT
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
  console.error('❌ MONGO_URL manquant.');
  process.exit(1);
}

mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => {
    console.error('❌ MongoDB', err);
    process.exit(1);
  });

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
  shopCategoryId: String,
  statsCategoryId: String,
  avisChannelId: String,
  pingRoleId: String,
  allowedLinkRoleId: String,
  joinRoleId: String,
  shopNamePrefix: String,
  shopPriceEuros: Number,
  maxPings: Number,
  pingDays: Number,
  muteDays: Number,
  maxWarns: Number,
  rentDays: Number,
  inviteLink: String,
  statsTotalMembersChannelId: String,
  statsOnlineMembersChannelId: String,
  statsProofChannelId: String,
  statsStoreChannelId: String
}, { strict: false }));

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function getConfig(guildId) {
  return GuildConfig.findOne({ guildId }).lean();
}

async function setConfig(guildId, update) {
  return GuildConfig.findOneAndUpdate({ guildId }, { $set: update }, { upsert: true, new: true });
}

function opt(cfg, key, def) {
  const v = cfg?.[key];
  return v !== undefined && v !== null ? v : def;
}

// ═══════════════════════════════════════════════════════════════
// CRON
// ═══════════════════════════════════════════════════════════════

client.once('ready', () => {
  console.log(`✅ Bot : ${client.user.tag}`);
  cron.schedule('0 */12 * * *', () => resetPings());
  cron.schedule('0 10 * * *', () => checkRents());
  cron.schedule('*/5 * * * *', async () => { for (const g of client.guilds.cache.values()) updateStats(g).catch(() => {}); });
});

async function resetPings() {
  const shops = await Shop.find({});
  const now = new Date();
  for (const s of shops) {
    const cfg = await getConfig(s.guildId);
    const days = opt(cfg, 'pingDays', DEFAULTS.pingDays);
    const diff = (now - new Date(s.pingWindowStart)) / 86400000;
    if (diff >= days) { s.pingCount = 0; s.pingWindowStart = now; await s.save(); }
  }
}

// ═══════════════════════════════════════════════════════════════
// SHOP
// ═══════════════════════════════════════════════════════════════

async function createShop(guild, target, author) {
  const cfg = await getConfig(guild.id);
  const catId = cfg?.shopCategoryId;
  if (!catId) return { ok: false, err: 'Configure d\'abord : `!setcategory shop #catégorie-shops`' };

  const cat = guild.channels.cache.get(catId);
  if (!cat || cat.type !== ChannelType.GuildCategory) return { ok: false, err: 'Catégorie shops introuvable.' };

  const prefix = opt(cfg, 'shopNamePrefix', DEFAULTS.shopNamePrefix);
  const name = `${prefix}${target.user.username}`.slice(0, 100);
  const everyone = guild.roles.everyone;

  const ch = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: cat,
    permissionOverwrites: [
      { id: everyone.id, allow: ['ViewChannel'], deny: ['SendMessages'] },
      { id: target.id, allow: ['ViewChannel', 'SendMessages'] }
    ]
  });

  const now = new Date();
  await Shop.findOneAndUpdate(
    { channelId: ch.id },
    { channelId: ch.id, guildId: guild.id, ownerId: target.id, createdAt: now, createdBy: author.id, pingCount: 0, pingWindowStart: now },
    { upsert: true }
  );

  const maxP = opt(cfg, 'maxPings', DEFAULTS.maxPings);
  const pingD = opt(cfg, 'pingDays', DEFAULTS.pingDays);
  await ch.send({
    content: [
      '🛒 **NOUVEAU SHOP**',
      `✨ **Shop de :** ${target}`,
      `👑 **Via :** ${author}`,
      `📅 **Début :** ${now.toLocaleString('fr-FR')}`,
      '',
      `📣 \`!ping\` ici — ${maxP} pings / ${pingD} jours.`
    ].join('\n')
  });

  await updateStats(guild).catch(() => {});
  return { ok: true, channel: ch };
}

async function linkShop(guild, channel, owner, author) {
  const now = new Date();
  await Shop.findOneAndUpdate(
    { channelId: channel.id },
    { channelId: channel.id, guildId: guild.id, ownerId: owner.id, createdAt: now, createdBy: author.id, pingCount: 0, pingWindowStart: now },
    { upsert: true }
  );
  await updateStats(guild).catch(() => {});
}

async function checkRents() {
  const shops = await Shop.find({});
  const now = new Date();
  for (const s of shops) {
    try {
      const cfg = await getConfig(s.guildId);
      const rentDays = opt(cfg, 'rentDays', DEFAULTS.rentDays);
      const price = opt(cfg, 'shopPriceEuros', DEFAULTS.shopPriceEuros);
      const invite = opt(cfg, 'inviteLink', DEFAULTS.inviteLink);
      const ch = await client.channels.fetch(s.channelId).catch(() => null);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const diff = (now - new Date(s.createdAt)) / 86400000;
      if (diff >= rentDays && Math.round(diff) % rentDays === 0) {
        await ch.send({ content: `⚠️ **RAPPEL** — ${price}€ ou boost \`${invite}\` sinon suppression.` });
      }
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

async function ensureStatsChannels(guild) {
  const cfg = await getConfig(guild.id);
  const catId = cfg?.statsCategoryId;
  if (!catId) return { ok: false, err: 'Configure : `!setcategory stats #catégorie-stats`' };

  const cat = guild.channels.cache.get(catId);
  if (!cat || cat.type !== ChannelType.GuildCategory) return { ok: false, err: 'Catégorie stats introuvable.' };

  const everyone = guild.roles.everyone;
  const keys = ['statsTotalMembersChannelId', 'statsOnlineMembersChannelId', 'statsProofChannelId', 'statsStoreChannelId'];
  const names = ['🖤・Total: 0', '🖤・En ligne: 0', '🖤・Proofs: 0', '🖤・Stores: 0'];

  for (let i = 0; i < keys.length; i++) {
    let ch = cfg?.[keys[i]] ? guild.channels.cache.get(cfg[keys[i]]) : null;
    if (!ch) {
      ch = await guild.channels.create({
        name: names[i],
        type: ChannelType.GuildVoice,
        parent: cat,
        permissionOverwrites: [{ id: everyone.id, allow: ['ViewChannel'], deny: ['Connect'] }]
      });
      await setConfig(guild.id, { [keys[i]]: ch.id });
    }
  }
  return { ok: true };
}

async function updateStats(guild) {
  const cfg = await getConfig(guild.id);
  if (!cfg) return;
  const gid = guild.id;

  const ids = [cfg.statsTotalMembersChannelId, cfg.statsOnlineMembersChannelId, cfg.statsProofChannelId, cfg.statsStoreChannelId];
  const chs = ids.map(id => id ? guild.channels.cache.get(id) : null).filter(Boolean);
  if (!chs.length) return;

  const members = await guild.members.fetch();
  const total = members.size;
  const online = members.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
  const proofs = await Avis.countDocuments({ guildId: gid });
  const stores = await Shop.countDocuments({ guildId: gid });

  const updates = [
    [`🖤・Total: ${total}`, cfg.statsTotalMembersChannelId],
    [`🖤・En ligne: ${online}`, cfg.statsOnlineMembersChannelId],
    [`🖤・Proofs: ${proofs}`, cfg.statsProofChannelId],
    [`🖤・Stores: ${stores}`, cfg.statsStoreChannelId]
  ];
  for (const [name, id] of updates) {
    const c = id ? guild.channels.cache.get(id) : null;
    if (c) await c.setName(name).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// ANTI-LIENS
// ═══════════════════════════════════════════════════════════════

const LINK_REGEX = /(https?:\/\/|discord\.gg\/|www\.)/i;

async function onLink(message) {
  if (!message.guild || message.author.bot || !LINK_REGEX.test(message.content)) return;
  const m = message.member;
  if (!m) return;

  if (m.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  const cfg = await getConfig(message.guild.id);
  const roleId = cfg?.allowedLinkRoleId;
  if (roleId && m.roles.cache.has(roleId)) return;

  await message.delete().catch(() => {});

  const w = await Warn.findOneAndUpdate(
    { userId: message.author.id },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );
  const maxWarns = opt(cfg, 'maxWarns', DEFAULTS.maxWarns);
  const muteDays = opt(cfg, 'muteDays', DEFAULTS.muteDays);
  const rest = Math.max(maxWarns - w.count, 0);
  await message.channel.send({
    content: `⚠️ ${message.author}\n\n🚫 Pas de pub gratuite ! Contacte un owner.\n❗ **${rest}** avertissement(s) restant(s).`
  });

  if (w.count >= maxWarns) {
    await m.timeout(muteDays * 86400000, 'Abus pubs');
    w.count = 0;
    await w.save();
    await message.channel.send(`🔇 ${m} mute **${muteDays} jours**.`);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════════════════════

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || !message.content?.trim()) return;
    const content = message.content.trim();
    const admin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);

    await onLink(message);

    // ─── !setcategory shop
    if (content.startsWith('!setcategory shop ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const guild = message.guild;
      const ch = message.mentions.channels.first();
      let cat = null;
      if (ch) {
        cat = ch.type === ChannelType.GuildCategory ? ch : guild.channels.cache.get(ch.parentId);
      } else {
        const id = content.match(/\d{17,20}/)?.[0];
        if (id) cat = guild.channels.cache.get(id);
      }
      if (!cat || cat.type !== ChannelType.GuildCategory) return message.reply('❌ `!setcategory shop #catégorie` (mentionne un salon dans la catégorie) ou `!setcategory shop ID`');
      await setConfig(guild.id, { shopCategoryId: cat.id });
      return message.reply(`✅ Catégorie shops : **${cat.name}**`);
    }

    // ─── !setcategory stats
    if (content.startsWith('!setcategory stats ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const guild = message.guild;
      const ch = message.mentions.channels.first();
      let cat = null;
      if (ch) {
        cat = ch.type === ChannelType.GuildCategory ? ch : guild.channels.cache.get(ch.parentId);
      } else {
        const id = content.match(/\d{17,20}/)?.[0];
        if (id) cat = guild.channels.cache.get(id);
      }
      if (!cat || cat.type !== ChannelType.GuildCategory) return message.reply('❌ `!setcategory stats #catégorie` ou `!setcategory stats ID`');
      await setConfig(guild.id, { statsCategoryId: cat.id });
      return message.reply(`✅ Catégorie stats : **${cat.name}**`);
    }

    // ─── !setavis
    if (content === '!setavis') {
      if (!admin) return message.reply('❌ Admin uniquement.');
      await setConfig(message.guild.id, { avisChannelId: message.channel.id });
      return message.reply('✅ Salon proof configuré pour `!pr`.');
    }

    // ─── !setpingrole
    if (content.startsWith('!setpingrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ `!setpingrole @role`');
      await setConfig(message.guild.id, { pingRoleId: role.id });
      return message.reply(`✅ Rôle ping : ${role}`);
    }

    // ─── !setlinkrole
    if (content.startsWith('!setlinkrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ `!setlinkrole @role`');
      await setConfig(message.guild.id, { allowedLinkRoleId: role.id });
      return message.reply(`✅ Rôle autorisé à envoyer des liens : ${role}`);
    }

    // ─── !setjoinrole
    if (content.startsWith('!setjoinrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ `!setjoinrole @role`');
      await setConfig(message.guild.id, { joinRoleId: role.id });
      return message.reply(`✅ Rôle à l'arrivée : ${role}`);
    }

    // ─── !setshopprefix
    if (content.startsWith('!setshopprefix ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const prefix = content.slice(14).trim().slice(0, 20) || DEFAULTS.shopNamePrefix;
      await setConfig(message.guild.id, { shopNamePrefix: prefix });
      return message.reply(`✅ Préfixe shops : \`${prefix}\``);
    }

    // ─── !setloyer
    if (content.startsWith('!setloyer ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 0) return message.reply('❌ `!setloyer 3` (prix en euros)');
      await setConfig(message.guild.id, { shopPriceEuros: n });
      return message.reply(`✅ Loyer shop : **${n}€**`);
    }

    // ─── !setinvite
    if (content.startsWith('!setinvite ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const link = content.slice(11).trim().slice(0, 200);
      if (!link) return message.reply('❌ `!setinvite https://discord.gg/xxx`');
      await setConfig(message.guild.id, { inviteLink: link });
      return message.reply(`✅ Lien serveur : ${link}`);
    }

    // ─── !setpings
    if (content.startsWith('!setpings ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 1 || n > 50) return message.reply('❌ `!setpings 3` (nb de pings autorisés)');
      await setConfig(message.guild.id, { maxPings: n });
      return message.reply(`✅ Pings max : **${n}** par période`);
    }

    // ─── !setpingdays
    if (content.startsWith('!setpingdays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 1 || n > 365) return message.reply('❌ `!setpingdays 5` (période en jours)');
      await setConfig(message.guild.id, { pingDays: n });
      return message.reply(`✅ Période pings : **${n} jours**`);
    }

    // ─── !setwarns
    if (content.startsWith('!setwarns ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 1 || n > 20) return message.reply('❌ `!setwarns 5` (avertissements avant mute)');
      await setConfig(message.guild.id, { maxWarns: n });
      return message.reply(`✅ Avertissements max : **${n}** avant mute`);
    }

    // ─── !setmutedays
    if (content.startsWith('!setmutedays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 1 || n > 365) return message.reply('❌ `!setmutedays 5` (durée mute en jours)');
      await setConfig(message.guild.id, { muteDays: n });
      return message.reply(`✅ Durée mute : **${n} jours**`);
    }

    // ─── !setrentdays
    if (content.startsWith('!setrentdays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(content.split(/\s+/)[1], 10);
      if (isNaN(n) || n < 1 || n > 365) return message.reply('❌ `!setrentdays 14` (rappel loyer tous les X jours)');
      await setConfig(message.guild.id, { rentDays: n });
      return message.reply(`✅ Rappel loyer : tous les **${n} jours**`);
    }

    // ─── !config
    if (content === '!config') {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const cfg = await getConfig(message.guild.id);
      const lines = [
        '📋 **Config**',
        cfg?.shopCategoryId ? `🛒 Shops : <#${cfg.shopCategoryId}>` : '🛒 Shops : —',
        cfg?.statsCategoryId ? `📊 Stats : <#${cfg.statsCategoryId}>` : '📊 Stats : —',
        cfg?.avisChannelId ? `⭐ Proof : <#${cfg.avisChannelId}>` : '⭐ Proof : —',
        cfg?.pingRoleId ? `🔔 Ping : <@&${cfg.pingRoleId}>` : '🔔 Ping : —',
        cfg?.allowedLinkRoleId ? `🔗 Liens : <@&${cfg.allowedLinkRoleId}>` : '🔗 Liens : —',
        cfg?.joinRoleId ? `👋 Arrivée : <@&${cfg.joinRoleId}>` : '👋 Arrivée : —',
        `📦 Préfixe : \`${opt(cfg, 'shopNamePrefix', DEFAULTS.shopNamePrefix)}\``,
        `💰 Loyer : ${opt(cfg, 'shopPriceEuros', DEFAULTS.shopPriceEuros)}€`,
        `📣 Pings : ${opt(cfg, 'maxPings', DEFAULTS.maxPings)} / ${opt(cfg, 'pingDays', DEFAULTS.pingDays)}j`,
        `⚠️ Warns : ${opt(cfg, 'maxWarns', DEFAULTS.maxWarns)} → mute ${opt(cfg, 'muteDays', DEFAULTS.muteDays)}j`,
        `📅 Rappel loyer : ${opt(cfg, 'rentDays', DEFAULTS.rentDays)}j`,
        `🔗 Invite : ${opt(cfg, 'inviteLink', DEFAULTS.inviteLink)}`
      ];
      return message.reply(lines.join('\n'));
    }

    // ─── !create
    if (content.startsWith('!create ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ `!create @user`');
      const r = await createShop(message.guild, target, message.author);
      if (r.ok) return message.reply(`✅ Shop créé : ${r.channel}`);
      return message.reply('⚠️ ' + (r.err || 'Erreur'));
    }

    // ─── !linkshop / !registershop
    if (content.startsWith('!linkshop ') || content.startsWith('!registershop ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ `!linkshop @vendeur #salon` ou `!registershop @vendeur` (dans le salon)');
      const m = content.match(/<#(\d+)>/);
      const ch = m ? await message.guild.channels.fetch(m[1]).catch(() => null) : message.channel;
      if (!ch || ch.type !== ChannelType.GuildText) return message.reply('❌ Salon invalide.');
      await linkShop(message.guild, ch, target, message.author);
      return message.reply(`✅ ${ch} lié à ${target}. \`!pr @${target.user.username}\` OK.`);
    }

    // ─── !checkshop
    if (content.startsWith('!checkshop ')) {
      const u = message.mentions.users.first();
      if (!u) return message.reply('❌ `!checkshop @vendeur`');
      const shop = await Shop.findOne({ ownerId: u.id, guildId: message.guild.id });
      if (!shop) return message.reply(`❌ Aucun shop pour ${u}.`);
      const ch = await client.channels.fetch(shop.channelId).catch(() => null);
      return message.reply(ch ? `✅ Shop : ${ch}` : '⚠️ Salon supprimé. Utilise `!linkshop` pour re-lier.');
    }

    // ─── !stats
    if (content === '!stats') {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const r = await ensureStatsChannels(message.guild);
      if (!r.ok) return message.reply('⚠️ ' + (r.err || 'Erreur'));
      await updateStats(message.guild);
      return message.reply('✅ Salons stats créés/mis à jour.');
    }

    // ─── !ping
    if (content === '!ping') {
      const shop = await Shop.findOne({ channelId: message.channel.id });
      if (!shop) return message.reply('❌ Utilise dans un salon de shop.');
      const cfg = await getConfig(message.guild.id);
      const canPing = admin || (cfg?.pingRoleId && message.member?.roles.cache.has(cfg.pingRoleId));
      if (!canPing) return message.reply('❌ Tu n\'as pas le rôle ping. Configure : `!setpingrole @role`');
      if (shop.ownerId !== message.member?.id && !admin) return message.reply('❌ Seul le proprio peut ping.');

      const maxPings = opt(cfg, 'maxPings', DEFAULTS.maxPings);
      const pingDays = opt(cfg, 'pingDays', DEFAULTS.pingDays);
      const now = new Date();
      const start = new Date(shop.pingWindowStart);
      if ((now - start) / 86400000 >= pingDays) {
        shop.pingCount = 0;
        shop.pingWindowStart = now;
      }
      if (shop.pingCount >= maxPings) {
        await shop.save();
        return message.reply(`⏳ Plus de pings. Attends le reset.`);
      }
      shop.pingCount++;
      await shop.save();
      const rest = maxPings - shop.pingCount;
      return message.channel.send({
        content: `📢 **ANNONCE SHOP**\n@everyone\n\n🛍️ ${message.member} — annonce.\n🔔 **${rest}** ping(s) restant(s).`
      });
    }

    // ─── !pr
    if (content.startsWith('!pr ')) {
      const cfg = await getConfig(message.guild.id);
      const avisId = cfg?.avisChannelId;
      const ok = message.channel.id === avisId || message.channel.name?.includes('proof');
      if (!ok) return message.reply('❌ Utilise `!pr @vendeur` dans le salon proof. Configure : `!setavis` dans ce salon.');

      const seller = message.mentions.users.first();
      if (!seller) return message.reply('❌ `!pr @vendeur`');

      const shop = await Shop.findOne({ ownerId: seller.id, guildId: message.guild.id });
      if (!shop) return message.reply(`❌ Aucun shop pour ${seller}. Admin : \`!linkshop @${seller.username} #salon\``);

      let sch = client.channels.cache.get(shop.channelId) ?? await client.channels.fetch(shop.channelId).catch(() => null);
      if (!sch || sch.type !== ChannelType.GuildText) return message.reply(`⚠️ Salon shop introuvable. Admin : \`!linkshop @${seller.username} #salon\``);
      if (sch.guildId !== message.guild.id) return message.reply('❌ Shop sur un autre serveur.');

      const filter = m => m.author.id === message.author.id;

      await message.reply('⭐ Note sur 10 (ex: `9/10`).');
      const n1 = await message.channel.awaitMessages({ filter, max: 1, time: 60_000 }).catch(() => null);
      const n = parseInt(n1?.first()?.content?.match(/(\d{1,2})/)?.[1] ?? 'x', 10);
      if (isNaN(n) || n < 0 || n > 10) return message.reply('❌ Note invalide.');

      await message.reply('📝 Décris ta commande.');
      const n2 = await message.channel.awaitMessages({ filter, max: 1, time: 120_000 }).catch(() => null);
      const cmd = n2?.first()?.content?.trim() || '—';

      await message.reply('📦 Avis sur la commande ?');
      const n3 = await message.channel.awaitMessages({ filter, max: 1, time: 180_000 }).catch(() => null);
      const avis = n3?.first()?.content?.trim() || '—';

      const msg = await sch.send({
        content: [
          '🧾 **AVIS CLIENT**',
          `👤 ${message.author} | 🛍️ ${seller} | ⭐ ${n}/10`,
          `📦 ${cmd}`,
          `💬 ${avis}`,
          '',
          '📎 Preuve en réponse.'
        ].join('\n')
      });
      const thread = await msg.startThread({ name: `Avis ${message.author.username} (${n}/10)`, autoArchiveDuration: 10080 });
      await thread.send('📎 Poste ta preuve ici.');

      await Avis.create({ guildId: message.guild.id, shopChannelId: shop.channelId, sellerId: seller.id, buyerId: message.author.id, note: n });
      await updateStats(message.guild).catch(() => {});

      return message.reply(`✅ Avis posté dans le shop de ${seller} !`);
    }

    // ─── !legit
    if (content === '!legit') {
      const m = await message.channel.send('❓ **Est-ce qu\'on est legit ?**');
      await m.react('✅');
      await m.react('❌');
    }

    // ─── !help
    if (content === '!help') {
      const help = [
        '**🛒 Shops**',
        '`!create @user` | `!linkshop @vendeur #salon` | `!registershop @vendeur` | `!checkshop @vendeur`',
        '',
        '**⚙️ Config (admin) — tout se set sur le bot**',
        '`!setcategory shop #cat` | `!setcategory stats #cat` | `!setavis`',
        '`!setpingrole @role` | `!setlinkrole @role` | `!setjoinrole @role`',
        '`!setshopprefix 💸・` | `!setloyer 3` | `!setinvite https://discord.gg/xxx`',
        '`!setpings 3` | `!setpingdays 5` | `!setwarns 5` | `!setmutedays 5` | `!setrentdays 14`',
        '`!config` — Voir toute la config',
        '',
        '**📢 Autres**',
        '`!ping` | `!pr @vendeur` | `!stats` | `!legit`'
      ];
      return message.reply(help.join('\n'));
    }
  } catch (err) {
    console.error(err);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const cfg = await getConfig(member.guild.id);
    if (!cfg?.joinRoleId) return;
    const role = member.guild.roles.cache.get(cfg.joinRoleId);
    if (role) await member.roles.add(role, 'Auto-rôle');
  } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN manquant.');
  process.exit(1);
}
client.login(token);
