const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');
let googleapis = null;
try {
  googleapis = require('googleapis');
} catch (_error) {}
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_PREFIX = process.env.PREFIX || '!';
const OWNER_USER_ID = process.env.OWNER_USER_ID || '';
const STATUS_TEXT = process.env.BOT_STATUS_TEXT || 'MEE6-like 24/7';
const DEFAULT_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const DEFAULT_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'JobList!A:Z';
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GOOGLE_SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '';
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 8787);
const DASHBOARD_TOKEN = String(process.env.DASHBOARD_TOKEN || '').trim();
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_REDIRECT_URI = String(process.env.DISCORD_REDIRECT_URI || '').trim();
const DISCORD_OAUTH_ENABLED = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
const TECHNICAL_LEAD_ROLE_ID = String(process.env.TECHNICAL_LEAD_ROLE_ID || '').trim();
const TECHNICAL_LEAD_ROLE_NAME = String(process.env.TECHNICAL_LEAD_ROLE_NAME || 'Technical Lead').trim();
const SLASH_GUILD_ID = String(process.env.SLASH_GUILD_ID || '').trim();
const REGISTER_ALL_GUILD_SLASH_COMMANDS = /^(1|true|yes)$/i.test(String(process.env.REGISTER_ALL_GUILD_SLASH_COMMANDS || 'true'));
const REGISTER_GLOBAL_SLASH_COMMANDS = /^(1|true|yes)$/i.test(String(process.env.REGISTER_GLOBAL_SLASH_COMMANDS || 'false'));
const PRUNE_GLOBAL_SLASH_COMMANDS = /^(1|true|yes)$/i.test(String(process.env.PRUNE_GLOBAL_SLASH_COMMANDS || 'true'));
const ENABLE_GUILD_MEMBERS_INTENT = /^(1|true|yes)$/i.test(String(process.env.ENABLE_GUILD_MEMBERS_INTENT || 'false'));
const ENABLE_MESSAGE_CONTENT_INTENT = /^(1|true|yes)$/i.test(String(process.env.ENABLE_MESSAGE_CONTENT_INTENT || 'false'));

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment');
  process.exit(1);
}

const DATA_PATH = path.join(__dirname, 'data', 'bot-data.json');
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');

const TICKET_SCHEMAS = {
  job: {
    label: 'Job Ticket',
    fields: [
      { id: 'date', label: 'Date', placeholder: 'Example: 2026-03-01', style: 'short', required: true },
      { id: 'ts', label: 'TS (Trainset)', placeholder: 'Example: TS-1234 (Trainset ID)', style: 'short', required: true },
      { id: 'location', label: 'Location', placeholder: 'Example: Car 4 - Door actuator', style: 'short', required: true },
      { id: 'fault', label: 'Fault', placeholder: 'Example: Door control fault on Car 3', style: 'paragraph', required: true }
    ]
  },
  material_use: {
    label: 'Material Use Ticket',
    fields: [
      { id: 'date', label: 'Date', placeholder: 'Example: 2026-03-01', style: 'short', required: true },
      { id: 'job_no', label: 'Job No', placeholder: 'Example: JOB-240301-01', style: 'short', required: true },
      { id: 'material_sn', label: 'Material with S/N', placeholder: 'Example: Brake Relay / SN: BR-99341', style: 'paragraph', required: true }
    ]
  },
  defected_material: {
    label: 'Defected Material Ticket',
    fields: [
      { id: 'date', label: 'Date', placeholder: 'Example: 2026-03-01', style: 'short', required: true },
      { id: 'job_no', label: 'Job No', placeholder: 'Example: JOB-240301-01', style: 'short', required: true },
      { id: 'material_sn', label: 'Defected Material with S/N', placeholder: 'Example: Fuse Module / SN: FM-88412 (burnt)', style: 'paragraph', required: true }
    ]
  },
  asset_material_request: {
    label: 'Asset/Material Request Ticket',
    fields: [
      { id: 'date', label: 'Date', placeholder: 'Example: 2026-03-01', style: 'short', required: true },
      { id: 'item', label: 'Requested Asset/Material', placeholder: 'Example: Door Motor Unit', style: 'short', required: true },
      { id: 'quantity', label: 'Quantity', placeholder: 'Example: 2', style: 'short', required: true },
      { id: 'details', label: 'Request Details', placeholder: 'Example: Needed for Car 4 preventive replacement', style: 'paragraph', required: true }
    ]
  },
  general: {
    label: 'General Ticket',
    fields: [
      { id: 'date', label: 'Date', placeholder: 'Example: 2026-03-01', style: 'short', required: true },
      { id: 'inquiry', label: 'Inquiry Details', placeholder: 'Example: Please confirm the maintenance schedule for TS-1234.', style: 'paragraph', required: true }
    ]
  }
};

function loadDb() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return { guilds: {} };
    }
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    console.error('[bot] failed to load DB, reset', error);
    return { guilds: {} };
  }
}

function saveDb() {
  try {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('[bot] failed to save DB', error);
  }
}

const db = loadDb();
const xpCooldown = new Map();
const dashboardOauthStates = new Map();
const dashboardSessions = new Map();

function ensureGuild(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      prefix: DEFAULT_PREFIX,
      logChannelId: '',
      welcomeChannelId: '',
      levelingEnabled: true,
      reactionRoles: [],
      ticketChannels: {},
      tickets: {
        enabled: true,
        categoryId: '',
        supportRoleId: '',
        technicianRoleId: '',
        engineerRoleId: '',
        managerUserIds: [],
        managerRoleIds: [],
        forumChannelId: '',
        logChannelId: '',
        sheetId: DEFAULT_SHEET_ID,
        sheetRange: DEFAULT_SHEET_RANGE,
        panelMessageId: '',
        history: [],
        nextTicketNo: 1
      },
      dashboard: {
        operatorUserIds: [],
        operatorRoleIds: []
      },
      customCommands: {},
      users: {},
      automod: {
        inviteBlock: true,
        capsBlock: true,
        bannedWords: []
      }
    };
  }
  const guildState = db.guilds[guildId];
  guildState.ticketChannels = guildState.ticketChannels || {};
  guildState.tickets = guildState.tickets || {};
  guildState.dashboard = guildState.dashboard || {};
  guildState.tickets.enabled = guildState.tickets.enabled !== false;
  guildState.tickets.categoryId = guildState.tickets.categoryId || '';
  guildState.tickets.supportRoleId = guildState.tickets.supportRoleId || '';
  guildState.tickets.technicianRoleId = guildState.tickets.technicianRoleId || '';
  guildState.tickets.engineerRoleId = guildState.tickets.engineerRoleId || '';
  guildState.tickets.managerUserIds = Array.isArray(guildState.tickets.managerUserIds)
    ? guildState.tickets.managerUserIds.filter(Boolean).map((v) => String(v))
    : [];
  guildState.tickets.managerRoleIds = Array.isArray(guildState.tickets.managerRoleIds)
    ? guildState.tickets.managerRoleIds.filter(Boolean).map((v) => String(v))
    : [];
  guildState.tickets.forumChannelId = guildState.tickets.forumChannelId || '';
  guildState.tickets.logChannelId = guildState.tickets.logChannelId || '';
  guildState.tickets.sheetId = guildState.tickets.sheetId || DEFAULT_SHEET_ID;
  guildState.tickets.sheetRange = guildState.tickets.sheetRange || DEFAULT_SHEET_RANGE;
  guildState.tickets.panelMessageId = guildState.tickets.panelMessageId || '';
  guildState.tickets.history = Array.isArray(guildState.tickets.history) ? guildState.tickets.history : [];
  guildState.tickets.nextTicketNo = Number.isInteger(guildState.tickets.nextTicketNo)
    ? guildState.tickets.nextTicketNo
    : 1;
  guildState.dashboard.operatorUserIds = Array.isArray(guildState.dashboard.operatorUserIds)
    ? guildState.dashboard.operatorUserIds.filter(Boolean).map((v) => String(v))
    : [];
  guildState.dashboard.operatorRoleIds = Array.isArray(guildState.dashboard.operatorRoleIds)
    ? guildState.dashboard.operatorRoleIds.filter(Boolean).map((v) => String(v))
    : [];
  return guildState;
}

function ensureUser(guildState, userId) {
  if (!guildState.users[userId]) {
    guildState.users[userId] = {
      xp: 0,
      warnings: []
    };
  }
  return guildState.users[userId];
}

function toLevel(xp) {
  return Math.floor(0.1 * Math.sqrt(xp));
}

function isOwner(userId) {
  return OWNER_USER_ID && userId === OWNER_USER_ID;
}

function memberUserId(member) {
  if (!member) {
    return '';
  }
  return String(member.user && member.user.id ? member.user.id : member.id || '');
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) {
    return false;
  }
  if (member.roles && member.roles.cache && member.roles.cache.has(roleId)) {
    return true;
  }
  if (Array.isArray(member.roles)) {
    return member.roles.includes(roleId);
  }
  return false;
}

function isAdmin(member) {
  if (!member || !member.permissions) {
    return false;
  }
  if (typeof member.permissions.has === 'function') {
    return !!member.permissions.has(PermissionsBitField.Flags.Administrator);
  }
  try {
    const bits = new PermissionsBitField(member.permissions);
    return bits.has(PermissionsBitField.Flags.Administrator);
  } catch (_error) {
    return false;
  }
}

function canModerate(member) {
  return isAdmin(member) || isOwner(memberUserId(member));
}

async function sendLog(guild, text) {
  const guildState = ensureGuild(guild.id);
  if (!guildState.logChannelId) {
    return;
  }

  const channel = guild.channels.cache.get(guildState.logChannelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  channel.send(text).catch(() => {});
}

function parseMentionedUser(message) {
  return message.mentions.users.first() || null;
}

function parseRoleFromArg(message, arg) {
  if (!arg) {
    return null;
  }

  const mentioned = message.mentions.roles.first();
  if (mentioned) {
    return mentioned;
  }

  const raw = arg.replace(/[<@&>]/g, '');
  return message.guild.roles.cache.get(raw) || null;
}

function sanitizeChannelName(input) {
  return String(input || 'ticket')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'ticket';
}

function sanitizeTicketType(input) {
  const key = String(input || '').toLowerCase();
  if (TICKET_SCHEMAS[key]) {
    return key;
  }
  return 'general';
}

function getTicketSchema(ticketType) {
  const key = sanitizeTicketType(ticketType);
  return {
    key,
    ...TICKET_SCHEMAS[key]
  };
}

function canAccessTicket(member, guildState, ticketMeta) {
  if (!member) {
    return false;
  }
  if (canModerate(member)) {
    return true;
  }
  if (ticketMeta && String(ticketMeta.ownerId) === String(member.id)) {
    return true;
  }
  if (isTicketManagerMember(member, guildState)) {
    return true;
  }
  return false;
}

function isTicketManagerMember(member, guildState) {
  if (!member) {
    return false;
  }
  if (canModerate(member)) {
    return true;
  }
  const managerUserIds = Array.isArray(guildState.tickets.managerUserIds) ? guildState.tickets.managerUserIds : [];
  if (managerUserIds.includes(memberUserId(member))) {
    return true;
  }
  if (guildState.tickets.supportRoleId && memberHasRole(member, guildState.tickets.supportRoleId)) {
    return true;
  }
  if (guildState.tickets.engineerRoleId && memberHasRole(member, guildState.tickets.engineerRoleId)) {
    return true;
  }
  const managerRoleIds = Array.isArray(guildState.tickets.managerRoleIds) ? guildState.tickets.managerRoleIds : [];
  if (managerRoleIds.some((roleId) => memberHasRole(member, roleId))) {
    return true;
  }
  return false;
}

function isOperationsManagerMember(member, guildState) {
  if (!member) {
    return false;
  }
  if (canModerate(member)) {
    return true;
  }
  const operatorUserIds = Array.isArray(guildState.dashboard && guildState.dashboard.operatorUserIds)
    ? guildState.dashboard.operatorUserIds
    : [];
  if (operatorUserIds.includes(memberUserId(member))) {
    return true;
  }
  const operatorRoleIds = Array.isArray(guildState.dashboard && guildState.dashboard.operatorRoleIds)
    ? guildState.dashboard.operatorRoleIds
    : [];
  if (operatorRoleIds.some((roleId) => memberHasRole(member, roleId))) {
    return true;
  }
  return false;
}

function canOpenTicket(member, guildState, ticketType) {
  if (!member) {
    return false;
  }
  if (ticketType === 'general') {
    return true;
  }
  if (!guildState.tickets.technicianRoleId) {
    return true;
  }
  if (canModerate(member)) {
    return true;
  }
  return memberHasRole(member, guildState.tickets.technicianRoleId);
}

function canProcessTicket(member, guildState) {
  if (!member) {
    return false;
  }
  return isTicketManagerMember(member, guildState);
}

function buildTicketSummary(meta) {
  const answers = Array.isArray(meta && meta.intake) ? meta.intake : [];
  const typeKey = String((meta && meta.ticketType) || 'general');
  const schema = TICKET_SCHEMAS[typeKey] || TICKET_SCHEMAS.general;
  const summaryParts = answers.slice(0, 2).map((x) => String(x.value || '').trim()).filter(Boolean);
  const summary = summaryParts.join(' | ');
  const details = answers.map((x) => `${x.label}: ${x.value || '-'}`).join(' / ');
  return {
    ticketType: typeKey,
    ticketTypeLabel: schema.label,
    summary: summary || '(no summary)',
    details: details || '(no details)',
    answers
  };
}

function toTicketUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${channelId}`;
}

let googleAuthClient = null;
async function getSheetsClient() {
  if (!googleapis || !googleapis.google) {
    throw new Error('googleapis package is not installed. Run npm install.');
  }
  if (googleAuthClient) {
    return googleAuthClient;
  }

  let credentials = null;
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (GOOGLE_SERVICE_ACCOUNT_FILE && fs.existsSync(GOOGLE_SERVICE_ACCOUNT_FILE)) {
    credentials = JSON.parse(fs.readFileSync(GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
  } else {
    throw new Error('Missing Google service account credentials');
  }

  const auth = new googleapis.google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  googleAuthClient = googleapis.google.sheets({ version: 'v4', auth });
  return googleAuthClient;
}

async function appendTicketToSheet(guild, ticketChannel, meta, actor, guildState) {
  const sheetId = guildState.tickets.sheetId || DEFAULT_SHEET_ID;
  const range = guildState.tickets.sheetRange || DEFAULT_SHEET_RANGE;
  if (!sheetId) {
    throw new Error('Ticket sheetId is not configured');
  }

  const sheets = await getSheetsClient();
  const summaryData = buildTicketSummary(meta);
  const claimText = meta.claimedBy ? `<@${meta.claimedBy}>` : '';
  const values = [[
    new Date().toISOString(),
    guild.name,
    ticketChannel.name,
    String(ticketChannel.id),
    summaryData.ticketTypeLabel,
    meta.ownerTag || '',
    String(meta.ownerId || ''),
    summaryData.summary,
    summaryData.details,
    claimText,
    actor.tag,
    toTicketUrl(guild.id, ticketChannel.id),
    'OPEN'
  ]];

  const result = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  const updatedRange = result.data &&
    result.data.updates &&
    result.data.updates.updatedRange
    ? result.data.updates.updatedRange
    : '';
  const rowMatch = String(updatedRange).match(/![A-Z]+(\d+):[A-Z]+(\d+)/i) || String(updatedRange).match(/(\d+)/);
  const row = rowMatch ? Number(rowMatch[1]) : null;
  return { row, updatedRange };
}

async function createWorklogForumPost(guild, ticketChannel, meta, actor, guildState) {
  const forumId = guildState.tickets.forumChannelId;
  if (!forumId) {
    throw new Error('Ticket forum channel is not configured');
  }
  const forum = guild.channels.cache.get(forumId);
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error('Configured forum channel is invalid');
  }

  const summaryData = buildTicketSummary(meta);
  const titleBase = summaryData.summary === '(no summary)' ? ticketChannel.name : summaryData.summary;
  const threadName = `[${ticketChannel.name}] ${titleBase}`.slice(0, 100);
  const lines = [
    `Ticket: <#${ticketChannel.id}>`,
    `Requester: <@${meta.ownerId}>`,
    `Created by: ${actor}`,
    `Claimed by: ${meta.claimedBy ? `<@${meta.claimedBy}>` : 'Unassigned'}`,
    '',
    `Summary: ${summaryData.summary}`,
    `Details: ${summaryData.details}`,
    '',
    `Ticket URL: ${toTicketUrl(guild.id, ticketChannel.id)}`
  ];

  const created = await forum.threads.create({
    name: threadName,
    message: { content: lines.join('\n') }
  });
  return created;
}

async function createTicketChannel(guild, opener, sourceChannel, intakeAnswers, ticketTypeInput) {
  const guildState = ensureGuild(guild.id);
  const ticketType = sanitizeTicketType(ticketTypeInput);
  const ticketSchema = getTicketSchema(ticketType);
  if (!guildState.tickets.enabled) {
    throw new Error('Ticket system is disabled.');
  }

  const existing = Object.entries(guildState.ticketChannels || {}).find(
    ([, v]) => String(v.ownerId) === String(opener.id) && v.status === 'open'
  );
  if (existing) {
    const ch = guild.channels.cache.get(existing[0]);
    if (ch) {
      return { channel: ch, alreadyExists: true };
    }
  }

  const everyoneId = guild.roles.everyone.id;
  const overwrites = [
    {
      id: everyoneId,
      deny: [PermissionsBitField.Flags.ViewChannel]
    },
    {
      id: opener.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks
      ]
    },
    {
      id: client.user ? client.user.id : guild.client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles
      ]
    }
  ];

  if (guildState.tickets.supportRoleId) {
    overwrites.push({
      id: guildState.tickets.supportRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }
  for (const roleId of guildState.tickets.managerRoleIds || []) {
    if (!guild.roles.cache.has(roleId)) {
      continue;
    }
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }
  for (const userId of guildState.tickets.managerUserIds || []) {
    overwrites.push({
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const ticketNo = guildState.tickets.nextTicketNo++;
  const name = `t-${ticketNo}-${sanitizeChannelName(ticketType)}`;
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: guildState.tickets.categoryId || null,
    permissionOverwrites: overwrites,
    topic: `ticket owner:${opener.id}`
  });

  guildState.ticketChannels[channel.id] = {
    ticketNo,
    ticketType,
    ownerId: opener.id,
    ownerTag: opener.user.tag,
    createdAt: Date.now(),
    sourceChannelId: sourceChannel ? sourceChannel.id : '',
    claimedBy: '',
    status: 'open',
    intake: Array.isArray(intakeAnswers) ? intakeAnswers : []
  };
  saveDb();

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );

  const intro = new EmbedBuilder()
    .setTitle(ticketSchema.label)
    .setDescription('Describe your issue. A staff member will help you soon.')
    .addFields(
      { name: 'Ticket No', value: `#${ticketNo}`, inline: true },
      { name: 'Type', value: ticketSchema.label, inline: true },
      { name: 'Opened by', value: `<@${opener.id}>`, inline: true },
      { name: 'Channel', value: `<#${channel.id}>`, inline: true }
    )
    .setColor(0x2b8cff)
    .setTimestamp(new Date());

  const safeAnswers = Array.isArray(intakeAnswers) ? intakeAnswers : [];
  for (const item of safeAnswers.slice(0, 5)) {
    intro.addFields({
      name: String(item.label || 'Field').slice(0, 256),
      value: String(item.value || '-').slice(0, 1000) || '-',
      inline: false
    });
  }

  await channel.send({ content: `<@${opener.id}>`, embeds: [intro], components: [controls] });
  await sendLog(guild, `🎫 Ticket opened: ${channel.name} by ${opener.user.tag}`);
  return { channel, alreadyExists: false };
}

function buildTicketModal(ticketType) {
  const schema = getTicketSchema(ticketType);
  const fields = schema.fields.slice(0, 5);
  const modal = new ModalBuilder()
    .setCustomId(`ticket_open_modal:${schema.key}`)
    .setTitle(String(schema.label).slice(0, 45));

  const rows = fields.map((field, idx) => {
    const input = new TextInputBuilder()
      .setCustomId(`ticket_field_${idx}`)
      .setLabel(String(field.label || `Field ${idx + 1}`).slice(0, 45))
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required !== false);
    if (field.placeholder) {
      input.setPlaceholder(String(field.placeholder).slice(0, 100));
    }
    return new ActionRowBuilder().addComponents(input);
  });

  modal.addComponents(...rows);
  return modal;
}

function buildTicketTypeSelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_type_pick')
    .setPlaceholder('티켓 종류를 선택하세요')
    .addOptions(
      Object.entries(TICKET_SCHEMAS).map(([key, schema]) => ({
        label: schema.label,
        value: key
      }))
    );
  return new ActionRowBuilder().addComponents(select);
}

async function applyAccessToOpenTickets(guild, subjectId, grant) {
  const guildState = ensureGuild(guild.id);
  const channelIds = Object.keys(guildState.ticketChannels || {});
  const perms = grant
    ? {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }
    : null;
  await Promise.all(channelIds.map(async (channelId) => {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.permissionOverwrites) {
      return;
    }
    if (perms) {
      await channel.permissionOverwrites.edit(subjectId, perms).catch(() => {});
    } else {
      await channel.permissionOverwrites.delete(subjectId).catch(() => {});
    }
  }));
}

function requireDashboardToken(req, res, next) {
  if (!DASHBOARD_TOKEN) {
    return res.status(503).json({ error: 'Dashboard token is not configured' });
  }
  const fromHeader = String(req.headers['x-dashboard-token'] || '').trim();
  const fromQuery = String(req.query.token || '').trim();
  const token = fromHeader || fromQuery;
  if (token !== DASHBOARD_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireDashboardAccess(req, res, next) {
  if (DISCORD_OAUTH_ENABLED) {
    const authUser = getDashboardAuthUser(req);
    if (!authUser || !authUser.id) {
      return res.status(401).json({ error: 'Discord login required' });
    }
    return next();
  }
  return requireDashboardToken(req, res, next);
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  if (!header) {
    return {};
  }
  const out = {};
  for (const chunk of header.split(';')) {
    const idx = chunk.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function cleanupDashboardSessions() {
  const now = Date.now();
  for (const [key, value] of dashboardOauthStates.entries()) {
    if (!value || value.expiresAt <= now) {
      dashboardOauthStates.delete(key);
    }
  }
  for (const [sid, session] of dashboardSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      dashboardSessions.delete(sid);
    }
  }
}

function getDashboardAuthUser(req) {
  cleanupDashboardSessions();
  const cookies = parseCookies(req);
  const sid = String(cookies.dashboard_session || '').trim();
  if (!sid) {
    return null;
  }
  const session = dashboardSessions.get(sid);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    dashboardSessions.delete(sid);
    return null;
  }
  return session.user || null;
}

function setDashboardSessionCookie(res, sid) {
  const maxAge = 1000 * 60 * 60 * 24 * 7;
  const parts = [
    `dashboard_session=${encodeURIComponent(sid)}`,
    'Path=/',
    `Max-Age=${Math.floor(maxAge / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearDashboardSessionCookie(res) {
  res.setHeader('Set-Cookie', 'dashboard_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

function isTechnicalLeadMember(member) {
  if (!member || !member.roles || !member.roles.cache) {
    return false;
  }
  if (TECHNICAL_LEAD_ROLE_ID && member.roles.cache.has(TECHNICAL_LEAD_ROLE_ID)) {
    return true;
  }
  const roleName = String(TECHNICAL_LEAD_ROLE_NAME || '').toLowerCase();
  if (!roleName) {
    return false;
  }
  return member.roles.cache.some((role) => String(role.name || '').toLowerCase() === roleName);
}

async function hasTechnicalLeadInGuild(guild, userId) {
  if (!guild || !userId) {
    return false;
  }
  await guild.roles.fetch().catch(() => null);
  const member = guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) {
    return false;
  }
  return isTechnicalLeadMember(member);
}

async function hasTechnicalLeadInAnyGuild(userId) {
  if (!userId) {
    return false;
  }
  const guilds = Array.from(client.guilds.cache.values());
  for (const guild of guilds) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await hasTechnicalLeadInGuild(guild, userId);
    if (ok) {
      return true;
    }
  }
  return false;
}

async function getTechnicalLeadGuildMatches(userId) {
  if (!userId) {
    return [];
  }
  const out = [];
  const guilds = Array.from(client.guilds.cache.values());
  for (const guild of guilds) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await hasTechnicalLeadInGuild(guild, userId);
    if (ok) {
      out.push({ guildId: guild.id, guildName: guild.name });
    }
  }
  out.sort((a, b) => a.guildName.localeCompare(b.guildName));
  return out;
}

async function requireMasterDashboardToken(req, res, next) {
  if (!DISCORD_OAUTH_ENABLED) {
    return res.status(503).json({ error: 'Discord OAuth is required for Master access' });
  }
  const authUser = getDashboardAuthUser(req);
  if (!authUser || !authUser.id) {
    return res.status(401).json({ error: 'Discord login required' });
  }
  const targetGuildId = String(req.params && req.params.guildId ? req.params.guildId : '').trim();
  const guild = targetGuildId ? client.guilds.cache.get(targetGuildId) : null;
  const allowed = guild
    ? await hasTechnicalLeadInGuild(guild, authUser.id)
    : await hasTechnicalLeadInAnyGuild(authUser.id);
  if (!allowed) {
    return res.status(403).json({ error: 'Master access is allowed only for Technical Lead' });
  }
  return next();
}

function buildTicketStatusLines(guildState) {
  const openCount = Object.values(guildState.ticketChannels).filter((t) => t.status === 'open').length;
  const supportRole = guildState.tickets.supportRoleId ? `<@&${guildState.tickets.supportRoleId}>` : 'Not set';
  const techRole = guildState.tickets.technicianRoleId ? `<@&${guildState.tickets.technicianRoleId}>` : 'Not set';
  const engineerRole = guildState.tickets.engineerRoleId ? `<@&${guildState.tickets.engineerRoleId}>` : 'Not set';
  const managerUsers = (guildState.tickets.managerUserIds || []).map((id) => `<@${id}>`).join(', ') || 'None';
  const managerRoles = (guildState.tickets.managerRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'None';
  const category = guildState.tickets.categoryId ? `<#${guildState.tickets.categoryId}>` : 'Not set';
  const forumChannel = guildState.tickets.forumChannelId ? `<#${guildState.tickets.forumChannelId}>` : 'Not set';
  const logChannel = guildState.tickets.logChannelId ? `<#${guildState.tickets.logChannelId}>` : 'Not set';
  const sheetId = guildState.tickets.sheetId || 'Not set';
  const sheetRange = guildState.tickets.sheetRange || 'Not set';
  return [
    `Ticket system: ${guildState.tickets.enabled ? 'ON' : 'OFF'}`,
    `Open tickets: ${openCount}`,
    `Category: ${category}`,
    `Technician role: ${techRole}`,
    `Engineer role: ${engineerRole}`,
    `Support role: ${supportRole}`,
    `Manager users: ${managerUsers}`,
    `Manager roles: ${managerRoles}`,
    `Forum: ${forumChannel}`,
    `Ticket log: ${logChannel}`,
    `Sheet: ${sheetId} (${sheetRange})`
  ];
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('open')
      .setDescription('Open a work ticket')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Ticket type')
          .setRequired(true)
          .addChoices(
            { name: 'Job Ticket', value: 'job' },
            { name: 'Material Use Ticket', value: 'material_use' },
            { name: 'Defected Material Ticket', value: 'defected_material' },
            { name: 'Asset/Material Request Ticket', value: 'asset_material_request' },
            { name: 'General Ticket', value: 'general' }
          )),
    new SlashCommandBuilder().setName('claim').setDescription('Claim current ticket channel'),
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Close current ticket channel')
      .addStringOption((o) => o.setName('reason').setDescription('Close reason').setRequired(false)),
    new SlashCommandBuilder().setName('ticketstatus').setDescription('Show ticket system status'),
    new SlashCommandBuilder()
      .setName('ticketpanel')
      .setDescription('Post ticket panel (all types or one fixed type)')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Optional: fixed ticket type for this channel panel')
          .setRequired(false)
          .addChoices(
            { name: 'All Types (picker)', value: 'all' },
            { name: 'Job Ticket', value: 'job' },
            { name: 'Material Use Ticket', value: 'material_use' },
            { name: 'Defected Material Ticket', value: 'defected_material' },
            { name: 'Asset/Material Request Ticket', value: 'asset_material_request' },
            { name: 'General Ticket', value: 'general' }
          )),
    new SlashCommandBuilder()
      .setName('manager')
      .setDescription('Manage ticket managers')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(true)
          .addChoices(
            { name: 'list', value: 'list' },
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' }
          ))
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(false))
      .addRoleOption((o) => o.setName('role').setDescription('Target role').setRequired(false))
  ].map((c) => c.toJSON());
}

async function registerSlashCommands(clientInstance) {
  const commands = buildSlashCommands();
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const guildTargetIds = new Set();
  if (SLASH_GUILD_ID) {
    guildTargetIds.add(SLASH_GUILD_ID);
  } else if (REGISTER_ALL_GUILD_SLASH_COMMANDS) {
    for (const guild of clientInstance.guilds.cache.values()) {
      guildTargetIds.add(guild.id);
    }
  }

  for (const guildId of guildTargetIds) {
    await rest.put(Routes.applicationGuildCommands(clientInstance.user.id, guildId), { body: commands });
    console.log(`[slash] registered guild commands to guild=${guildId}`);
  }

  if (!guildTargetIds.size || REGISTER_GLOBAL_SLASH_COMMANDS) {
    await rest.put(Routes.applicationCommands(clientInstance.user.id), { body: commands });
    console.log('[slash] registered global commands');
  } else if (PRUNE_GLOBAL_SLASH_COMMANDS) {
    await rest.put(Routes.applicationCommands(clientInstance.user.id), { body: [] });
    console.log('[slash] pruned stale global commands');
  }
}

function serializeTicket(guild, channelId, ticket) {
  const channel = guild.channels.cache.get(channelId);
  const summary = buildTicketSummary(ticket);
  const claimedMember = ticket && ticket.claimedBy ? guild.members.cache.get(String(ticket.claimedBy)) : null;
  return {
    channelId,
    channelName: channel ? channel.name : ticket.channelName || '(deleted)',
    ticketNo: ticket.ticketNo || null,
    ticketType: ticket.ticketType || 'general',
    ticketTypeLabel: summary.ticketTypeLabel,
    ownerId: ticket.ownerId || '',
    ownerTag: ticket.ownerTag || '',
    status: ticket.status || 'open',
    claimedBy: ticket.claimedBy || '',
    claimedByTag: claimedMember && claimedMember.user ? claimedMember.user.tag : '',
    createdAt: ticket.createdAt || 0,
    closedAt: ticket.closedAt || null,
    closeReason: ticket.closeReason || '',
    intake: Array.isArray(ticket.intake) ? ticket.intake : []
  };
}

function resequenceTickets(guildState, removeTicketNos) {
  const removeSet = new Set((Array.isArray(removeTicketNos) ? removeTicketNos : [])
    .map((x) => Number.parseInt(String(x), 10))
    .filter((x) => Number.isInteger(x) && x > 0));

  if (removeSet.size > 0) {
    for (const [channelId, meta] of Object.entries(guildState.ticketChannels || {})) {
      const ticketNo = Number(meta && meta.ticketNo);
      if (removeSet.has(ticketNo)) {
        delete guildState.ticketChannels[channelId];
      }
    }
    guildState.tickets.history = (guildState.tickets.history || []).filter((meta) => {
      const ticketNo = Number(meta && meta.ticketNo);
      return !removeSet.has(ticketNo);
    });
  }

  const records = [];
  for (const [channelId, meta] of Object.entries(guildState.ticketChannels || {})) {
    records.push({
      refType: 'open',
      channelId,
      meta,
      createdAt: Number(meta && meta.createdAt) || 0
    });
  }
  for (let i = 0; i < (guildState.tickets.history || []).length; i += 1) {
    const meta = guildState.tickets.history[i];
    records.push({
      refType: 'history',
      index: i,
      meta,
      createdAt: Number(meta && meta.createdAt) || Number(meta && meta.closedAt) || 0
    });
  }
  records.sort((a, b) => a.createdAt - b.createdAt);

  let ticketNo = 1;
  for (const record of records) {
    record.meta.ticketNo = ticketNo;
    ticketNo += 1;
  }
  guildState.tickets.nextTicketNo = ticketNo;
}

function startDashboardServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(DASHBOARD_DIR));

  app.get('/api/auth/discord/config', (_req, res) => {
    res.json({
      enabled: DISCORD_OAUTH_ENABLED,
      loginPath: '/auth/discord/start'
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    const user = getDashboardAuthUser(req);
    const technicalLeadGuilds = user && user.id
      ? await getTechnicalLeadGuildMatches(user.id)
      : [];
    const technicalLead = technicalLeadGuilds.length > 0;
    res.json({
      ok: true,
      user,
      technicalLead,
      technicalLeadGuilds
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    const sid = String(cookies.dashboard_session || '').trim();
    if (sid) {
      dashboardSessions.delete(sid);
    }
    clearDashboardSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/auth/discord/start', (req, res) => {
    if (!DISCORD_OAUTH_ENABLED) {
      return res.status(503).send('Discord OAuth is not configured');
    }
    const state = crypto.randomBytes(16).toString('hex');
    const returnTo = String(req.query.returnTo || '/').trim();
    dashboardOauthStates.set(state, {
      returnTo: returnTo.startsWith('/') ? returnTo : '/',
      expiresAt: Date.now() + (1000 * 60 * 10)
    });
    const authUrl = new URL('https://discord.com/oauth2/authorize');
    authUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
    authUrl.searchParams.set('scope', 'identify');
    authUrl.searchParams.set('state', state);
    return res.redirect(authUrl.toString());
  });

  app.get('/auth/discord/callback', async (req, res) => {
    if (!DISCORD_OAUTH_ENABLED) {
      return res.status(503).send('Discord OAuth is not configured');
    }
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    const stateRow = dashboardOauthStates.get(state);
    dashboardOauthStates.delete(state);
    if (!code || !stateRow || stateRow.expiresAt <= Date.now()) {
      return res.status(400).send('Invalid OAuth state or code');
    }
    try {
      const tokenBody = new URLSearchParams();
      tokenBody.set('client_id', DISCORD_CLIENT_ID);
      tokenBody.set('client_secret', DISCORD_CLIENT_SECRET);
      tokenBody.set('grant_type', 'authorization_code');
      tokenBody.set('code', code);
      tokenBody.set('redirect_uri', DISCORD_REDIRECT_URI);
      tokenBody.set('scope', 'identify');

      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString()
      });
      if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        throw new Error(`token exchange failed: ${txt}`);
      }
      const tokenJson = await tokenRes.json();
      const accessToken = String(tokenJson.access_token || '');
      if (!accessToken) {
        throw new Error('missing access_token');
      }
      const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      if (!meRes.ok) {
        const txt = await meRes.text();
        throw new Error(`profile fetch failed: ${txt}`);
      }
      const me = await meRes.json();
      const sid = crypto.randomBytes(24).toString('hex');
      dashboardSessions.set(sid, {
        user: {
          id: String(me.id || ''),
          username: String(me.username || ''),
          globalName: String(me.global_name || ''),
          discriminator: String(me.discriminator || ''),
          avatar: String(me.avatar || '')
        },
        expiresAt: Date.now() + (1000 * 60 * 60 * 24 * 7)
      });
      setDashboardSessionCookie(res, sid);
      return res.redirect(stateRow.returnTo || '/');
    } catch (error) {
      console.error('[dashboard] oauth callback failed', error);
      return res.status(500).send('OAuth callback failed');
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: client.user ? client.user.tag : 'starting' });
  });

  app.get('/api/guilds', requireDashboardAccess, async (_req, res) => {
    const guilds = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ guilds });
  });

  app.get('/api/guilds/:guildId/data', requireDashboardAccess, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const guildState = ensureGuild(guild.id);
    const authUser = getDashboardAuthUser(req);

    const fetchedChannels = await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);
    await guild.members.fetch({ limit: 1000 }).catch(() => null);
    if (guild.members.cache.size < 2 && typeof guild.members.list === 'function') {
      await guild.members.list({ limit: 1000 }).catch(() => null);
    }
    const botMember = await guild.members.fetchMe().catch(() => null);
    const openTickets = Object.entries(guildState.ticketChannels || {})
      .map(([channelId, meta]) => serializeTicket(guild, channelId, meta))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const closedTickets = (guildState.tickets.history || [])
      .map((meta) => serializeTicket(guild, meta.channelId || '', meta))
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));

    const managerUsers = (guildState.tickets.managerUserIds || []).map((id) => {
      const m = guild.members.cache.get(id);
      return { id, label: m ? `${m.user.username} (${id})` : id };
    });
    const managerRoles = (guildState.tickets.managerRoleIds || [])
      .map((id) => {
        const r = guild.roles.cache.get(id);
        return {
          id,
          label: r ? `${r.name} (${id})` : id,
          position: r ? Number(r.position || 0) : -1
        };
      })
      .sort((a, b) => (b.position || 0) - (a.position || 0))
      .map(({ id, label }) => ({ id, label }));

    const sourceChannels = fetchedChannels || guild.channels.cache;
    const candidateChannels = Array.from(sourceChannels.values()).filter((ch) =>
      ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
    );

    const sortByChannelPosition = (a, b) => {
      const pa = Number(a.rawPosition || 0);
      const pb = Number(b.rawPosition || 0);
      if (pa !== pb) {
        return pa - pb;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    };

    let textChannels = candidateChannels
      .filter((ch) => {
        if (!botMember) {
          return true;
        }
        const perms = ch.permissionsFor(botMember);
        return !!(perms &&
          perms.has(PermissionsBitField.Flags.ViewChannel) &&
          perms.has(PermissionsBitField.Flags.SendMessages));
      })
      .sort(sortByChannelPosition)
      .map((ch) => ({ id: ch.id, name: ch.name }))

    // Fallback: expose text channels even when permission calculation is unavailable.
    if (textChannels.length === 0) {
      textChannels = candidateChannels
        .sort(sortByChannelPosition)
        .map((ch) => ({ id: ch.id, name: ch.name }))
    }

    const roleOptions = guild.roles.cache
      .filter((r) => r.id !== guild.roles.everyone.id)
      .map((r) => ({ id: r.id, name: r.name, position: Number(r.position || 0) }))
      .sort((a, b) => (b.position || 0) - (a.position || 0))
      .map(({ id, name }) => ({ id, name }));

    let memberOptions = guild.members.cache
      .filter((m) => !m.user.bot)
      .map((m) => ({ id: m.id, name: `${m.user.username} (${m.id})` }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500);

    if (memberOptions.length === 0) {
      // Fallback set so dashboard still works even when member intent/cache is limited.
      const fallbackIds = new Set([
        ...(guildState.tickets.managerUserIds || []),
        ...Object.values(guildState.ticketChannels || {}).map((t) => String(t.ownerId || '')),
        ...(guildState.tickets.history || []).map((t) => String(t.ownerId || ''))
      ]);
      memberOptions = Array.from(fallbackIds)
        .filter(Boolean)
        .map((id) => ({ id, name: `User ID ${id}` }));
    }

    let authUserPermissions = {
      loggedIn: !!authUser,
      userId: authUser ? authUser.id : '',
      operationsManager: false
    };
    if (authUser && authUser.id) {
      const authMember = guild.members.cache.get(String(authUser.id)) || await guild.members.fetch(String(authUser.id)).catch(() => null);
      authUserPermissions.operationsManager = !!(authMember && isOperationsManagerMember(authMember, guildState));
    }

    let safeRoleOptions = roleOptions;
    if (safeRoleOptions.length === 0) {
      safeRoleOptions = [
        guildState.tickets.supportRoleId,
        guildState.tickets.technicianRoleId,
        guildState.tickets.engineerRoleId,
        ...(guildState.tickets.managerRoleIds || [])
      ]
        .filter(Boolean)
        .map((id) => ({ id, name: `Role ID ${id}` }));
    }

    const operatorUsers = (guildState.dashboard.operatorUserIds || []).map((id) => {
      const m = guild.members.cache.get(id);
      return { id, label: m ? `${m.user.username} (${id})` : id };
    });
    const operatorRoles = (guildState.dashboard.operatorRoleIds || []).map((id) => {
      const r = guild.roles.cache.get(id);
      return { id, label: r ? `${r.name} (${id})` : id };
    });

    const memberRoleRows = guild.members.cache
      .filter((m) => !m.user.bot)
      .map((m) => {
        const highestRole = m.roles && m.roles.highest ? m.roles.highest : null;
        return {
          userId: m.id,
          username: m.user.username,
          displayName: m.displayName || m.user.username,
          highestRoleName: highestRole && highestRole.id !== guild.roles.everyone.id ? highestRole.name : '@everyone',
          highestRolePosition: highestRole ? Number(highestRole.position || 0) : 0,
          roles: Array.from((m.roles && m.roles.cache ? m.roles.cache.values() : []))
            .filter((r) => r.id !== guild.roles.everyone.id)
            .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
            .map((r) => r.name)
        };
      })
      .sort((a, b) => {
        if (a.highestRolePosition !== b.highestRolePosition) {
          return b.highestRolePosition - a.highestRolePosition;
        }
        return a.displayName.localeCompare(b.displayName);
      })
      .slice(0, 1000);

    res.json({
      guild: { id: guild.id, name: guild.name },
      settings: {
        supportRoleId: guildState.tickets.supportRoleId || '',
        technicianRoleId: guildState.tickets.technicianRoleId || '',
        engineerRoleId: guildState.tickets.engineerRoleId || ''
      },
      managerUsers,
      managerRoles,
      operatorUsers,
      operatorRoles,
      openTickets,
      closedTickets,
      textChannels,
      roleOptions: safeRoleOptions,
      memberOptions,
      memberRoleRows,
      channelStats: {
        totalFetched: candidateChannels.length,
        availableTextChannels: textChannels.length
      },
      memberStats: {
        cachedMembers: guild.members.cache.size,
        selectableMembers: memberOptions.length
      },
      roleStats: {
        selectableRoles: safeRoleOptions.length
      },
      permissions: {
        operationsAllowedForDashboardUserIdInput: !DISCORD_OAUTH_ENABLED
      },
      auth: {
        user: authUser,
        permissions: authUserPermissions
      }
    });
  });

  app.get('/api/master/overview', requireMasterDashboardToken, async (_req, res) => {
    const guildRows = [];
    for (const guild of client.guilds.cache.values()) {
      const guildState = ensureGuild(guild.id);
      const openCount = Object.values(guildState.ticketChannels || {}).filter((t) => t.status === 'open').length;
      const closedCount = Array.isArray(guildState.tickets.history) ? guildState.tickets.history.length : 0;
      guildRows.push({
        guildId: guild.id,
        guildName: guild.name,
        ticketEnabled: guildState.tickets.enabled !== false,
        openTickets: openCount,
        closedTickets: closedCount,
        managerUsers: Array.isArray(guildState.tickets.managerUserIds) ? guildState.tickets.managerUserIds.length : 0,
        managerRoles: Array.isArray(guildState.tickets.managerRoleIds) ? guildState.tickets.managerRoleIds.length : 0,
        managerUserIds: Array.isArray(guildState.tickets.managerUserIds) ? guildState.tickets.managerUserIds : [],
        operatorUsers: Array.isArray(guildState.dashboard.operatorUserIds) ? guildState.dashboard.operatorUserIds.length : 0,
        operatorRoles: Array.isArray(guildState.dashboard.operatorRoleIds) ? guildState.dashboard.operatorRoleIds.length : 0
      });
    }
    guildRows.sort((a, b) => a.guildName.localeCompare(b.guildName));
    const totalOpen = guildRows.reduce((acc, row) => acc + row.openTickets, 0);
    const totalClosed = guildRows.reduce((acc, row) => acc + row.closedTickets, 0);
    res.json({
      bot: {
        tag: client.user ? client.user.tag : 'starting',
        guildCount: guildRows.length
      },
      summary: {
        totalOpen,
        totalClosed
      },
      guilds: guildRows
    });
  });

  app.post('/api/master/guilds/:guildId/tickets-enabled', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const enabled = !!req.body.enabled;
    const guildState = ensureGuild(guild.id);
    guildState.tickets.enabled = enabled;
    saveDb();
    res.json({ ok: true, guildId: guild.id, enabled });
  });

  app.post('/api/master/tickets-enabled', requireMasterDashboardToken, async (req, res) => {
    const enabled = !!req.body.enabled;
    const updated = [];
    for (const guild of client.guilds.cache.values()) {
      const guildState = ensureGuild(guild.id);
      guildState.tickets.enabled = enabled;
      updated.push({ guildId: guild.id, guildName: guild.name, enabled });
    }
    saveDb();
    res.json({ ok: true, updatedCount: updated.length, enabled, updated });
  });

  app.post('/api/master/guilds/:guildId/manager-users', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const action = String(req.body.action || '').toLowerCase();
    const userId = String(req.body.userId || '').trim();
    if (!userId || (action !== 'add' && action !== 'remove')) {
      return res.status(400).json({ error: 'Invalid action or userId' });
    }
    const guildState = ensureGuild(guild.id);
    const set = new Set(guildState.tickets.managerUserIds || []);
    if (action === 'add') {
      set.add(userId);
      await applyAccessToOpenTickets(guild, userId, true);
    } else {
      set.delete(userId);
      await applyAccessToOpenTickets(guild, userId, false);
    }
    guildState.tickets.managerUserIds = Array.from(set);
    saveDb();
    res.json({
      ok: true,
      guildId: guild.id,
      managerUserIds: guildState.tickets.managerUserIds
    });
  });

  app.get('/api/master/guilds/:guildId/actors', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const guildState = ensureGuild(guild.id);
    await guild.roles.fetch().catch(() => null);
    await guild.members.fetch({ limit: 1000 }).catch(() => null);

    const roleOptions = guild.roles.cache
      .filter((r) => r.id !== guild.roles.everyone.id)
      .map((r) => ({ id: r.id, name: r.name, position: Number(r.position || 0) }))
      .sort((a, b) => (b.position || 0) - (a.position || 0))
      .map(({ id, name }) => ({ id, name }));

    const memberOptions = guild.members.cache
      .filter((m) => !m.user.bot)
      .map((m) => ({
        id: m.id,
        name: `${m.displayName || m.user.username} | ${m.roles && m.roles.highest ? m.roles.highest.name : '@everyone'} | ${m.id}`,
        highestRolePosition: Number((m.roles && m.roles.highest && m.roles.highest.position) || 0)
      }))
      .sort((a, b) => {
        if ((a.highestRolePosition || 0) !== (b.highestRolePosition || 0)) {
          return (b.highestRolePosition || 0) - (a.highestRolePosition || 0);
        }
        return a.name.localeCompare(b.name);
      })
      .map(({ id, name }) => ({ id, name }))
      .slice(0, 1000);

    const allTickets = [
      ...Object.values(guildState.ticketChannels || {}),
      ...(guildState.tickets.history || [])
    ];
    const typeKeys = ['job', 'material_use', 'defected_material', 'general'];
    const issuerMap = new Map();

    for (const member of guild.members.cache.filter((m) => !m.user.bot).values()) {
      const highestRole = member.roles && member.roles.highest ? member.roles.highest : null;
      issuerMap.set(String(member.id), {
        ownerId: String(member.id),
        ownerName: member.displayName || (member.user && member.user.username) || String(member.id),
        ownerRole: highestRole ? String(highestRole.name || '@everyone') : '@everyone',
        highestRolePosition: highestRole ? Number(highestRole.position || 0) : 0,
        job: 0,
        material_use: 0,
        defected_material: 0,
        general: 0,
        total: 0
      });
    }

    for (const ticket of allTickets) {
      const ownerId = String(ticket && ticket.ownerId ? ticket.ownerId : '').trim();
      if (!ownerId) {
        continue;
      }
      const typeKey = sanitizeTicketType(ticket.ticketType);
      let row = issuerMap.get(ownerId);
      if (!row) {
        const member = guild.members.cache.get(ownerId);
        const highestRole = member && member.roles && member.roles.highest ? member.roles.highest : null;
        const displayName = member
          ? (member.displayName || (member.user && member.user.username) || ownerId)
          : ownerId;
        row = {
          ownerId,
          ownerName: displayName,
          ownerRole: highestRole ? String(highestRole.name || '@everyone') : '@everyone',
          highestRolePosition: highestRole ? Number(highestRole.position || 0) : 0,
          job: 0,
          material_use: 0,
          defected_material: 0,
          general: 0,
          total: 0
        };
        issuerMap.set(ownerId, row);
      }
      if (typeKeys.includes(typeKey)) {
        row[typeKey] += 1;
      } else {
        row.general += 1;
      }
      row.total += 1;
    }
    const issuerStats = Array.from(issuerMap.values())
      .sort((a, b) => {
        if ((b.highestRolePosition || 0) !== (a.highestRolePosition || 0)) {
          return (b.highestRolePosition || 0) - (a.highestRolePosition || 0);
        }
        if ((b.total || 0) !== (a.total || 0)) {
          return (b.total || 0) - (a.total || 0);
        }
        return String(a.ownerName || '').localeCompare(String(b.ownerName || ''));
      });

    return res.json({
      guild: { id: guild.id, name: guild.name },
      memberOptions,
      roleOptions,
      currentOperatorUserIds: guildState.dashboard.operatorUserIds || [],
      currentOperatorRoleIds: guildState.dashboard.operatorRoleIds || [],
      issuerStats
    });
  });

  app.post('/api/master/guilds/:guildId/operators-users', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const action = String(req.body.action || '').toLowerCase();
    const userId = String(req.body.userId || '').trim();
    if (!userId || (action !== 'add' && action !== 'remove')) {
      return res.status(400).json({ error: 'Invalid action or userId' });
    }
    const guildState = ensureGuild(guild.id);
    const set = new Set(guildState.dashboard.operatorUserIds || []);
    if (action === 'add') {
      set.add(userId);
    } else {
      set.delete(userId);
    }
    guildState.dashboard.operatorUserIds = Array.from(set);
    saveDb();
    return res.json({ ok: true, operatorUserIds: guildState.dashboard.operatorUserIds });
  });

  app.post('/api/master/guilds/:guildId/operators-roles', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const action = String(req.body.action || '').toLowerCase();
    const roleId = String(req.body.roleId || '').trim();
    if (!roleId || (action !== 'add' && action !== 'remove')) {
      return res.status(400).json({ error: 'Invalid action or roleId' });
    }
    const guildState = ensureGuild(guild.id);
    const set = new Set(guildState.dashboard.operatorRoleIds || []);
    if (action === 'add') {
      set.add(roleId);
    } else {
      set.delete(roleId);
    }
    guildState.dashboard.operatorRoleIds = Array.from(set);
    saveDb();
    return res.json({ ok: true, operatorRoleIds: guildState.dashboard.operatorRoleIds });
  });

  app.post('/api/guilds/:guildId/manager-users', requireDashboardAccess, async (req, res) => {
    return res.status(403).json({ error: 'Permission management is only available in Master tab' });
  });

  app.post('/api/guilds/:guildId/manager-roles', requireDashboardAccess, async (req, res) => {
    return res.status(403).json({ error: 'Permission management is only available in Master tab' });
  });

  app.post('/api/master/guilds/:guildId/embed', requireMasterDashboardToken, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const channelId = String(req.body.channelId || '').trim();
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const colorRaw = String(req.body.color || '#2b8cff').trim();
    if (!channelId || !title || !description) {
      return res.status(400).json({ error: 'channelId, title, description required' });
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ error: 'Invalid text channel' });
    }
    const color = Number.parseInt(colorRaw.replace('#', ''), 16);
    const embed = new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setDescription(description.slice(0, 4000))
      .setColor(Number.isNaN(color) ? 0x2b8cff : color)
      .setTimestamp(new Date());
    const sent = await channel.send({ embeds: [embed] });
    res.json({ ok: true, messageId: sent.id });
  });

  app.post('/api/guilds/:guildId/embed', requireDashboardAccess, async (_req, res) => {
    return res.status(403).json({ error: 'Embed announcement is only available in Master tab' });
  });

  app.post('/api/guilds/:guildId/tickets/resequence', requireDashboardAccess, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    const guildState = ensureGuild(guild.id);
    const authUser = getDashboardAuthUser(req);
    const requesterUserId = DISCORD_OAUTH_ENABLED
      ? String(authUser && authUser.id ? authUser.id : '')
      : String(req.body.requesterUserId || '').trim();
    if (!requesterUserId) {
      return res.status(400).json({ error: 'requesterUserId required' });
    }
    if (DISCORD_OAUTH_ENABLED && !authUser) {
      return res.status(401).json({ error: 'Discord login required' });
    }
    const requesterMember = await guild.members.fetch(requesterUserId).catch(() => null);
    if (!requesterMember || !isOperationsManagerMember(requesterMember, guildState)) {
      return res.status(403).json({ error: 'Only approved operations managers can resequence tickets' });
    }
    const removeTicketNos = Array.isArray(req.body.removeTicketNos) ? req.body.removeTicketNos : [];
    resequenceTickets(guildState, removeTicketNos);
    saveDb();
    return res.json({
      ok: true,
      nextTicketNo: guildState.tickets.nextTicketNo,
      openCount: Object.keys(guildState.ticketChannels || {}).length,
      closedCount: (guildState.tickets.history || []).length
    });
  });

  const server = app.listen(DASHBOARD_PORT, () => {
    console.log(`[dashboard] http://localhost:${DASHBOARD_PORT}`);
  });
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[dashboard] port ${DASHBOARD_PORT} already in use. keep the existing dashboard process or change DASHBOARD_PORT.`);
      return;
    }
    console.error('[dashboard] server error', error);
  });
}

async function closeTicketChannel(channel, closedBy, reason) {
  const guild = channel.guild;
  const guildState = ensureGuild(guild.id);
  const meta = guildState.ticketChannels[channel.id];
  if (!meta) {
    return false;
  }

  meta.status = 'closed';
  meta.closedAt = Date.now();
  meta.closedBy = closedBy.id;
  meta.closeReason = reason || 'no reason';
  guildState.tickets.history.push({
    ...meta,
    channelId: channel.id,
    channelName: channel.name
  });
  if (guildState.tickets.history.length > 500) {
    guildState.tickets.history = guildState.tickets.history.slice(-500);
  }
  saveDb();

  const logChannelId = guildState.tickets.logChannelId || guildState.logChannelId;
  if (logChannelId) {
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel && logChannel.isTextBased()) {
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      let attachment = null;
      if (messages) {
        const lines = Array.from(messages.values())
          .reverse()
          .map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`)
          .join('\n');
        attachment = new AttachmentBuilder(Buffer.from(lines || '(empty)', 'utf8'), {
          name: `ticket-${channel.id}.txt`
        });
      }
      await logChannel.send({
        content: `🧾 Ticket closed: ${channel.name} | owner: <@${meta.ownerId}> | by: ${closedBy} | reason: ${reason || 'none'}`,
        files: attachment ? [attachment] : []
      }).catch(() => {});
    }
  }

  await sendLog(guild, `🔒 Ticket closed: ${channel.name} by ${closedBy.user.tag}`);
  delete guildState.ticketChannels[channel.id];
  saveDb();
  await channel.delete(`Ticket closed by ${closedBy.user.tag}`).catch(() => {});
  return true;
}

const clientIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildModeration
];
if (ENABLE_MESSAGE_CONTENT_INTENT) {
  clientIntents.push(GatewayIntentBits.MessageContent);
}
if (ENABLE_GUILD_MEMBERS_INTENT) {
  clientIntents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client({
  intents: clientIntents,
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

client.once('ready', () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  if (!ENABLE_MESSAGE_CONTENT_INTENT) {
    console.log('[bot] MessageContent intent disabled: prefix commands and automod text filters are inactive.');
  }
  if (!ENABLE_GUILD_MEMBERS_INTENT) {
    console.log('[bot] GuildMembers intent disabled: member join events are inactive.');
  }
  client.user.setPresence({
    activities: [{ name: STATUS_TEXT, type: ActivityType.Watching }],
    status: 'online'
  });
  registerSlashCommands(client).catch((error) => {
    console.error('[slash] failed to register commands', error);
  });
});

client.on('guildMemberAdd', async (member) => {
  const guildState = ensureGuild(member.guild.id);
  if (!guildState.welcomeChannelId) {
    return;
  }

  const channel = member.guild.channels.cache.get(guildState.welcomeChannelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  channel.send(`Welcome ${member} to **${member.guild.name}**!`).catch(() => {});
  sendLog(member.guild, `✅ Joined: ${member.user.tag}`);
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) {
    return;
  }

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    const guild = reaction.message.guild;
    if (!guild) {
      return;
    }

    const guildState = ensureGuild(guild.id);
    const emoji = reaction.emoji.id || reaction.emoji.name;
    const match = guildState.reactionRoles.find(
      (r) => r.messageId === reaction.message.id && r.emoji === emoji
    );
    if (!match) {
      return;
    }

    const member = await guild.members.fetch(user.id);
    await member.roles.add(match.roleId).catch(() => {});
  } catch (_error) {}
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) {
    return;
  }

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    const guild = reaction.message.guild;
    if (!guild) {
      return;
    }

    const guildState = ensureGuild(guild.id);
    const emoji = reaction.emoji.id || reaction.emoji.name;
    const match = guildState.reactionRoles.find(
      (r) => r.messageId === reaction.message.id && r.emoji === emoji
    );
    if (!match) {
      return;
    }

    const member = await guild.members.fetch(user.id);
    await member.roles.remove(match.roleId).catch(() => {});
  } catch (_error) {}
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) {
    return;
  }

  const guildState = ensureGuild(interaction.guild.id);
  const channel = interaction.channel;
  let member = interaction.member || null;
  if (!member || !member.permissions) {
    member = await interaction.guild.members.fetch(interaction.user.id).catch(() => member);
  }

  if (!member || !channel) {
    return;
  }

  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;

    if (name === 'open') {
      const ticketType = sanitizeTicketType(interaction.options.getString('type', true));
      if (!canOpenTicket(member, guildState, ticketType)) {
        await interaction.reply({ content: 'No permission to open this ticket type.', ephemeral: true }).catch(() => {});
        return;
      }
      try {
        const modal = buildTicketModal(ticketType);
        await interaction.showModal(modal);
      } catch (error) {
        await interaction.reply({ content: `Failed to open modal: ${error.message}`, ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (name === 'ticketstatus') {
      await interaction.reply({ content: buildTicketStatusLines(guildState).join('\n'), ephemeral: true }).catch(() => {});
      return;
    }

    if (name === 'ticketpanel') {
      if (!isTechnicalLeadMember(member)) {
        await interaction.reply({ content: 'Only Technical Lead can use /ticketpanel.', ephemeral: true }).catch(() => {});
        return;
      }
      const selectedType = String(interaction.options.getString('type') || 'all');
      const fixedType = selectedType === 'all' ? '' : sanitizeTicketType(selectedType);
      const panelSchema = fixedType ? getTicketSchema(fixedType) : null;
      const openRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(fixedType ? `ticket_open_direct:${fixedType}` : 'ticket_open')
          .setLabel(fixedType ? `Open ${panelSchema.label}` : 'Create Ticket')
          .setStyle(ButtonStyle.Success)
      );
      const panel = new EmbedBuilder()
        .setTitle(fixedType ? panelSchema.label : 'Ticket Center')
        .setDescription(fixedType
          ? `Press the button below to open a ${panelSchema.label} form.`
          : 'Press Create Ticket, select a ticket type, then submit the modal form.')
        .setColor(0x2b8cff)
        .setTimestamp(new Date());
      const sent = await interaction.channel.send({ embeds: [panel], components: [openRow] });
      guildState.tickets.panelMessageId = sent.id;
      saveDb();
      await interaction.reply({ content: 'Ticket panel posted.', ephemeral: true }).catch(() => {});
      return;
    }

    if (name === 'manager') {
      if (!canModerate(member)) {
        await interaction.reply({ content: 'No permission.', ephemeral: true }).catch(() => {});
        return;
      }
      const action = String(interaction.options.getString('action', true));
      if (action === 'list') {
        const users = (guildState.tickets.managerUserIds || []).map((id) => `<@${id}>`).join(', ') || 'None';
        const roles = (guildState.tickets.managerRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'None';
        await interaction.reply({ content: `Manager users: ${users}\nManager roles: ${roles}`, ephemeral: true }).catch(() => {});
        return;
      }

      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (!user && !role) {
        await interaction.reply({ content: 'Need target user or role.', ephemeral: true }).catch(() => {});
        return;
      }

      if (user) {
        const set = new Set(guildState.tickets.managerUserIds || []);
        if (action === 'add') {
          set.add(String(user.id));
        } else {
          set.delete(String(user.id));
        }
        guildState.tickets.managerUserIds = Array.from(set);
        await applyAccessToOpenTickets(interaction.guild, user.id, action === 'add');
      }
      if (role) {
        const set = new Set(guildState.tickets.managerRoleIds || []);
        if (action === 'add') {
          set.add(String(role.id));
        } else {
          set.delete(String(role.id));
        }
        guildState.tickets.managerRoleIds = Array.from(set);
        await applyAccessToOpenTickets(interaction.guild, role.id, action === 'add');
      }
      saveDb();
      await interaction.reply({ content: `Manager updated (${action}).`, ephemeral: true }).catch(() => {});
      return;
    }

    const meta = guildState.ticketChannels[channel.id];
    if (!meta) {
      await interaction.reply({ content: 'Use this command inside a ticket channel.', ephemeral: true }).catch(() => {});
      return;
    }

    if (name === 'claim') {
      if (!canProcessTicket(member, guildState)) {
        await interaction.reply({ content: 'Only support/admin can claim tickets.', ephemeral: true }).catch(() => {});
        return;
      }
      meta.claimedBy = interaction.user.id;
      meta.claimedAt = Date.now();
      saveDb();
      await interaction.reply({ content: `Ticket claimed by ${interaction.user}` }).catch(() => {});
      return;
    }

    if (name === 'close') {
      if (!canAccessTicket(member, guildState, meta)) {
        await interaction.reply({ content: 'No permission.', ephemeral: true }).catch(() => {});
        return;
      }
      const reason = String(interaction.options.getString('reason') || 'Closed via slash command');
      await interaction.reply({ content: 'Closing ticket...', ephemeral: true }).catch(() => {});
      await closeTicketChannel(channel, interaction.user, reason).catch(() => {});
      return;
    }
  }

  if (interaction.isButton() && interaction.customId === 'ticket_open') {
    await interaction.reply({
      content: '티켓 종류를 선택하세요.',
      components: [buildTicketTypeSelect()],
      ephemeral: true
    }).catch(() => {});
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_open_direct:')) {
    const ticketType = sanitizeTicketType(interaction.customId.split(':')[1]);
    if (!canOpenTicket(member, guildState, ticketType)) {
      await interaction.reply({ content: 'No permission to open this ticket type.', ephemeral: true }).catch(() => {});
      return;
    }
    const modal = buildTicketModal(ticketType);
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_pick') {
    const picked = sanitizeTicketType(interaction.values && interaction.values[0]);
    if (!canOpenTicket(member, guildState, picked)) {
      await interaction.reply({ content: 'Only technician role can open tickets.', ephemeral: true }).catch(() => {});
      return;
    }
    const modal = buildTicketModal(picked);
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_open_modal:')) {
    const ticketType = sanitizeTicketType(interaction.customId.split(':')[1]);
    if (!canOpenTicket(member, guildState, ticketType)) {
      await interaction.reply({ content: 'Only technician role can open tickets.', ephemeral: true }).catch(() => {});
      return;
    }
    try {
      const fields = getTicketSchema(ticketType).fields.slice(0, 5);
      const answers = fields.map((field, idx) => ({
        label: field.label || `Field ${idx + 1}`,
        value: interaction.fields.getTextInputValue(`ticket_field_${idx}`) || ''
      }));
      const result = await createTicketChannel(interaction.guild, member, channel, answers, ticketType);
      const text = result.alreadyExists
        ? `You already have an open ticket: ${result.channel}`
        : `Ticket created: ${result.channel}`;
      await interaction.reply({ content: text, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Failed to open ticket: ${error.message}`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (!interaction.isButton()) {
    return;
  }

  const meta = guildState.ticketChannels[channel.id];
  if (!meta) {
    await interaction.reply({ content: 'This is not an active ticket channel.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId === 'ticket_claim') {
    if (!canProcessTicket(member, guildState)) {
      await interaction.reply({ content: 'Only support/admin can claim tickets.', ephemeral: true });
      return;
    }

    meta.claimedBy = member.id;
    meta.claimedAt = Date.now();
    saveDb();
    await interaction.reply(`Ticket claimed by ${interaction.user}`).catch(() => {});
    await sendLog(interaction.guild, `🎯 Ticket claimed: ${channel.name} by ${interaction.user.tag}`);
    return;
  }

  if (interaction.customId === 'ticket_add_job') {
    await interaction.reply({ content: 'This feature is disabled. Handle sheet updates manually.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId === 'ticket_worklog') {
    await interaction.reply({ content: 'This feature is disabled. Handle worklogs manually.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId === 'ticket_close') {
    if (!canAccessTicket(member, guildState, meta)) {
      await interaction.reply({ content: 'No permission to close this ticket.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Closing ticket...', ephemeral: true }).catch(() => {});
    await closeTicketChannel(channel, interaction.user, 'Closed via button').catch(() => {});
  }
});

client.on('channelDelete', (channel) => {
  if (!channel || !channel.guild) {
    return;
  }
  const guildState = ensureGuild(channel.guild.id);
  if (guildState.ticketChannels[channel.id]) {
    delete guildState.ticketChannels[channel.id];
    saveDb();
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) {
    return;
  }
  if (!ENABLE_MESSAGE_CONTENT_INTENT) {
    return;
  }

  const guildState = ensureGuild(message.guild.id);
  const member = message.member;

  const contentLower = message.content.toLowerCase();
  if (!canModerate(member)) {
    if (guildState.automod.inviteBlock && /(discord\.gg|discord\.com\/invite)\//i.test(message.content)) {
      await message.delete().catch(() => {});
      await message.channel.send(`${message.author}, invite links are blocked.`).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
      sendLog(message.guild, `🛡️ Invite blocked from ${message.author.tag}`);
      return;
    }

    if (guildState.automod.capsBlock && message.content.length >= 12) {
      const letters = message.content.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 8) {
        const upperCount = letters.split('').filter((ch) => ch === ch.toUpperCase()).length;
        if (upperCount / letters.length >= 0.75) {
          await message.delete().catch(() => {});
          await message.channel.send(`${message.author}, please avoid excessive caps.`).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
          sendLog(message.guild, `🛡️ Caps blocked from ${message.author.tag}`);
          return;
        }
      }
    }

    if (guildState.automod.bannedWords.length > 0) {
      const found = guildState.automod.bannedWords.find((word) => word && contentLower.includes(word));
      if (found) {
        await message.delete().catch(() => {});
        await message.channel.send(`${message.author}, blocked word detected.`).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
        sendLog(message.guild, `🛡️ Banned word blocked from ${message.author.tag}`);
        return;
      }
    }
  }

  if (guildState.levelingEnabled) {
    const cooldownKey = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = xpCooldown.get(cooldownKey) || 0;

    if (now - last >= 60 * 1000) {
      xpCooldown.set(cooldownKey, now);
      const userState = ensureUser(guildState, message.author.id);
      const before = toLevel(userState.xp);
      userState.xp += 8 + Math.floor(Math.random() * 8);
      const after = toLevel(userState.xp);
      if (after > before) {
        message.channel.send(`🎉 ${message.author} reached level **${after}**!`).catch(() => {});
      }
      saveDb();
    }
  }

  const prefix = guildState.prefix || DEFAULT_PREFIX;
  if (!message.content.startsWith(prefix)) {
    return;
  }

  const [command, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = (command || '').toLowerCase();

  if (!cmd) {
    return;
  }

  if (guildState.customCommands[cmd]) {
    await message.reply(String(guildState.customCommands[cmd]).slice(0, 1800));
    return;
  }

  if (cmd === 'ping') {
    const sent = await message.reply('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit(`Pong! ${latency}ms`);
    return;
  }

  if (cmd === 'status') {
    const guilds = client.guilds.cache.size;
    const uptimeSec = Math.floor(process.uptime());
    await message.reply(`Uptime: ${uptimeSec}s | Guilds: ${guilds}`);
    return;
  }

  if (cmd === 'rank') {
    const target = parseMentionedUser(message) || message.author;
    const userState = ensureUser(guildState, target.id);
    const level = toLevel(userState.xp);
    await message.reply(`${target.username} | Level: ${level} | XP: ${userState.xp}`);
    return;
  }

  if (cmd === 'leaderboard') {
    const top = Object.entries(guildState.users)
      .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
      .slice(0, 10);

    if (top.length === 0) {
      await message.reply('No XP data yet.');
      return;
    }

    const lines = await Promise.all(
      top.map(async ([userId, stat], idx) => {
        const user = await client.users.fetch(userId).catch(() => null);
        const name = user ? user.username : userId;
        return `${idx + 1}. ${name} - XP ${stat.xp} (Lv ${toLevel(stat.xp)})`;
      })
    );

    await message.reply(['🏆 Leaderboard', ...lines].join('\n'));
    return;
  }

  if (cmd === 'help') {
    await message.reply([
      `Commands (${prefix})`,
      `Basic: ping, status, rank, leaderboard`,
      `Moderation: warn, warnings, clearwarnings, mute, unmute, cleanup, slowmode`,
      `Config: setprefix, setlog, setwelcome, automod, custom, autorole`,
      `Tickets(legacy prefix): ticket panel, ticket claim, ticket close, ticket manager`,
      `Tickets(recommended slash): /open, /claim, /close, /ticketstatus, /ticketpanel, /manager`,
      `Utility: announce, say`,
      `Examples: ${prefix}automod word add spamword, ${prefix}autorole add <msgId> 😀 <roleId>`
    ].join('\n'));
    return;
  }

  if (cmd === 'say' || cmd === 'announce') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    if (cmd === 'announce') {
      const channelMention = message.mentions.channels.first();
      const content = args.slice(channelMention ? 1 : 0).join(' ').trim();
      if (!channelMention || !content) {
        await message.reply(`Usage: ${prefix}announce #channel <text>`);
        return;
      }
      await channelMention.send(content.slice(0, 1800));
      return;
    }

    const content = args.join(' ').trim();
    if (!content) {
      await message.reply(`Usage: ${prefix}say <text>`);
      return;
    }

    await message.channel.send(content.slice(0, 1800));
    return;
  }

  if (cmd === 'cleanup') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const count = Math.max(1, Math.min(100, Number(args[0] || 10)));
    await message.channel.bulkDelete(count, true).catch(() => {});
    const notice = await message.channel.send(`Deleted up to ${count} messages`);
    setTimeout(() => notice.delete().catch(() => {}), 3000);
    return;
  }

  if (cmd === 'slowmode') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const seconds = Math.max(0, Math.min(21600, Number(args[0] || 0)));
    await message.channel.setRateLimitPerUser(seconds).catch(() => {});
    await message.reply(`Slowmode set to ${seconds}s`);
    return;
  }

  if (cmd === 'warn') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const target = parseMentionedUser(message);
    if (!target) {
      await message.reply(`Usage: ${prefix}warn @user <reason>`);
      return;
    }

    const reason = args.slice(1).join(' ').trim() || 'No reason';
    const targetState = ensureUser(guildState, target.id);
    targetState.warnings.push({ by: message.author.id, reason, at: Date.now() });
    saveDb();

    await message.reply(`Warned ${target.username}. Total warnings: ${targetState.warnings.length}`);
    sendLog(message.guild, `⚠️ ${target.tag} warned by ${message.author.tag}: ${reason}`);
    return;
  }

  if (cmd === 'warnings') {
    const target = parseMentionedUser(message) || message.author;
    const targetState = ensureUser(guildState, target.id);
    if (targetState.warnings.length === 0) {
      await message.reply(`${target.username} has no warnings.`);
      return;
    }

    const lines = targetState.warnings.slice(-10).map((w, idx) => `${idx + 1}. ${w.reason}`);
    await message.reply([`${target.username} warnings (${targetState.warnings.length})`, ...lines].join('\n'));
    return;
  }

  if (cmd === 'clearwarnings') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const target = parseMentionedUser(message);
    if (!target) {
      await message.reply(`Usage: ${prefix}clearwarnings @user`);
      return;
    }

    const targetState = ensureUser(guildState, target.id);
    targetState.warnings = [];
    saveDb();
    await message.reply(`Cleared warnings for ${target.username}`);
    return;
  }

  if (cmd === 'mute') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(`Usage: ${prefix}mute @user <minutes> <reason>`);
      return;
    }

    const minutes = Math.max(1, Math.min(10080, Number(args[1] || 10)));
    const reason = args.slice(2).join(' ').trim() || 'No reason';
    await target.timeout(minutes * 60 * 1000, reason).catch(() => {});
    await message.reply(`Muted ${target.user.username} for ${minutes} minute(s)`);
    sendLog(message.guild, `🔇 ${target.user.tag} muted by ${message.author.tag} (${minutes}m): ${reason}`);
    return;
  }

  if (cmd === 'unmute') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(`Usage: ${prefix}unmute @user`);
      return;
    }

    await target.timeout(null).catch(() => {});
    await message.reply(`Unmuted ${target.user.username}`);
    return;
  }

  if (cmd === 'setprefix') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }
    const next = (args[0] || '').trim();
    if (!next || next.length > 3) {
      await message.reply(`Usage: ${prefix}setprefix <1-3 chars>`);
      return;
    }
    guildState.prefix = next;
    saveDb();
    await message.reply(`Prefix set to ${next}`);
    return;
  }

  if (cmd === 'setlog' || cmd === 'setwelcome') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }
    const channel = message.mentions.channels.first();
    if (!channel) {
      await message.reply(`Usage: ${prefix}${cmd} #channel`);
      return;
    }

    if (cmd === 'setlog') {
      guildState.logChannelId = channel.id;
    } else {
      guildState.welcomeChannelId = channel.id;
    }

    saveDb();
    await message.reply(`${cmd} set to ${channel}`);
    return;
  }

  if (cmd === 'automod') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const sub = (args[0] || '').toLowerCase();
    const key = (args[1] || '').toLowerCase();
    const val = (args[2] || '').toLowerCase();

    if (sub === 'invite') {
      guildState.automod.inviteBlock = key === 'on';
      saveDb();
      await message.reply(`Automod invite block: ${guildState.automod.inviteBlock ? 'ON' : 'OFF'}`);
      return;
    }

    if (sub === 'caps') {
      guildState.automod.capsBlock = key === 'on';
      saveDb();
      await message.reply(`Automod caps block: ${guildState.automod.capsBlock ? 'ON' : 'OFF'}`);
      return;
    }

    if (sub === 'word') {
      const action = key;
      const word = (args[2] || '').trim().toLowerCase();
      if (!word) {
        await message.reply(`Usage: ${prefix}automod word add|remove <word>`);
        return;
      }

      if (action === 'add') {
        if (!guildState.automod.bannedWords.includes(word)) {
          guildState.automod.bannedWords.push(word);
        }
      } else if (action === 'remove') {
        guildState.automod.bannedWords = guildState.automod.bannedWords.filter((w) => w !== word);
      } else {
        await message.reply(`Usage: ${prefix}automod word add|remove <word>`);
        return;
      }

      saveDb();
      await message.reply(`Automod word list updated (${guildState.automod.bannedWords.length})`);
      return;
    }

    await message.reply([
      `Automod usage:`,
      `${prefix}automod invite on|off`,
      `${prefix}automod caps on|off`,
      `${prefix}automod word add|remove <word>`
    ].join('\n'));
    return;
  }

  if (cmd === 'custom') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const action = (args[0] || '').toLowerCase();
    const name = (args[1] || '').toLowerCase();

    if (action === 'list') {
      const names = Object.keys(guildState.customCommands);
      await message.reply(names.length > 0 ? names.join(', ') : 'No custom commands');
      return;
    }

    if (!name) {
      await message.reply(`Usage: ${prefix}custom add|remove <name> [response]`);
      return;
    }

    if (action === 'add') {
      const response = args.slice(2).join(' ').trim();
      if (!response) {
        await message.reply(`Usage: ${prefix}custom add <name> <response>`);
        return;
      }
      guildState.customCommands[name] = response.slice(0, 1800);
      saveDb();
      await message.reply(`Custom command added: ${name}`);
      return;
    }

    if (action === 'remove') {
      delete guildState.customCommands[name];
      saveDb();
      await message.reply(`Custom command removed: ${name}`);
      return;
    }

    await message.reply(`Usage: ${prefix}custom add|remove|list`);
    return;
  }

  if (cmd === 'autorole') {
    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    const action = (args[0] || '').toLowerCase();

    if (action === 'add') {
      const messageId = args[1];
      const emoji = args[2];
      const role = parseRoleFromArg(message, args[3]);
      if (!messageId || !emoji || !role) {
        await message.reply(`Usage: ${prefix}autorole add <messageId> <emoji> <roleId|@role>`);
        return;
      }

      guildState.reactionRoles.push({ messageId, emoji, roleId: role.id });
      saveDb();
      await message.reply(`Reaction role added: ${emoji} -> ${role.name}`);
      return;
    }

    if (action === 'remove') {
      const messageId = args[1];
      const emoji = args[2];
      const before = guildState.reactionRoles.length;
      guildState.reactionRoles = guildState.reactionRoles.filter(
        (r) => !(r.messageId === messageId && r.emoji === emoji)
      );
      saveDb();
      await message.reply(`Removed ${before - guildState.reactionRoles.length} reaction role mapping(s)`);
      return;
    }

    await message.reply([
      `Autorole usage:`,
      `${prefix}autorole add <messageId> <emoji> <roleId|@role>`,
      `${prefix}autorole remove <messageId> <emoji>`
    ].join('\n'));
    return;
  }

  if (cmd === 'ticket') {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'open') {
      await message.reply('Use slash command: `/open`');
      return;
    }

    if (sub === 'close') {
      const meta = guildState.ticketChannels[message.channel.id];
      if (!meta) {
        await message.reply('Use this command inside a ticket channel.');
        return;
      }
      if (!canAccessTicket(member, guildState, meta)) {
        await message.reply('No permission');
        return;
      }
      const reason = args.slice(1).join(' ').trim() || 'Closed via command';
      await message.reply('Closing ticket...');
      await closeTicketChannel(message.channel, message.author, reason).catch(() => {});
      return;
    }

    if (sub === 'claim') {
      const meta = guildState.ticketChannels[message.channel.id];
      if (!meta) {
        await message.reply('Use this command inside a ticket channel.');
        return;
      }
      if (!canProcessTicket(member, guildState)) {
        await message.reply('Only support/admin can claim tickets.');
        return;
      }
      meta.claimedBy = message.author.id;
      meta.claimedAt = Date.now();
      saveDb();
      await message.reply(`Ticket claimed by ${message.author}`);
      return;
    }

    if (sub === 'pushjob') {
      await message.reply('Disabled. Handle Google Sheet updates manually.');
      return;
    }

    if (sub === 'worklog') {
      await message.reply('Disabled. Handle worklogs manually.');
      return;
    }

    if (sub === 'status') {
      await message.reply(buildTicketStatusLines(guildState).join('\n'));
      return;
    }

    if (!canModerate(member)) {
      await message.reply('No permission');
      return;
    }

    if (sub === 'enable') {
      const state = (args[1] || '').toLowerCase();
      guildState.tickets.enabled = state === 'on';
      saveDb();
      await message.reply(`Ticket system: ${guildState.tickets.enabled ? 'ON' : 'OFF'}`);
      return;
    }

    if (sub === 'category') {
      if ((args[1] || '').toLowerCase() === 'off') {
        guildState.tickets.categoryId = '';
        saveDb();
        await message.reply('Ticket category unset');
        return;
      }
      const cat = message.mentions.channels.first() || message.guild.channels.cache.get(args[1] || '');
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        await message.reply(`Usage: ${prefix}ticket category <categoryId|#category|off>`);
        return;
      }
      guildState.tickets.categoryId = cat.id;
      saveDb();
      await message.reply(`Ticket category set: ${cat.name}`);
      return;
    }

    if (sub === 'support') {
      if ((args[1] || '').toLowerCase() === 'off') {
        guildState.tickets.supportRoleId = '';
        saveDb();
        await message.reply('Support role unset');
        return;
      }
      const role = parseRoleFromArg(message, args[1]);
      if (!role) {
        await message.reply(`Usage: ${prefix}ticket support <roleId|@role|off>`);
        return;
      }
      guildState.tickets.supportRoleId = role.id;
      saveDb();
      await message.reply(`Support role set: ${role.name}`);
      return;
    }

    if (sub === 'technician' || sub === 'engineer') {
      if ((args[1] || '').toLowerCase() === 'off') {
        if (sub === 'technician') {
          guildState.tickets.technicianRoleId = '';
        } else {
          guildState.tickets.engineerRoleId = '';
        }
        saveDb();
        await message.reply(`${sub} role unset`);
        return;
      }
      const role = parseRoleFromArg(message, args[1]);
      if (!role) {
        await message.reply(`Usage: ${prefix}ticket ${sub} <roleId|@role|off>`);
        return;
      }
      if (sub === 'technician') {
        guildState.tickets.technicianRoleId = role.id;
      } else {
        guildState.tickets.engineerRoleId = role.id;
      }
      saveDb();
      await message.reply(`${sub} role set: ${role.name}`);
      return;
    }

    if (sub === 'forum') {
      if ((args[1] || '').toLowerCase() === 'off') {
        guildState.tickets.forumChannelId = '';
        saveDb();
        await message.reply('Ticket forum unset');
        return;
      }
      const ch = message.mentions.channels.first() || message.guild.channels.cache.get(args[1] || '');
      if (!ch || ch.type !== ChannelType.GuildForum) {
        await message.reply(`Usage: ${prefix}ticket forum <forumChannelId|#forum|off>`);
        return;
      }
      guildState.tickets.forumChannelId = ch.id;
      saveDb();
      await message.reply(`Ticket forum set: ${ch}`);
      return;
    }

    if (sub === 'sheet') {
      const action = (args[1] || '').toLowerCase();
      if (action === 'off') {
        guildState.tickets.sheetId = '';
        saveDb();
        await message.reply('Ticket sheet unset');
        return;
      }
      const sheetId = (args[1] || '').trim();
      const sheetRange = (args[2] || '').trim();
      if (!sheetId) {
        await message.reply(`Usage: ${prefix}ticket sheet <spreadsheetId|off> [range]`);
        return;
      }
      guildState.tickets.sheetId = sheetId;
      if (sheetRange) {
        guildState.tickets.sheetRange = sheetRange;
      }
      saveDb();
      await message.reply(`Ticket sheet set: ${guildState.tickets.sheetId} (${guildState.tickets.sheetRange})`);
      return;
    }

    if (sub === 'log') {
      if ((args[1] || '').toLowerCase() === 'off') {
        guildState.tickets.logChannelId = '';
        saveDb();
        await message.reply('Ticket log channel unset');
        return;
      }
      const ch = message.mentions.channels.first();
      if (!ch || !ch.isTextBased()) {
        await message.reply(`Usage: ${prefix}ticket log <#channel|off>`);
        return;
      }
      guildState.tickets.logChannelId = ch.id;
      saveDb();
      await message.reply(`Ticket log channel set: ${ch}`);
      return;
    }

    if (sub === 'panel') {
      const openRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_open').setLabel('Create Ticket').setStyle(ButtonStyle.Success)
      );
      const panel = new EmbedBuilder()
        .setTitle('Ticket Center')
        .setDescription('Create Ticket 버튼을 누른 뒤 티켓 종류를 선택해서 입력하세요.')
        .setColor(0x2b8cff)
        .setTimestamp(new Date());

      const sent = await message.channel.send({ embeds: [panel], components: [openRow] });
      guildState.tickets.panelMessageId = sent.id;
      saveDb();
      await message.reply('Ticket panel posted.');
      return;
    }

    if (sub === 'manager') {
      const action = (args[1] || '').toLowerCase();
      if (action === 'list') {
        const users = (guildState.tickets.managerUserIds || []).map((id) => `<@${id}>`).join(', ') || 'None';
        const roles = (guildState.tickets.managerRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'None';
        await message.reply(`Manager users: ${users}\nManager roles: ${roles}`);
        return;
      }
      if (action === 'add' || action === 'remove') {
        const user = message.mentions.users.first();
        const role = parseRoleFromArg(message, args[2]);
        if (!user && !role) {
          await message.reply(`Usage: ${prefix}ticket manager add|remove <@user|@role>`);
          return;
        }
        if (user) {
          const set = new Set(guildState.tickets.managerUserIds || []);
          if (action === 'add') {
            set.add(String(user.id));
          } else {
            set.delete(String(user.id));
          }
          guildState.tickets.managerUserIds = Array.from(set);
          await applyAccessToOpenTickets(message.guild, user.id, action === 'add');
        }
        if (role) {
          const set = new Set(guildState.tickets.managerRoleIds || []);
          if (action === 'add') {
            set.add(String(role.id));
          } else {
            set.delete(String(role.id));
          }
          guildState.tickets.managerRoleIds = Array.from(set);
          await applyAccessToOpenTickets(message.guild, role.id, action === 'add');
        }
        saveDb();
        await message.reply(`Manager updated (${action}).`);
        return;
      }
      await message.reply([
        `Ticket manager usage:`,
        `${prefix}ticket manager list`,
        `${prefix}ticket manager add <@user|@role>`,
        `${prefix}ticket manager remove <@user|@role>`
      ].join('\n'));
      return;
    }

    await message.reply([
      `Ticket usage:`,
      `Use slash: /open`,
      `${prefix}ticket close [reason]`,
      `${prefix}ticket claim`,
      `${prefix}ticket status`,
      `${prefix}ticket panel`,
      `${prefix}ticket enable on|off`,
      `${prefix}ticket category <categoryId|#category|off>`,
      `${prefix}ticket technician <roleId|@role|off>`,
      `${prefix}ticket engineer <roleId|@role|off>`,
      `${prefix}ticket support <roleId|@role|off>`,
      `${prefix}ticket forum <forumChannelId|#forum|off>`,
      `${prefix}ticket log <#channel|off>`,
      `${prefix}ticket sheet <spreadsheetId|off> [range]`,
      `${prefix}ticket manager list|add|remove`
    ].join('\n'));
    return;
  }
});

client.on('error', (error) => {
  console.error('[bot] client error', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[bot] unhandled rejection', error);
  if (error && String(error.message || '').includes('Used disallowed intents')) {
    console.error('[bot] Hint: enable privileged intents in Discord Developer Portal or keep ENABLE_*_INTENT flags as false in .env');
  }
});

process.on('uncaughtException', (error) => {
  console.error('[bot] uncaught exception', error);
});

if (!DASHBOARD_TOKEN) {
  console.warn('[dashboard] DASHBOARD_TOKEN is empty. API will reject requests until set.');
}
if (!DISCORD_OAUTH_ENABLED) {
  console.warn('[dashboard] Discord OAuth is disabled. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI.');
}
if (!TECHNICAL_LEAD_ROLE_ID && !TECHNICAL_LEAD_ROLE_NAME) {
  console.warn('[dashboard] TECHNICAL_LEAD_ROLE_ID/TECHNICAL_LEAD_ROLE_NAME is empty. Master access will be blocked.');
}
startDashboardServer();

client.login(TOKEN);
