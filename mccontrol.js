import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
export const mcCommand = new SlashCommandBuilder().setName('mc').setDescription('Minecraft BOTを操作')
 .setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
 .addSubcommand(s => s.setName('panel').setDescription('Minecraft一斉招待ボタンを設置'))
 .addSubcommand(s => s.setName('status').setDescription('Minecraft BOTと最新の招待結果を確認'));
export function createMcControl({ guildId, safeError }) {
 return { async handle(i) {
  const button = i.isButton() && ['mc:inviteall', 'mc:status'].includes(i.customId);
  if (!button && (!i.isChatInputCommand() || i.commandName !== 'mc')) return false;
  if (i.guildId !== guildId || !i.memberPermissions?.has(P.Administrator)) {
   await i.reply({ content: '管理者のみ使用できます。', flags: MessageFlags.Ephemeral }); return true;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
   const action = button ? i.customId.split(':')[1] : i.options.getSubcommand();
   if (action === 'panel') {
    await i.channel.send({ content: '**Minecraft ワールド招待**\n管理者がボタンを押すと、BOTのフレンド全員へ一度ずつ招待を送ります。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mc:inviteall').setLabel('フレンド全員を招待').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('mc:status').setLabel('状態確認').setStyle(ButtonStyle.Secondary))], allowedMentions: { parse: [] } });
    await i.editReply('招待パネルを設置しました。'); return true;
   }
   const { MC_BOT_URL, MC_API_KEY } = process.env;
   if (!MC_BOT_URL || !MC_API_KEY) throw Error('RailwayのVariablesにMC_BOT_URLとMC_API_KEYを設定してください。');
   const url = new URL(action === 'inviteall' ? '/invite-all' : '/status', MC_BOT_URL);
   if (!['http:', 'https:'].includes(url.protocol)) throw Error('MC_BOT_URLはhttp/httpsのURLにしてください。');
   const res = await fetch(url, { method: action === 'inviteall' ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + MC_API_KEY }, signal: AbortSignal.timeout(15000), redirect: 'error' });
   const data = await res.json();
   if (!res.ok) throw Error(data.error || 'MC BOT HTTP ' + res.status);
   await i.editReply({ content: action === 'inviteall' ? '一斉招待を開始しました。結果は /mc status で確認できます。' : ['MC BOT: ' + (data.ready ? '公開中' : '認証・起動待ち'), '自動招待: フレンド承認直後のみ', '一斉招待: ' + JSON.stringify(data.batch), '最新結果: ' + (data.lastInvite || 'なし'), '最新エラー: ' + (data.lastError || 'なし')].join('\n').slice(0,1900), allowedMentions: { parse: [] } });
  } catch(e) { await i.editReply({ content: 'エラー: ' + safeError(e), allowedMentions: { parse: [] } }); }
  return true;
 } };
}
