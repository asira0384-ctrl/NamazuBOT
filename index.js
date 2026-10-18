import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { TikTokLiveConnection, UserOfflineError } from 'tiktok-live-connector';

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) throw new Error('RailwayにDISCORD_TOKENとGUILD_IDを設定してください');
const dir = process.env.DATA_DIR || './data';
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'settings.json');
let state = { user: '', channel: '', role: '', message: '{user} がTikTok LIVEを開始しました！\n{url}', enabled: true, rooms: [], manual: 0 };
if (fs.existsSync(file)) state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
function save() { fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
save();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const health = { checked: 'なし', result: '未確認', error: '', sent: 'なし' };
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
    const connection = new TikTokLiveConnection(state.user, {
      ...(process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {}),
      webClientOptions: { timeout: { request: 15000 }, retry: { limit: 0 } }
    });
    const live = await connection.fetchIsLive();
    health.result = live ? '配信中' : '未配信'; health.error = '';
    if (!live) return;
    const room = String(await connection.fetchRoomId());
    if (!/^\d+$/.test(room)) throw new Error('配信IDを取得できませんでした。');
    const key = state.user + ':' + room;
    if (state.rooms.includes(key)) return;
    if (Date.now() - state.manual > 600000) await notify();
    state.rooms = [...state.rooms, key].slice(-200); save();
  } catch (e) {
    if (e instanceof UserOfflineError) { health.result = '未配信'; health.error = ''; }
    else { health.result = '確認失敗'; health.error = safeError(e); console.error('[TikTok]', health.error); }
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
  .addSubcommand(s => s.setName('status').setDescription('設定・検知状況・エラーを表示'));
function status() {
  return ['TikTok: @' + (state.user || '未設定'), '通知先: ' + (state.channel ? '<#' + state.channel + '>' : '未設定'),
    'ロール: ' + (state.role ? '<@&' + state.role + '>' : 'なし'), '自動検知: ' + (state.enabled ? 'ON' : 'OFF'),
    '状態: ' + health.result, '最終確認: ' + health.checked, '最終送信: ' + health.sent, 'エラー: ' + (health.error || 'なし'),
    '通知文:\n' + state.message].join('\n').slice(0, 1950);
}
client.on('interactionCreate', async i => {
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
    await i.editReply({ content: reply, allowedMentions: { parse: [] } });
  }); } catch (e) {
    console.error('[Command]', safeError(e));
    await i.editReply({ content: 'エラー: ' + safeError(e), allowedMentions: { parse: [] } }).catch(() => {});
  }
});
let timer;
client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.commands.set([cmd.toJSON()]);
    console.log('Ready: ' + client.user.tag + '; interval=60s; data=' + dir);
    const tick = async () => { await serial(detect).catch(e => console.error(safeError(e))); timer = setTimeout(tick, 60000); };
    tick();
  } catch (e) { console.error(safeError(e)); process.exit(1); }
});
client.on('error', e => console.error(safeError(e)));
http.createServer((req, res) => { res.writeHead(client.isReady() ? 200 : 503); res.end(client.isReady() ? 'OK' : 'Starting'); }).listen(Number(process.env.PORT || 3000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearTimeout(timer); client.destroy(); process.exit(0); });
client.login(DISCORD_TOKEN).catch(e => { console.error(safeError(e)); process.exit(1); });
