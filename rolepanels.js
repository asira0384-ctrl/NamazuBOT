import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType, MessageFlags, ActionRowBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';

const adminPermissions = P.ManageGuild | P.ManageRoles;
const dangerous = [P.Administrator, P.ManageRoles, P.ManageGuild, P.ManageChannels, P.ManageWebhooks, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages];
export const rolePanelCommand = new SlashCommandBuilder().setName('rolepanel').setDescription('選択式ロールパネルを管理')
 .setDefaultMemberPermissions(adminPermissions).setDMPermission(false)
 .addSubcommand(s => s.setName('create').setDescription('ロール選択パネルを作成')
  .addChannelOption(o => o.setName('channel').setDescription('設置先チャンネル').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
  .addStringOption(o => o.setName('title').setDescription('パネルのタイトル').setMaxLength(256))
  .addStringOption(o => o.setName('message').setDescription('説明文。\\nで改行').setMaxLength(1500)))
 .addSubcommand(s => s.setName('list').setDescription('作成済みパネル一覧'))
 .addSubcommand(s => s.setName('delete').setDescription('パネルを無効化し、投稿を削除（付与済みロールは残ります）')
  .addStringOption(o => o.setName('id').setDescription('listで表示されるパネルID').setRequired(true)));

export function validateRole(role, bot, actor, ownerId) {
 if (!role || role.id === role.guild.id || role.managed) throw new Error('削除済み・@everyone・BOT管理ロールは選べません。');
 if (dangerous.some(p => role.permissions.has(p))) throw new Error(role.name + ' は管理・モデレーション権限を持つため公開配布できません。');
 if (!bot.permissions.has(P.ManageRoles) || bot.roles.highest.comparePositionTo(role) <= 0)
  throw new Error('BOTに「ロールの管理」を付け、BOTのロールを「' + role.name + '」より上へ移動してください。');
 if (actor && actor.id !== ownerId && actor.roles.highest.comparePositionTo(role) <= 0)
  throw new Error('自分より下のロールだけを登録できます。');
}
export function roleChanges(ids, held) {
 return { add: ids.filter(id => !held.has(id)), remove: ids.filter(id => held.has(id)) };
}
export function createRolePanels({ client, guildId, dir, safeError = e => String(e.message || e) }) {
 const file = path.join(dir, 'rolepanels.json');
 let panels = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
 const drafts = new Map(), locks = new Map();
 function save() { fs.writeFileSync(file + '.tmp', JSON.stringify(panels, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
 function lock(key, fn) {
  const job = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(key, job);
  job.finally(() => { if (locks.get(key) === job) locks.delete(key); }).catch(() => {});
  return job;
 }
 async function handle(i) {
  const command = i.isChatInputCommand() && i.commandName === 'rolepanel';
  const component = (i.isRoleSelectMenu() || i.isStringSelectMenu()) && i.customId.startsWith('rp:');
  if (!command && !component) return false;
  try {
   if (i.guildId !== guildId) { await i.reply({ content: '設定されたサーバーで使用してください。', flags: MessageFlags.Ephemeral }); return true; }
   await i.deferReply({ flags: MessageFlags.Ephemeral });
   const manager = command || i.customId.startsWith('rp:build:');
   if (manager && !i.memberPermissions.has(adminPermissions)) throw new Error('「サーバー管理」と「ロールの管理」の権限が必要です。');
   for (const [id,d] of drafts) if (Date.now() - d.time > 900000) drafts.delete(id);
   if (command) {
    const sub = i.options.getSubcommand();
    if (sub === 'create') {
     const id = randomUUID();
     drafts.set(id, { user: i.user.id, time: Date.now(), channel: i.options.getChannel('channel').id,
      title: i.options.getString('title') || 'ロールを選択',
      message: (i.options.getString('message') || '欲しいロールを選択してください。').replace(/\\n/g, '\n') });
     const row = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('rp:build:' + id)
      .setPlaceholder('配布するロールを選択（最大25個）').setMinValues(1).setMaxValues(25));
     await i.editReply({ content: '配布するロールを選んで確定すると、指定チャンネルへパネルを投稿します。', components: [row], allowedMentions: { parse: [] } });
    } else if (sub === 'list') {
     const rows = Object.entries(panels).map(([id,p]) => id + '\n' + p.title + ' — https://discord.com/channels/' + guildId + '/' + p.channel + '/' + p.messageId);
     // Attach full list if it exceeds Discord's message limit.
     const content = rows.join('\n\n') || 'パネルはまだありません。';
     if (content.length > 1900) await i.editReply({ content: 'パネル一覧', files: [{ attachment: Buffer.from(content), name: 'rolepanels.txt' }] });
     else await i.editReply({ content, allowedMentions: { parse: [] } });
    } else if (sub === 'delete') {
     const id = i.options.getString('id');
     await lock('panel:' + id, async () => {
      const panel = panels[id]; if (!panel) throw new Error('そのパネルIDはありません。');
      delete panels[id];
      try { save(); } catch(e) { panels[id] = panel; throw e; }
      let deleted = true;
      try { const ch = await client.channels.fetch(panel.channel); await ch.messages.delete(panel.messageId); }
      catch { deleted = false; }
      await i.editReply({ content: deleted ? 'パネルを削除しました。付与済みロールは残ります。' : 'パネルは無効化しました。投稿は削除できなかったため、必要なら手動で削除してください。' });
     });
    }
   } else if (i.customId.startsWith('rp:build:')) {
    const id = i.customId.slice('rp:build:'.length);
    await lock('draft:' + id, async () => {
     const draft = drafts.get(id);
     if (!draft || draft.user !== i.user.id) throw new Error('作成画面の期限が切れました。/rolepanel create を再実行してください。');
     const bot = await i.guild.members.fetchMe();
     const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
     const roles = await i.guild.roles.fetch();
     const ids = [...new Set(i.values)];
     if (!ids.length || ids.length > 25) throw new Error('1〜25個のロールを選んでください。');
     for (const rid of ids) validateRole(roles.get(rid), bot, actor, i.guild.ownerId);
     const ch = await client.channels.fetch(draft.channel);
     if (!ch || ch.guildId !== guildId || !ch.isTextBased()) throw new Error('設置先チャンネルが見つかりません。');
     const perms = ch.permissionsFor(bot);
     if (!perms?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) throw new Error('設置先でBOTに「チャンネルを見る」「メッセージを送信」「埋め込みリンク」を許可してください。');
     const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('rp:toggle:' + id)
      .setPlaceholder('選んだロールを付ける／外す').setMinValues(1).setMaxValues(ids.length)
      .addOptions(ids.map(rid => ({ label: roles.get(rid).name.slice(0,100), value: rid }))));
     let sent;
     try {
      sent = await ch.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(draft.title).setDescription(draft.message)
       .setFooter({ text: '選択したロール：持っていなければ付与、持っていれば解除。選んでいないロールは変更しません。' })],
       components: [row], allowedMentions: { parse: [] } });
      panels[id] = { channel: ch.id, messageId: sent.id, roles: ids, title: draft.title }; save();
     } catch(e) { delete panels[id]; if (sent) await sent.delete().catch(() => {}); throw e; }
     drafts.delete(id);
     await i.editReply({ content: 'パネルを作成しました。\n' + sent.url + '\nID: ' + id, allowedMentions: { parse: [] } });
    });
   } else {
    const id = i.customId.slice('rp:toggle:'.length);
    // Same panel cannot be deleted during assignment; same member cannot be edited concurrently.
    await lock('panel:' + id, () => lock('member:' + i.user.id, async () => {
     const panel = panels[id];
     if (!panel || panel.messageId !== i.message.id || panel.channel !== i.channelId) throw new Error('このロールパネルは無効です。');
     const ids = [...new Set(i.values)];
     if (!ids.length || ids.some(rid => !panel.roles.includes(rid))) throw new Error('登録されていないロールです。');
     const bot = await i.guild.members.fetchMe();
     const roles = await i.guild.roles.fetch();
     for (const rid of ids) validateRole(roles.get(rid), bot, null, i.guild.ownerId);
     const member = await i.guild.members.fetch({ user: i.user.id, force: true });
     const changes = roleChanges(ids, member.roles.cache);
     const added = [], removed = [], failed = [];
     // Singular role endpoints preserve every unrelated role.
     for (const rid of changes.add) {
      try { await member.roles.add(rid, '本人によるロールパネル選択'); added.push('<@&' + rid + '>'); }
      catch(e) { failed.push(roles.get(rid).name + ': ' + safeError(e)); }
     }
     for (const rid of changes.remove) {
      try { await member.roles.remove(rid, '本人によるロールパネル選択'); removed.push('<@&' + rid + '>'); }
      catch(e) { failed.push(roles.get(rid).name + ': ' + safeError(e)); }
     }
     await i.editReply({ content: [added.length ? '付与：' + added.join(' ') : '', removed.length ? '解除：' + removed.join(' ') : '',
      failed.length ? '変更できませんでした：\n' + failed.join('\n') : ''].filter(Boolean).join('\n').slice(0,1900), allowedMentions: { parse: [] } });
    }));
   }
  } catch(e) {
   const content = 'エラー：' + safeError(e);
   if (i.deferred || i.replied) await i.editReply({ content, allowedMentions: { parse: [] } }).catch(() => {});
   else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
 }
 return { handle };
}
