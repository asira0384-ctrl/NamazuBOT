import fs from 'node:fs';
import path from 'node:path';
import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType, MessageFlags } from 'discord.js';

export const voiceGuardCommand = new SlashCommandBuilder().setName('voiceguard').setDescription('指定メンバーのサーバーミュートを自動解除')
 .setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
 .addSubcommand(s => s.setName('add').setDescription('保護する人を追加（複数人登録可能）')
  .addUserOption(o => o.setName('user').setDescription('保護する人').setRequired(true)))
 .addSubcommand(s => s.setName('remove').setDescription('保護する人を解除')
  .addUserOption(o => o.setName('user').setDescription('保護を外す人').setRequired(true)))
 .addSubcommand(s => s.setName('log').setDescription('3秒ごとにまとめて送信するログチャンネル')
  .addChannelOption(o => o.setName('channel').setDescription('ログ送信先').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
 .addSubcommand(s => s.setName('toggle').setDescription('自動解除をON/OFF')
  .addBooleanOption(o => o.setName('enabled').setDescription('有効').setRequired(true)))
 .addSubcommand(s => s.setName('status').setDescription('対象者・ログ送信先・エラーを確認'))
 .addSubcommand(s => s.setName('check').setDescription('現在のVC状態を確認して解除を試す'));

export function correction(voice) {
 if (!voice?.channelId) return null;
 const patch = {};
 if (voice.serverMute === true) patch.mute = false;
 if (voice.serverDeaf === true) patch.deaf = false;
 return Object.keys(patch).length ? patch : null;
}

// Independent from moderation actions: logging never blocks an unmute request.
export function createLogBatcher({ send, onError = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
 let pending = new Map(), timer = null, sending = false, stopped = false;
 function arm() {
  if (stopped || timer !== null || sending || !pending.size) return;
  timer = schedule(() => { timer = null; return flush(); }, 3000);
 }
 async function flush() {
  if (stopped || sending || !pending.size) return;
  const batch = [...pending.values()]; pending = new Map(); sending = true;
  try { await send(batch); } catch(e) { onError(e); }
  finally { sending = false; arm(); }
 }
 return {
  add(item) {
   if (stopped) return;
   const key = item.user + ':' + item.kind;
   const entry = pending.get(key);
   if (entry) { entry.count++; entry.detail = item.detail; }
   else pending.set(key, { ...item, count: 1 });
   arm();
  },
  stop() { stopped = true; if (timer !== null) cancel(timer); timer = null; pending.clear(); }
 };
}

export function createVoiceGuard({ client, guildId, dir, safeError = e => String(e.message || e), schedule = setTimeout, cancel = clearTimeout }) {
 const file = path.join(dir, 'voiceguard.json');
 let config = { enabled: true, users: [], channel: '' };
 if (fs.existsSync(file)) config = { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
 const stats = { lastAction: 'なし', lastError: '', logError: '', corrections: 0 };
 const lanes = new Map();
 let stopped = false;
 function save(next) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file); config = next;
 }
 const logger = createLogBatcher({
  schedule, cancel,
  send: async entries => {
   if (!config.channel) { stats.logError = 'ログ先未設定。/voiceguard log で設定してください。'; return; }
   const channel = await client.channels.fetch(config.channel);
   if (!channel || channel.guildId !== guildId || !channel.isTextBased()) throw new Error('ログチャンネルが見つかりません。');
   const total = entries.reduce((n,e) => n + e.count, 0);
   const lines = entries.map(e => '<@' + e.user + '> — ' + e.detail + ' ×' + e.count);
   let content = '🔊 VC自動解除ログ（' + total + '件）\n';
   let shown = 0;
   for (const line of lines) { if (content.length + line.length > 1800) break; content += line + '\n'; shown++; }
   if (shown < lines.length) content += 'ほか ' + (lines.length - shown) + '種類の記録';
   await channel.send({ content, allowedMentions: { parse: [] } });
   stats.logError = '';
  },
  onError: e => { stats.logError = safeError(e); console.error('[VoiceGuard log]', stats.logError); }
 });
 function eligible(voice) { return !stopped && config.enabled && voice?.guild.id === guildId && config.users.includes(voice.id); }
 async function run(id, lane) {
  if (lane.running || stopped) return;
  lane.running = true; lane.dirty = false;
  try {
   let voice = lane.voice;
   if (!eligible(voice) || !correction(voice)) return;
   const bot = voice.guild.members.me || await voice.guild.members.fetchMe();
   voice = lane.voice;
   if (!eligible(voice)) return;
   const patch = correction(voice);
   if (!patch) return;
   const permissions = voice.channel?.permissionsFor(bot);
   if (!permissions) throw new Error('対象VCの権限を確認できません。');
   if ('mute' in patch && !permissions.has(P.MuteMembers)) throw new Error('対象VCでBOTに「メンバーをミュート」の権限がありません。');
   if ('deaf' in patch && !permissions.has(P.DeafenMembers)) throw new Error('対象VCでBOTに「メンバーのスピーカーをミュート」の権限がありません。');
   await voice.guild.members.edit(id, { ...patch, reason: 'VoiceGuard: 管理者が指定したメンバーのVC保護' });
   lane.failures = 0;
   stats.corrections++; stats.lastAction = new Date().toISOString(); stats.lastError = '';
   const labels = [];
   if ('mute' in patch) labels.push('サーバーミュート');
   if ('deaf' in patch) labels.push('サーバースピーカーミュート');
   logger.add({ user: id, kind: 'success:' + Object.keys(patch).join(','), detail: labels.join('・') + 'を解除（API成功）' });
  } catch(e) {
   stats.lastError = safeError(e);
   logger.add({ user: id, kind: 'failure', detail: '解除失敗: ' + stats.lastError });
   // Retry only transient server/network failures; permission errors require admin correction.
   const transient = Number(e.status) >= 500 || ['ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(e.code);
   if (transient && ++lane.failures <= 2) lane.dirty = true;
  } finally {
   lane.running = false;
   if (lane.dirty && eligible(lane.voice) && correction(lane.voice)) {
    if (lane.timer === null) lane.timer = schedule(() => { lane.timer = null; return run(id, lane); }, lane.failures ? 1000 : 250);
   } else if (!lane.timer) lanes.delete(id);
  }
 }
 function request(voice) {
  if (!eligible(voice) || !correction(voice)) return Promise.resolve();
  let lane = lanes.get(voice.id);
  if (!lane) { lane = { voice, running: false, dirty: false, timer: null, failures: 0 }; lanes.set(voice.id, lane); }
  lane.voice = voice;
  if (lane.running || lane.timer !== null) { lane.dirty = true; return Promise.resolve(); }
  return run(voice.id, lane);
 }
 function onVoiceState(oldVoice, newVoice) {
  if (newVoice.guild.id !== guildId) return Promise.resolve();
  const lane = lanes.get(newVoice.id);
  if (lane) lane.voice = newVoice;
  const newlyMuted = newVoice.serverMute && !oldVoice.serverMute;
  const newlyDeafened = newVoice.serverDeaf && !oldVoice.serverDeaf;
  if (newlyMuted || newlyDeafened || oldVoice.channelId !== newVoice.channelId) return request(newVoice);
  return Promise.resolve();
 }
 function sweep(guild) {
  if (!guild || guild.id !== guildId) return Promise.resolve([]);
  return Promise.all([...guild.voiceStates.cache.values()].filter(eligible).map(request));
 }
 async function handle(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'voiceguard') return false;
  try {
   if (i.guildId !== guildId || !i.memberPermissions?.has(P.Administrator)) {
    await i.reply({ content: 'このサーバーの管理者だけが設定できます。', flags: MessageFlags.Ephemeral }); return true;
   }
   await i.deferReply({ flags: MessageFlags.Ephemeral });
   const sub = i.options.getSubcommand(); let reply = '';
   if (sub === 'add') {
    const user = i.options.getUser('user');
    await i.guild.members.fetch(user.id);
    if (!config.users.includes(user.id) && config.users.length >= 100) throw new Error('登録は最大100人です。');
    save({ ...config, users: [...new Set([...config.users, user.id])] });
    reply = '<@' + user.id + '> を登録しました。サーバーミュート・サーバースピーカーミュートを自動解除します。' +
     (!config.enabled ? '\n現在OFFです。/voiceguard toggle enabled:True で有効化してください。' : '') +
     (!config.channel ? '\n/voiceguard log でログ先を設定してください。' : '');
    await request(i.guild.voiceStates.cache.get(user.id));
   } else if (sub === 'remove') {
    const id = i.options.getUser('user').id;
    save({ ...config, users: config.users.filter(x => x !== id) });
    reply = '<@' + id + '> の保護を解除しました。';
   } else if (sub === 'log') {
    const channel = i.options.getChannel('channel');
    const bot = i.guild.members.me || await i.guild.members.fetchMe();
    if (!channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages])) throw new Error('ログ先でBOTに「チャンネルを見る」「メッセージを送信」を許可してください。');
    save({ ...config, channel: channel.id }); stats.logError = '';
    reply = 'ログ先を <#' + channel.id + '> に設定しました。連続した記録をまとめて最大3秒に1回送信します。';
   } else if (sub === 'toggle') {
    save({ ...config, enabled: i.options.getBoolean('enabled') });
    reply = '自動解除を ' + (config.enabled ? 'ON' : 'OFF') + ' にしました。';
    if (config.enabled) await sweep(i.guild);
   } else if (sub === 'check') {
    await sweep(i.guild); reply = 'VCの状態を確認しました。\n' + status();
   } else if (sub === 'status') reply = status();
   await i.editReply({ content: reply.slice(0,1950), allowedMentions: { parse: [] } });
  } catch(e) {
   const data = { content: 'エラー: ' + safeError(e), allowedMentions: { parse: [] } };
   if (i.deferred || i.replied) await i.editReply(data).catch(() => {});
   else await i.reply({ ...data, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return true;
 }
 function status() {
  return ['自動解除: ' + (config.enabled ? 'ON' : 'OFF'),
   '対象 (' + config.users.length + '人): ' + (config.users.slice(0,30).map(id => '<@' + id + '>').join(' ') || 'なし') + (config.users.length > 30 ? ' ほか' + (config.users.length-30) + '人' : ''),
   'ログ先: ' + (config.channel ? '<#' + config.channel + '>' : '未設定'),
   'ログ間隔: 最短3秒（まとめて送信・メンション通知なし）',
   '最終解除: ' + stats.lastAction, '起動後の解除回数: ' + stats.corrections,
   '解除エラー: ' + (stats.lastError || 'なし'), 'ログエラー: ' + (stats.logError || 'なし')].join('\n');
 }
 function stop() {
  stopped = true; logger.stop();
  for (const lane of lanes.values()) if (lane.timer !== null) cancel(lane.timer);
  lanes.clear();
 }
 return { handle, onVoiceState, sweep, status, stop };
}
