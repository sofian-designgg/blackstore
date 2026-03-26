/**
 * Black Store Bot - clean rebuild
 * Tout configurable via Discord avec !set...
 */
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const cron = require('node-cron');
const mongoose = require('mongoose');

const DEFAULTS = {
  shopNamePrefix: '💸・',
  shopPriceEuros: 3,
  maxPings: 3,
  pingDays: 5,
  maxWarns: 5,
  muteDays: 5,
  rentDays: 14,
  inviteLink: 'https://discord.gg/sayuri'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Channel]
});

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL manquant.');
  process.exit(1);
}

mongoose
  .connect(mongoUrl, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log('MongoDB connecte'))
  .catch((err) => {
    console.error('Erreur MongoDB', err);
    process.exit(1);
  });

const GuildConfig = mongoose.model(
  'GuildConfig',
  new mongoose.Schema({
    guildId: { type: String, unique: true, required: true },
    shopCategoryId: String,
    statsCategoryId: String,
    proofChannelId: String,
    ticketCategoryId: String,
    ticketStaffRoleId: String,
    ticketMessage: String,
    pingRoleId: String,
    allowedLinkRoleId: String,
    joinRoleId: String,
    shopNamePrefix: String,
    shopPriceEuros: Number,
    maxPings: Number,
    pingDays: Number,
    maxWarns: Number,
    muteDays: Number,
    rentDays: Number,
    inviteLink: String,
    statsTotalMembersChannelId: String,
    statsOnlineMembersChannelId: String,
    statsProofCountChannelId: String,
    statsProofAvgChannelId: String,
    statsStoreChannelId: String
  })
);

const Shop = mongoose.model(
  'Shop',
  new mongoose.Schema({
    guildId: { type: String, index: true, required: true },
    channelId: { type: String, unique: true, required: true },
    ownerId: { type: String, index: true, required: true },
    createdBy: String,
    createdAt: { type: Date, default: Date.now },
    pingCount: { type: Number, default: 0 },
    pingWindowStart: { type: Date, default: Date.now }
  })
);

const Warn = mongoose.model(
  'Warn',
  new mongoose.Schema({
    guildId: { type: String, index: true, required: true },
    userId: { type: String, index: true, required: true },
    count: { type: Number, default: 0 }
  })
);

Warn.schema.index({ guildId: 1, userId: 1 }, { unique: true });

const Proof = mongoose.model(
  'Proof',
  new mongoose.Schema({
    guildId: { type: String, index: true, required: true },
    buyerId: { type: String, required: true },
    orderId: { type: String, required: true },
    product: { type: String, required: true },
    comment: { type: String, required: true },
    stars: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
  })
);

const Ticket = mongoose.model(
  'Ticket',
  new mongoose.Schema({
    guildId: { type: String, index: true, required: true },
    channelId: { type: String, index: true, required: true },
    buyerId: { type: String, index: true, required: true },
    orderId: { type: String, index: true, required: true },
    status: { type: String, enum: ['open', 'sent'], default: 'open' },
    product: { type: String, default: null },
    comment: { type: String, default: null },
    stars: { type: Number, default: null },
    panelMessageId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null }
  })
);

async function getCfg(guildId) {
  return GuildConfig.findOne({ guildId }).lean();
}

async function setCfg(guildId, patch) {
  return GuildConfig.findOneAndUpdate({ guildId }, { $set: patch }, { upsert: true, new: true });
}

function val(cfg, key) {
  return cfg?.[key] !== undefined && cfg?.[key] !== null ? cfg[key] : DEFAULTS[key];
}

function isAdmin(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function avgToStars(n) {
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function generateOrderId() {
  // Format compact lisible: CMD-YYYYMMDD-XYZ
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `CMD-${date}-${rand}`;
}

function fillTicketTemplate(template, vars) {
  if (!template) return '';
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v ?? '');
  return out;
}

function buildTicketPanelEmbed(ticket, cfg) {
  const buyerMention = `<@${ticket.buyerId}>`;
  const product = ticket.product || '—';
  const comment = ticket.comment || '—';
  const stars = ticket.stars ? `⭐ ${'⭐'.repeat(ticket.stars)} (${ticket.stars}/5)` : '—';

  const desc = fillTicketTemplate(cfg?.ticketMessage, {
    ORDER_ID: ticket.orderId,
    BUYER: buyerMention
  });

  return new EmbedBuilder()
    .setTitle('🧾 Ticket Proof')
    .setDescription(desc || `🆔 ID commande: \`${ticket.orderId}\`\n\nClique sur **"📝 Remplir mes infos"**.`)
    .addFields(
      { name: '🆔 ID commande', value: `\`${ticket.orderId}\``, inline: true },
      { name: '📦 Produit', value: product, inline: false },
      { name: '⭐ Note', value: stars, inline: false },
      { name: '💬 Commentaire', value: comment, inline: false },
      { name: '👤 Acheteur', value: buyerMention, inline: true }
    )
    .setColor(0x2a0b0b);
}

function buildTicketPanelComponents(ticketId) {
  const fillBtn = new ButtonBuilder()
    .setCustomId(`ticketFill:${ticketId}`)
    .setLabel('📝 Remplir mes infos')
    .setStyle(ButtonStyle.Primary);

  const sendBtn = new ButtonBuilder()
    .setCustomId(`ticketSend:${ticketId}`)
    .setLabel('✅ Envoyer en preuve')
    .setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(fillBtn),
    new ActionRowBuilder().addComponents(sendBtn)
  ];
}

function buildOpenTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📩 Ticket Proof')
    .setDescription(
      [
        'Clique sur le bouton ci-dessous pour créer ton ticket de preuve.',
        'Ensuite, un admin/staff va valider et envoyer la proof dans le salon configuré.'
      ].join('\n')
    )
    .setColor(0x2a0b0b);
}

function buildOpenTicketPanelComponents() {
  const openBtn = new ButtonBuilder()
    .setCustomId('ticketOpenPanel')
    .setLabel('🧾 Ouvrir mon ticket')
    .setStyle(ButtonStyle.Success);

  return [new ActionRowBuilder().addComponents(openBtn)];
}

async function createTicketForUser(guild, user, replyFn) {
  const cfg = await getCfg(guild.id);
  if (!cfg?.ticketCategoryId) {
    return replyFn({ ok: false, err: '❌ Configure d’abord la categorie tickets: `!setcategory ticket #cat`' });
  }

  const existing = await Ticket.findOne({
    guildId: guild.id,
    buyerId: user.id,
    status: 'open'
  });

  if (existing) {
    return replyFn({ ok: false, err: '⏳ Tu as déjà un ticket ouvert.' });
  }

  const category = guild.channels.cache.get(cfg.ticketCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return replyFn({ ok: false, err: '❌ Categorie tickets introuvable.' });
  }

  const orderId = generateOrderId();
  const channelName = `📩・ticket-${user.username}`.slice(0, 90);

  const everyoneId = guild.roles.everyone.id;
  const staffRoleId = cfg?.ticketStaffRoleId;

  const channel = await guild.channels
    .create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category,
      permissionOverwrites: [
        { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        },
        ...(staffRoleId
          ? [
              {
                id: staffRoleId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
              }
            ]
          : [])
      ]
    })
    .catch(() => null);

  if (!channel) {
    return replyFn({ ok: false, err: '❌ Impossible de créer le ticket.' });
  }

  const ticket = await Ticket.create({
    guildId: guild.id,
    channelId: channel.id,
    buyerId: user.id,
    orderId
  });

  const panelMsg = await channel.send({
    embeds: [buildTicketPanelEmbed(ticket, cfg)],
    components: buildTicketPanelComponents(ticket.id)
  });

  ticket.panelMessageId = panelMsg.id;
  await ticket.save();

  return replyFn({ ok: true, channel, orderId });
}

async function createTicket(message) {
  const cfg = await getCfg(message.guild.id);
  if (!cfg?.ticketCategoryId) {
    await message.reply('❌ Configure d’abord la categorie tickets: `!setcategory ticket #cat`');
    return;
  }

  const existing = await Ticket.findOne({ guildId: message.guild.id, buyerId: message.author.id, status: 'open' });
  if (existing) {
    await message.reply('⏳ Tu as déjà un ticket ouvert.');
    return;
  }

  const category = message.guild.channels.cache.get(cfg.ticketCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await message.reply('❌ Categorie tickets introuvable.');
    return;
  }

  await createTicketForUser(message.guild, message.author, async (res) => {
    if (!res.ok) return message.reply(res.err);
    return message.reply(`✅ Ticket cree: ${res.channel}\n🆔 ID commande: \`${res.orderId}\``);
  });
}

async function postProofFromTicket(interaction, ticket, cfg) {
  const proofChannelId = cfg?.proofChannelId;
  if (!proofChannelId) {
    return { ok: false, err: '❌ Un admin doit configurer le salon proof: `!setprf #salon`.' };
  }

  const proofChannel = await interaction.guild.channels.fetch(proofChannelId).catch(() => null);
  if (!proofChannel || proofChannel.type !== ChannelType.GuildText) {
    return { ok: false, err: '❌ Salon proof invalide. Refais `!setprf #salon`.' };
  }

  if (!ticket.product || !ticket.comment || !Number.isInteger(ticket.stars)) {
    return { ok: false, err: '❌ Infos ticket incomplètes. Le buyer doit remplir produit/note/comment.' };
  }

  await Proof.create({
    guildId: interaction.guild.id,
    buyerId: ticket.buyerId,
    orderId: ticket.orderId,
    product: ticket.product,
    comment: ticket.comment,
    stars: ticket.stars
  });

  const proofCountAgg = await Proof.aggregate([
    { $match: { guildId: interaction.guild.id } },
    { $group: { _id: null, avg: { $avg: '$stars' }, total: { $sum: 1 } } }
  ]);

  const avg = proofCountAgg[0]?.avg || 0;
  const total = proofCountAgg[0]?.total || 0;

  await proofChannel.send(
    [
      '🧾 **NOUVEL AVIS / PROOF**',
      `👤 Acheteur: <@${ticket.buyerId}>`,
      `🆔 ID commande: \`${ticket.orderId}\``,
      `📦 Produit: ${ticket.product}`,
      `⭐ Note: ${'⭐'.repeat(ticket.stars)} (${ticket.stars}/5)`,
      `💬 Commentaire: ${ticket.comment}`,
      '',
      `📊 Moyenne globale: **${avgToStars(avg)}/5** (${total} avis)`
    ].join('\n')
  );

  await updateStats(interaction.guild).catch(() => {});
  return { ok: true };
}

async function resolveCategoryFromMessage(message, raw) {
  const mention = message.mentions.channels.first();
  if (mention) {
    if (mention.type === ChannelType.GuildCategory) return mention;
    if (mention.parentId) return message.guild.channels.cache.get(mention.parentId) || null;
  }
  const id = raw.match(/\d{17,20}/)?.[0];
  if (!id) return null;
  const channel = message.guild.channels.cache.get(id);
  return channel && channel.type === ChannelType.GuildCategory ? channel : null;
}

async function ensureStatsChannels(guild) {
  const cfg = await getCfg(guild.id);
  const statsCatId = cfg?.statsCategoryId;
  if (!statsCatId) return { ok: false, err: 'Fais !setcategory stats ...' };

  const category = guild.channels.cache.get(statsCatId);
  if (!category || category.type !== ChannelType.GuildCategory) return { ok: false, err: 'Categorie stats introuvable.' };

  const everyone = guild.roles.everyone.id;
  const defs = [
    ['statsTotalMembersChannelId', '🖤・Membres: 0'],
    ['statsOnlineMembersChannelId', '🖤・En ligne: 0'],
    ['statsProofCountChannelId', '🖤・Proofs: 0'],
    ['statsProofAvgChannelId', '🖤・Note Moy: 0.00⭐'],
    ['statsStoreChannelId', '🖤・Stores: 0']
  ];

  for (const [key, name] of defs) {
    const existingId = cfg?.[key];
    const existing = existingId ? guild.channels.cache.get(existingId) : null;
    if (existing) continue;
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category,
      permissionOverwrites: [
        {
          id: everyone,
          allow: [PermissionsBitField.Flags.ViewChannel],
          deny: [PermissionsBitField.Flags.Connect]
        }
      ]
    });
    await setCfg(guild.id, { [key]: ch.id });
  }

  return { ok: true };
}

async function updateStats(guild) {
  const cfg = await getCfg(guild.id);
  if (!cfg) return;

  const members = await guild.members.fetch();
  const totalMembers = members.size;
  const onlineMembers = members.filter((m) => m.presence && m.presence.status !== 'offline').size;

  const proofCount = await Proof.countDocuments({ guildId: guild.id });
  const proofAgg = await Proof.aggregate([
    { $match: { guildId: guild.id } },
    { $group: { _id: null, avg: { $avg: '$stars' } } }
  ]);
  const proofAvg = proofAgg[0]?.avg || 0;

  const storeCount = await Shop.countDocuments({ guildId: guild.id });

  const updates = [
    [cfg.statsTotalMembersChannelId, `🖤・Membres: ${totalMembers}`],
    [cfg.statsOnlineMembersChannelId, `🖤・En ligne: ${onlineMembers}`],
    [cfg.statsProofCountChannelId, `🖤・Proofs: ${proofCount}`],
    [cfg.statsProofAvgChannelId, `🖤・Note Moy: ${avgToStars(proofAvg)}⭐`],
    [cfg.statsStoreChannelId, `🖤・Stores: ${storeCount}`]
  ];

  for (const [channelId, name] of updates) {
    if (!channelId) continue;
    const ch = guild.channels.cache.get(channelId);
    if (!ch) continue;
    await ch.setName(name).catch(() => {});
  }
}

async function resetPingWindows() {
  const shops = await Shop.find({});
  const now = Date.now();
  for (const s of shops) {
    const cfg = await getCfg(s.guildId);
    const days = val(cfg, 'pingDays');
    const elapsedDays = (now - new Date(s.pingWindowStart).getTime()) / 86400000;
    if (elapsedDays >= days) {
      s.pingCount = 0;
      s.pingWindowStart = new Date();
      await s.save();
    }
  }
}

async function sendRentReminders() {
  const shops = await Shop.find({});
  const now = Date.now();
  for (const s of shops) {
    const cfg = await getCfg(s.guildId);
    const rentDays = val(cfg, 'rentDays');
    const price = val(cfg, 'shopPriceEuros');
    const inviteLink = val(cfg, 'inviteLink');
    const elapsedDays = (now - new Date(s.createdAt).getTime()) / 86400000;
    if (elapsedDays < rentDays || Math.round(elapsedDays) % rentDays !== 0) continue;

    const ch = await client.channels.fetch(s.channelId).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) continue;
    await ch
      .send(`⚠️ Attention ! Tu dois payer **${price}€** ton hebergement ou booster le serveur \`${inviteLink}\` sinon ton shop sera supprime.`)
      .catch(() => {});
  }
}

async function createShop(message, target) {
  const cfg = await getCfg(message.guild.id);
  if (!cfg?.shopCategoryId) {
    await message.reply('❌ Configure d’abord la categorie shop: `!setcategory shop ...`');
    return;
  }
  const category = message.guild.channels.cache.get(cfg.shopCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await message.reply('❌ Categorie shop introuvable.');
    return;
  }

  const prefix = val(cfg, 'shopNamePrefix');
  const channelName = `${prefix}${target.user.username}`.slice(0, 100);

  const channel = await message.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      {
        id: message.guild.roles.everyone.id,
        allow: [PermissionsBitField.Flags.ViewChannel],
        deny: [PermissionsBitField.Flags.SendMessages]
      },
      {
        id: target.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      }
    ]
  });

  const now = new Date();
  await Shop.findOneAndUpdate(
    { channelId: channel.id },
    {
      guildId: message.guild.id,
      ownerId: target.id,
      createdBy: message.author.id,
      createdAt: now,
      pingCount: 0,
      pingWindowStart: now
    },
    { upsert: true }
  );

  await channel.send(
    [
      '🛒 **NOUVEAU SHOP OUVERT**',
      `✨ Shop de: ${target}`,
      `👑 Shop via: ${message.author}`,
      `📅 Debut: ${now.toLocaleString('fr-FR')}`,
      `📣 Utilise \`!ping\` ici (${val(cfg, 'maxPings')} fois / ${val(cfg, 'pingDays')} jours).`
    ].join('\n')
  );

  await updateStats(message.guild).catch(() => {});
  await message.reply(`✅ Shop cree: ${channel}`);
}

const LINK_REGEX = /(https?:\/\/|discord\.gg\/|www\.)/i;

async function moderateLinks(message) {
  if (!message.guild || message.author.bot || !LINK_REGEX.test(message.content)) return;
  if (isAdmin(message.member)) return;

  const cfg = await getCfg(message.guild.id);
  const allowedRoleId = cfg?.allowedLinkRoleId;
  if (allowedRoleId && message.member.roles.cache.has(allowedRoleId)) return;

  await message.delete().catch(() => {});

  const warn = await Warn.findOneAndUpdate(
    { guildId: message.guild.id, userId: message.author.id },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const maxWarns = val(cfg, 'maxWarns');
  const muteDays = val(cfg, 'muteDays');
  const rest = Math.max(0, maxWarns - warn.count);

  await message.channel.send(
    `⚠️ ${message.author}\n🚫 Tu ne peux pas te pub gratuitement, contact un owner pour en discuter !\n❗ Il te reste **${rest}** avertissement(s).`
  );

  if (warn.count >= maxWarns) {
    await message.member.timeout(muteDays * 86400000, 'Abus de liens/publicite').catch(() => {});
    warn.count = 0;
    await warn.save();
    await message.channel.send(`🔇 ${message.member} mute ${muteDays} jours.`);
  }
}

async function runProofQuestionnaire(message) {
  const cfg = await getCfg(message.guild.id);
  const proofChannelId = cfg?.proofChannelId;
  if (!proofChannelId) {
    await message.reply('❌ Un admin doit configurer le salon proof: `!setprf #salon`.');
    return;
  }

  const proofChannel = await message.guild.channels.fetch(proofChannelId).catch(() => null);
  if (!proofChannel || proofChannel.type !== ChannelType.GuildText) {
    await message.reply('❌ Salon proof invalide. Refais `!setprf #salon`.');
    return;
  }

  // Limitation Discord: message "visible seulement pour lui" impossible en commande préfixe.
  // On lance donc le questionnaire en DM (visible uniquement par lui).
  const dm = await message.author.createDM().catch(() => null);
  if (!dm) {
    await message.reply('❌ Impossible de t’envoyer un DM. Active tes messages privés puis recommence.');
    return;
  }

  await message.reply('📩 Je t’ai envoye un questionnaire en DM pour ton avis/proof.');

  const filter = (m) => m.author.id === message.author.id;

  await dm.send('🧾 **Questionnaire Proof**\nRéponds étape par étape.\n\n1) ID de commande ? (obligatoire)');
  const q1 = await dm.awaitMessages({ filter, max: 1, time: 120000 }).catch(() => null);
  const orderId = q1?.first()?.content?.trim();
  if (!orderId) return dm.send('⏳ Temps depasse. Recommence avec `+pr`.');

  await dm.send('2) Quel produit as-tu acheté ?');
  const q2 = await dm.awaitMessages({ filter, max: 1, time: 120000 }).catch(() => null);
  const product = q2?.first()?.content?.trim();
  if (!product) return dm.send('⏳ Temps depasse. Recommence avec `+pr`.');

  await dm.send('3) Note sur 5 etoiles ? (1,2,3,4 ou 5)');
  const q3 = await dm.awaitMessages({ filter, max: 1, time: 120000 }).catch(() => null);
  const stars = parseInt((q3?.first()?.content || '').replace(/\D/g, ''), 10);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return dm.send('❌ Note invalide. Recommence avec `+pr` et mets un nombre de 1 à 5.');
  }

  await dm.send('4) Ton commentaire ?');
  const q4 = await dm.awaitMessages({ filter, max: 1, time: 180000 }).catch(() => null);
  const comment = q4?.first()?.content?.trim();
  if (!comment) return dm.send('⏳ Temps depasse. Recommence avec `+pr`.');

  await Proof.create({
    guildId: message.guild.id,
    buyerId: message.author.id,
    orderId,
    product,
    comment,
    stars
  });

  const agg = await Proof.aggregate([
    { $match: { guildId: message.guild.id } },
    { $group: { _id: null, avg: { $avg: '$stars' }, total: { $sum: 1 } } }
  ]);
  const avg = agg[0]?.avg || 0;
  const total = agg[0]?.total || 0;

  const post = await proofChannel.send(
    [
      '🧾 **NOUVEL AVIS / PROOF**',
      `👤 Acheteur: ${message.author}`,
      `🆔 ID commande: \`${orderId}\``,
      `📦 Produit: ${product}`,
      `⭐ Note: ${'⭐'.repeat(stars)} (${stars}/5)`,
      `💬 Commentaire: ${comment}`,
      '',
      `📊 Moyenne globale: **${avgToStars(avg)}/5** (${total} avis)`
    ].join('\n')
  );

  await message.channel.send(`${message.author} ✅ Ton avis a été publié dans ${proofChannel}.`);
  await updateStats(message.guild).catch(() => {});
  return post;
}

client.once('ready', () => {
  console.log(`Connecte: ${client.user.tag}`);
  cron.schedule('0 */12 * * *', () => resetPingWindows().catch(() => {}));
  cron.schedule('0 10 * * *', () => sendRentReminders().catch(() => {}));
  cron.schedule('*/5 * * * *', async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStats(guild).catch(() => {});
    }
  });
});

client.on('guildMemberAdd', async (member) => {
  const cfg = await getCfg(member.guild.id);
  if (!cfg?.joinRoleId) return;
  const role = member.guild.roles.cache.get(cfg.joinRoleId);
  if (role) await member.roles.add(role).catch(() => {});
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || !message.content) return;
    if (message.author.bot) return;

    await moderateLinks(message);

    const text = message.content.trim();
    const admin = isAdmin(message.member);

    if (text.startsWith('!setcategory shop ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const category = await resolveCategoryFromMessage(message, text);
      if (!category) return message.reply('❌ Utilise `!setcategory shop #salon-dans-la-categorie` ou ID.');
      await setCfg(message.guild.id, { shopCategoryId: category.id });
      return message.reply(`✅ Categorie shop definie: **${category.name}**`);
    }

    if (text.startsWith('!setcategory stats ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const category = await resolveCategoryFromMessage(message, text);
      if (!category) return message.reply('❌ Utilise `!setcategory stats #salon-dans-la-categorie` ou ID.');
      await setCfg(message.guild.id, { statsCategoryId: category.id });
      return message.reply(`✅ Categorie stats definie: **${category.name}**`);
    }

    if (text.startsWith('!setcategory ticket ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const category = await resolveCategoryFromMessage(message, text);
      if (!category) return message.reply('❌ Utilise `!setcategory ticket #cat` ou ID.');
      await setCfg(message.guild.id, { ticketCategoryId: category.id });
      return message.reply(`✅ Categorie ticket definie: **${category.name}**`);
    }

    if (text === '!setprf' || text.startsWith('!setprf ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const mentioned = message.mentions.channels.first();
      const ch = mentioned ? message.guild.channels.cache.get(mentioned.id) : message.channel;
      if (!ch || ch.type !== ChannelType.GuildText) return message.reply('❌ Utilise `!setprf #salon` ou fais `!setprf` dans le salon.');
      await setCfg(message.guild.id, { proofChannelId: ch.id });
      return message.reply(`✅ Salon proof defini: ${ch}`);
    }

    if (text.startsWith('!setticketstaffrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Utilise `!setticketstaffrole @role`');
      await setCfg(message.guild.id, { ticketStaffRoleId: role.id });
      return message.reply(`✅ Role staff tickets: ${role}`);
    }

    if (text.startsWith('!setticketmessage ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const msg = text.replace('!setticketmessage', '').trim().slice(0, 800);
      if (!msg) return message.reply('❌ Utilise `!setticketmessage ...`');
      await setCfg(message.guild.id, { ticketMessage: msg });
      return message.reply('✅ Message ticket defini.');
    }

    if (text.startsWith('!setpingrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Utilise `!setpingrole @role`');
      await setCfg(message.guild.id, { pingRoleId: role.id });
      return message.reply(`✅ Role ping: ${role}`);
    }

    if (text.startsWith('!setlinkrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Utilise `!setlinkrole @role`');
      await setCfg(message.guild.id, { allowedLinkRoleId: role.id });
      return message.reply(`✅ Role autorise liens: ${role}`);
    }

    if (text.startsWith('!setjoinrole ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Utilise `!setjoinrole @role`');
      await setCfg(message.guild.id, { joinRoleId: role.id });
      return message.reply(`✅ Role auto-arrivee: ${role}`);
    }

    if (text.startsWith('!setshopprefix ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const prefix = text.replace('!setshopprefix', '').trim().slice(0, 20);
      if (!prefix) return message.reply('❌ Utilise `!setshopprefix 💸・`');
      await setCfg(message.guild.id, { shopNamePrefix: prefix });
      return message.reply(`✅ Prefixe shop: \`${prefix}\``);
    }

    if (text.startsWith('!setloyer ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 0) return message.reply('❌ Utilise `!setloyer 3`');
      await setCfg(message.guild.id, { shopPriceEuros: n });
      return message.reply(`✅ Loyer: ${n}€`);
    }

    if (text.startsWith('!setinvite ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const link = text.replace('!setinvite', '').trim().slice(0, 200);
      if (!link) return message.reply('❌ Utilise `!setinvite https://discord.gg/xxx`');
      await setCfg(message.guild.id, { inviteLink: link });
      return message.reply(`✅ Lien invite: ${link}`);
    }

    if (text.startsWith('!setpings ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) return message.reply('❌ Utilise `!setpings 3`');
      await setCfg(message.guild.id, { maxPings: n });
      return message.reply(`✅ Max pings: ${n}`);
    }

    if (text.startsWith('!setpingdays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) return message.reply('❌ Utilise `!setpingdays 5`');
      await setCfg(message.guild.id, { pingDays: n });
      return message.reply(`✅ Fenetre pings: ${n} jours`);
    }

    if (text.startsWith('!setwarns ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 1 || n > 20) return message.reply('❌ Utilise `!setwarns 5`');
      await setCfg(message.guild.id, { maxWarns: n });
      return message.reply(`✅ Warns max: ${n}`);
    }

    if (text.startsWith('!setmutedays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) return message.reply('❌ Utilise `!setmutedays 5`');
      await setCfg(message.guild.id, { muteDays: n });
      return message.reply(`✅ Mute: ${n} jours`);
    }

    if (text.startsWith('!setrentdays ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const n = parseInt(text.split(/\s+/)[1], 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) return message.reply('❌ Utilise `!setrentdays 14`');
      await setCfg(message.guild.id, { rentDays: n });
      return message.reply(`✅ Rappel loyer: ${n} jours`);
    }

    if (text === '!config') {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const cfg = await getCfg(message.guild.id);
      const lines = [
        '📋 Config actuelle',
        cfg?.shopCategoryId ? `🛒 Shop category: <#${cfg.shopCategoryId}>` : '🛒 Shop category: —',
        cfg?.statsCategoryId ? `📊 Stats category: <#${cfg.statsCategoryId}>` : '📊 Stats category: —',
        cfg?.proofChannelId ? `⭐ Proof channel: <#${cfg.proofChannelId}>` : '⭐ Proof channel: —',
        cfg?.ticketCategoryId ? `📩 Ticket category: <#${cfg.ticketCategoryId}>` : '📩 Ticket category: —',
        cfg?.ticketStaffRoleId ? `🧑‍💻 Ticket staff role: <@&${cfg.ticketStaffRoleId}>` : '🧑‍💻 Ticket staff role: —',
        cfg?.ticketMessage
          ? `📝 Ticket embed msg: ${cfg.ticketMessage.slice(0, 60).replace(/\\n/g, ' ')}...`
          : '📝 Ticket embed msg: —',
        cfg?.pingRoleId ? `🔔 Ping role: <@&${cfg.pingRoleId}>` : '🔔 Ping role: —',
        cfg?.allowedLinkRoleId ? `🔗 Link role: <@&${cfg.allowedLinkRoleId}>` : '🔗 Link role: —',
        cfg?.joinRoleId ? `👋 Join role: <@&${cfg.joinRoleId}>` : '👋 Join role: —',
        `📦 Prefixe shop: \`${val(cfg, 'shopNamePrefix')}\``,
        `💰 Loyer: ${val(cfg, 'shopPriceEuros')}€`,
        `📣 Pings: ${val(cfg, 'maxPings')} / ${val(cfg, 'pingDays')} jours`,
        `⚠️ Warns: ${val(cfg, 'maxWarns')} → mute ${val(cfg, 'muteDays')} jours`,
        `📅 Rent reminder: ${val(cfg, 'rentDays')} jours`,
        `🔗 Invite link: ${val(cfg, 'inviteLink')}`
      ];
      return message.reply(lines.join('\n'));
    }

    if (text.startsWith('!create ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Utilise `!create @user`');
      return createShop(message, target);
    }

    if (text.startsWith('!linkshop ') || text.startsWith('!registershop ')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const owner = message.mentions.members.first();
      if (!owner) return message.reply('❌ Utilise `!linkshop @vendeur #salon` ou `!registershop @vendeur`');

      const chMention = message.mentions.channels.first();
      const targetChannel = chMention
        ? await message.guild.channels.fetch(chMention.id).catch(() => null)
        : message.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return message.reply('❌ Salon invalide.');

      await Shop.findOneAndUpdate(
        { channelId: targetChannel.id },
        {
          guildId: message.guild.id,
          channelId: targetChannel.id,
          ownerId: owner.id,
          createdBy: message.author.id,
          createdAt: new Date(),
          pingCount: 0,
          pingWindowStart: new Date()
        },
        { upsert: true }
      );
      await updateStats(message.guild).catch(() => {});
      return message.reply(`✅ ${targetChannel} lie a ${owner}`);
    }

    if (text.startsWith('!checkshop ')) {
      const target = message.mentions.users.first();
      if (!target) return message.reply('❌ Utilise `!checkshop @vendeur`');
      const shop = await Shop.findOne({ guildId: message.guild.id, ownerId: target.id });
      if (!shop) return message.reply(`❌ Aucun shop pour ${target}`);
      const ch = await message.guild.channels.fetch(shop.channelId).catch(() => null);
      return message.reply(ch ? `✅ Shop: ${ch}` : '⚠️ Shop en base mais salon supprimé.');
    }

    if (text === '!stats') {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const ensured = await ensureStatsChannels(message.guild);
      if (!ensured.ok) return message.reply(`❌ ${ensured.err}`);
      await updateStats(message.guild);
      return message.reply('✅ Salons stats crees/mis a jour.');
    }

    if (text === '!ping') {
      const shop = await Shop.findOne({ guildId: message.guild.id, channelId: message.channel.id });
      if (!shop) return message.reply('❌ Commande uniquement dans un salon shop.');
      const cfg = await getCfg(message.guild.id);
      const canPing = isAdmin(message.member) || (cfg?.pingRoleId && message.member.roles.cache.has(cfg.pingRoleId));
      if (!canPing) return message.reply('❌ Tu n’as pas la permission ping.');
      if (!isAdmin(message.member) && shop.ownerId !== message.member.id) return message.reply('❌ Seul le proprio peut ping.');

      const now = Date.now();
      const pingDays = val(cfg, 'pingDays');
      const maxPings = val(cfg, 'maxPings');
      const elapsedDays = (now - new Date(shop.pingWindowStart).getTime()) / 86400000;
      if (elapsedDays >= pingDays) {
        shop.pingCount = 0;
        shop.pingWindowStart = new Date();
      }
      if (shop.pingCount >= maxPings) {
        await shop.save();
        return message.reply('⏳ Limite de pings atteinte.');
      }

      shop.pingCount += 1;
      await shop.save();
      const left = maxPings - shop.pingCount;

      await message.channel.send(
        ['📢 **ANNONCE SHOP**', '@everyone', '', `🛍️ ${message.member} vient de faire une annonce.`, `🔔 Il lui reste **${left}** ping(s).`].join('\n')
      );
      return;
    }

    if (text === '!ticket' || text === '+ticket') {
      return createTicket(message);
    }

    if (text.startsWith('+sendticketpanel')) {
      if (!admin) return message.reply('❌ Admin uniquement.');
      const mentioned = message.mentions.channels.first();
      const ch = mentioned ? message.guild.channels.cache.get(mentioned.id) : message.channel;
      if (!ch || ch.type !== ChannelType.GuildText) return message.reply('❌ Salon invalide.');

      await ch.send({
        embeds: [buildOpenTicketPanelEmbed()],
        components: buildOpenTicketPanelComponents()
      });
      return message.reply('✅ Panel ticket envoyé.');
    }

    if (text === '+pr') {
      return runProofQuestionnaire(message);
    }

    if (text === '!legit') {
      const msg = await message.channel.send('❓ Est-ce qu’on est legit ?');
      await msg.react('✅');
      await msg.react('❌');
      return;
    }

    if (text === '+helpstore') {
      const help = [
        '**🛠️ SETUP (admin)**',
        '`!setcategory shop ...` | `!setcategory stats ...` | `!setprf #salon`',
        '`!setcategory ticket #cat`',
        '`!setticketstaffrole @role` | `!setticketmessage ...`',
        '`!setpingrole @role` | `!setlinkrole @role` | `!setjoinrole @role`',
        '`!setshopprefix ...` | `!setloyer ...` | `!setinvite ...`',
        '`!setpings ...` | `!setpingdays ...` | `!setwarns ...` | `!setmutedays ...` | `!setrentdays ...`',
        '`!config`',
        '',
        '**🛒 SHOPS**',
        '`!create @user` | `!linkshop @user #salon` | `!registershop @user` | `!checkshop @user`',
        '',
        '**📣 UTILISATION**',
        '`!ping` | `!ticket` | `+ticket` | `+sendticketpanel` | `+pr` | `!stats` | `!legit`'
      ];
      await message.reply(help.join('\n'));
    }
  } catch (err) {
    console.error('Erreur messageCreate', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.guild) return;

    const customId = interaction.customId || '';

    if (interaction.isButton()) {
      if (customId === 'ticketOpenPanel') {
        await interaction.deferReply({ ephemeral: true });
        const res = await createTicketForUser(interaction.guild, interaction.user, async (r) => r);
        if (!res?.ok) {
          return interaction.editReply(res.err || '❌ Erreur lors de la creation du ticket.');
        }

        return interaction.editReply(`✅ Ticket cree: ${res.channel}\n🆔 ID commande: \`${res.orderId}\``);
      }

      if (customId.startsWith('ticketFill:')) {
        const ticketId = customId.split(':')[1];
        const ticket = await Ticket.findById(ticketId).lean();
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
        if (ticket.status !== 'open') return interaction.reply({ content: '⛔ Ticket deja envoye.', ephemeral: true });
        if (ticket.buyerId !== interaction.user.id) return interaction.reply({ content: '❌ Ce n’est pas ton ticket.', ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`ticketModal:${ticketId}`)
          .setTitle('🧾 Remplir mes infos');

        const productRow = new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('productInput')
            .setLabel('📦 Produit acheté')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(true)
        );

        const starsRow = new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('starsInput')
            .setLabel('⭐ Note (1 à 5)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setRequired(true)
        );

        const commentRow = new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('commentInput')
            .setLabel('💬 Commentaire')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(true)
        );

        modal.addComponents(productRow, starsRow, commentRow);

        await interaction.showModal(modal);
        return;
      }

      if (customId.startsWith('ticketSend:')) {
        const ticketId = customId.split(':')[1];
        const cfg = await getCfg(interaction.guild.id);
        const ticket = await Ticket.findById(ticketId);
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
        if (ticket.status !== 'open') return interaction.reply({ content: '⛔ Ticket deja envoye.', ephemeral: true });

        const authorized =
          isAdmin(interaction.member) ||
          (cfg?.ticketStaffRoleId && interaction.member.roles.cache.has(cfg.ticketStaffRoleId));

        if (!authorized) {
          return interaction.reply({ content: '❌ Seuls les admins / staff tickets peuvent valider.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Verif champs
        if (!ticket.product || !ticket.comment || !Number.isInteger(ticket.stars)) {
          await interaction.editReply('❌ Le ticket n’est pas complet. Produit / Note / Commentaire requis.');
          return;
        }

        const res = await postProofFromTicket(interaction, ticket, cfg);
        if (!res?.ok) {
          await interaction.editReply(res.err || '❌ Erreur lors de l\'envoi.');
          return;
        }

        ticket.status = 'sent';
        ticket.sentAt = new Date();
        await ticket.save();

        // Message de clôture avant verrouillage
        await interaction.channel.send('✅ Proof envoyée dans le salon `proof`. Ticket clôturé.');

        // Verrouille l’envoi de messages
        const everyoneId = interaction.guild.roles.everyone.id;
        await interaction.channel.permissionOverwrites.edit(everyoneId, { SendMessages: false }).catch(() => {});
        await interaction.channel.permissionOverwrites.edit(ticket.buyerId, { SendMessages: false }).catch(() => {});
        if (cfg?.ticketStaffRoleId) {
          await interaction.channel.permissionOverwrites.edit(cfg.ticketStaffRoleId, { SendMessages: false }).catch(() => {});
        }

        await interaction.editReply('✅ Ticket validé. Proof envoyée.');
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (customId.startsWith('ticketModal:')) {
        const ticketId = customId.split(':')[1];
        const ticket = await Ticket.findById(ticketId);
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
        if (ticket.status !== 'open') return interaction.reply({ content: '⛔ Ticket deja envoye.', ephemeral: true });
        if (ticket.buyerId !== interaction.user.id) return interaction.reply({ content: '❌ Ce n’est pas ton ticket.', ephemeral: true });

        const cfg = await getCfg(interaction.guild.id);
        const product = interaction.fields.getTextInputValue('productInput').trim();
        const starsRaw = interaction.fields.getTextInputValue('starsInput').trim();
        const stars = parseInt(starsRaw.replace(/\D/g, ''), 10);
        const comment = interaction.fields.getTextInputValue('commentInput').trim();

        if (!product) return interaction.reply({ content: '❌ Produit invalide.', ephemeral: true });
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
          return interaction.reply({ content: '❌ Note invalide. Mets un nombre de 1 à 5.', ephemeral: true });
        }
        if (!comment) return interaction.reply({ content: '❌ Commentaire invalide.', ephemeral: true });

        ticket.product = product;
        ticket.stars = stars;
        ticket.comment = comment;
        await ticket.save();

        // Met a jour l’embed de panel si possible
        const panelId = ticket.panelMessageId;
        if (panelId) {
          const msg = await interaction.channel.messages.fetch(panelId).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [buildTicketPanelEmbed(ticket, cfg)],
              components: buildTicketPanelComponents(ticket.id)
            }).catch(() => {});
          }
        }

        return interaction.reply({ content: '✅ Infos enregistrées. Admin pourra valider avec le bouton.', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Erreur interactionCreate', err);
    try {
      if (interaction.isRepliable && interaction.isRepliable()) {
        await interaction.reply({ content: '❌ Erreur interne.', ephemeral: true }).catch(() => {});
      }
    } catch (e) {}
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN manquant.');
  process.exit(1);
}

client.login(token);
