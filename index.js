import { createTickets, ticketCommand } from './tickets.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { resolveLive } from './detector.js';
import { createRolePanels, rolePanelCommand } from './rolepanels.js';
import { createVoiceGuard, voiceGuardCommand } from './voiceguard.js';

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) throw new Error('RailwayにDISCORD_TOKENとGUILD_IDを設定してください');
const dir = process.env.DATA_DIR || './data';
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'settings.json');
let state = { user: '', channel: '', role: '', message: '{user} がTikTok LIVEを開始しました！\n{url}', enabled: true, rooms: [], manual: 0 };
if (fs.existsSync(file)) state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
function save() { fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
save();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const health = { checked: 'なし', result: '未確認', error: '', sent: 'なし', details: {}, action: 'なし' };
const configuredInterval = Number(process.env.POLL_SECONDS || 10);
const intervalMs = (Number.isFinite(configuredInterval) ? Math.max(10, configuredInterval) : 10) * 1000;
let queue = Promise.resolve();
function serial(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
function safeError(e) {
  let s = String(e?.message || e);
  for (const key of [DISCORD_TOKEN, process.env.SIGN_API_KEY]) if (key) s = s.split(key).join('[REDACTED]');
  return s.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 400);
}
function username(input) {
  const s = input.trim().replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@/i, '').split(/[/?#]/)[0].replace(/^@/, '');
  if (!/^[a-zA-Z0-9_.]{2,24}$/.test(s)) throw new Error('TikTokの@ユーザー名を入力してください。');
  return s;
}
function payload(test = false) {
  const url = 'https://www.tiktok.com/@' + state.user + '/live';
  const body = state.message.replace(/\{user\}/g, '@' + state.user).replace(/\{url\}/g, url).replace(/\\n/g, '\n');
  return { content: (test ? '【テスト・メンションなし】\n' : state.role ? '<@&' + state.role + '>\n' : '') + body,
    allowedMentions: { parse: [], roles: !test && state.role ? [state.role] : [], users: [], repliedUser: false } };
}
async function notify(test = false) {
  if (!state.user || !state.channel) throw new Error('先に /live setup を実行してください。');
  const ch = await client.channels.fetch(state.channel);
  if (!ch || ch.guildId !== GUILD_ID || !ch.isTextBased()) throw new Error('通知先チャンネルを確認してください。');
  await ch.send(payload(test)); health.sent = new Date().toISOString();
}
async function detect() {
  if (!state.enabled || !state.user || !state.channel) return;
  health.checked = new Date().toISOString();
  try {
    const result = await resolveLive(state.user);
    health.details = result.details;
    health.result = result.live ? '配信中 (' + result.source + ')' : '未配信'; health.error = '';
    if (!result.live) { health.action = '配信開始待ち'; return; }
    const room = result.room;
    const key = state.user + ':' + room;
    if (state.rooms.includes(key)) { health.action = 'この配信は通知済み（重複防止）'; return; }
    if (Date.now() - state.manual > 600000) { await notify(); health.action = '自動通知を送信しました'; }
    else health.action = '直前に手動通知済みのため抑制';
    state.rooms = [...state.rooms, key].slice(-200); save();
  } catch (e) {
    health.result = '確認失敗'; health.error = safeError(e);
    health.details = e.details || health.details;
    console.error('[TikTok]', health.error, Object.fromEntries(Object.entries(health.details).map(([k,v]) => [k,safeError(v)])));
  }
}
const cmd = new SlashCommandBuilder().setName('live').setDescription('TikTok LIVE通知')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
  .addSubcommand(s => s.setName('setup').setDescription('1人のTikTokと通知先を設定')
    .addStringOption(o => o.setName('user').setDescription('TikTokの@ユーザー名').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('通知先').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
  .addSubcommand(s => s.setName('message').setDescription('通知文を設定。{user} {url} と改行用の\\nが使えます')
    .addStringOption(o => o.setName('text').setDescription('通知文').setRequired(true).setMaxLength(1200)))
  .addSubcommand(s => s.setName('role').setDescription('通知ロール。省略すると解除')
    .addRoleOption(o => o.setName('role').setDescription('メンションするロール')))
  .addSubcommand(s => s.setName('toggle').setDescription('自動検知ON/OFF')
    .addBooleanOption(o => o.setName('enabled').setDescription('有効').setRequired(true)))
  .addSubcommand(s => s.setName('test').setDescription('テスト送信（メンションなし）'))
  .addSubcommand(s => s.setName('notify').setDescription('手動で配信通知を送信（メンションあり）'))
  .addSubcommand(s => s.setName('check').setDescription('今すぐ検知（配信中なら通知）'))
  .addSubcommand(s => s.setName('status').setDescription('設定・検知状況・エラーを表示'))
  .addSubcommand(s => s.setName('debug').setDescription('検知失敗の経路別エラーを表示'));
function status() {
  return ['TikTok: @' + (state.user || '未設定'), '通知先: ' + (state.channel ? '<#' + state.channel + '>' : '未設定'),
    'ロール: ' + (state.role ? '<@&' + state.role + '>' : 'なし'), '自動検知: ' + (state.enabled ? 'ON' : 'OFF'),
    '確認間隔: ' + intervalMs / 1000 + '秒', '状態: ' + health.result, '処理: ' + health.action, '最終確認: ' + health.checked, '最終送信: ' + health.sent, 'エラー: ' + (health.error || 'なし'),
    '通知文:\n' + state.message].join('\n').slice(0, 1950);
}
const voiceGuard = createVoiceGuard({ client, guildId: GUILD_ID, dir, safeError });
client.on('voiceStateUpdate', (oldState, newState) => { voiceGuard.onVoiceState(oldState, newState).catch(e => console.error('[VoiceGuard]', safeError(e))); });
const tickets = createTickets({ client, guildId: GUILD_ID, dir, safeError });
const rolePanels = createRolePanels({ client, guildId: GUILD_ID, dir, safeError });
client.on('interactionCreate', async i => {
  if (await tickets.handle(i)) return;
  if (await voiceGuard.handle(i)) return;
  if (await rolePanels.handle(i)) return;
  if (!i.isChatInputCommand() || i.commandName !== 'live') return;
  if (i.guildId !== GUILD_ID || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: 'このサーバーの管理権限が必要です。', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try { await serial(async () => {
    const sub = i.options.getSubcommand(); let reply = '設定を保存しました。';
    if (sub === 'setup') { const u = username(i.options.getString('user')); if (u !== state.user) state.manual = 0; state.user = u; state.channel = i.options.getChannel('channel').id; save(); }
    if (sub === 'message') {
      const next = i.options.getString('text');
      // Limit the expanded message, including repeated placeholders.
      const expanded = next.replace(/\{user\}/g, '@' + 'x'.repeat(24)).replace(/\{url\}/g, 'https://www.tiktok.com/@' + 'x'.repeat(24) + '/live');
      if (expanded.length > 1850) throw new Error('置き換え後の通知文が長すぎます。短くしてください。');
      state.message = next; save();
    }
    if (sub === 'role') { const r = i.options.getRole('role'); if (r?.id === GUILD_ID) throw new Error('専用ロールを選んでください。@everyoneは指定できません。'); state.role = r?.id || ''; save(); }
    if (sub === 'toggle') { state.enabled = i.options.getBoolean('enabled'); save(); }
    if (sub === 'test') { await notify(true); reply = 'テスト送信しました（メンションなし）。'; }
    if (sub === 'notify') {
      if (Date.now() - state.manual < 60000) throw new Error('手動通知は60秒に1回です。');
      await notify(); state.manual = Date.now(); save();
      reply = '手動通知しました。10分以内に自動検知した配信の重複通知を抑えます。';
    }
    if (sub === 'check') { await detect(); reply = status(); }
    if (sub === 'status') reply = status();
    if (sub === 'debug') reply = ['TikTok: @' + state.user, '最終確認: ' + health.checked, '処理: ' + health.action, ...Object.entries(health.details).map(([k,v]) => k + ': ' + safeError(v)), 'エラー: ' + (health.error || 'なし'), process.env.SIGN_API_KEY ? 'Eulerキー: 設定済み' : 'Eulerキー: 未設定（TikTok直接取得の2経路）'].join('\u005cn').slice(0,1950);
    await i.editReply({ content: reply, allowedMentions: { parse: [] } });
    if (sub === 'setup' || (sub === 'toggle' && state.enabled)) setImmediate(() => serial(detect).catch(e => console.error(safeError(e))));
  }); } catch (e) {
    console.error('[Command]', safeError(e));
    await i.editReply({ content: 'エラー: ' + safeError(e), allowedMentions: { parse: [] } }).catch(() => {});
  }
});
let timer;
client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.commands.set([cmd.toJSON(), rolePanelCommand.toJSON(), voiceGuardCommand.toJSON(), ticketCommand.toJSON()]);
    console.log('Ready v1.5: ' + client.user.tag + '; interval=' + intervalMs / 1000 + 's; data=' + dir);
    const tick = async () => { const start = Date.now(); await serial(detect).catch(e => console.error(safeError(e))); timer = setTimeout(tick, Math.max(500, intervalMs - (Date.now() - start))); };
    tick();
    voiceGuard.sweep(guild).catch(e => console.error('[VoiceGuard]', safeError(e)));
  } catch (e) { console.error(safeError(e)); process.exit(1); }
});
client.on('error', e => console.error(safeError(e)));
http.createServer((req, res) => { res.writeHead(client.isReady() ? 200 : 503); res.end(client.isReady() ? 'OK' : 'Starting'); }).listen(Number(process.env.PORT || 3000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearTimeout(timer); voiceGuard.stop(); client.destroy(); process.exit(0); });
client.login(DISCORD_TOKEN).catch(e => { console.error(safeError(e)); process.exit(1); });
