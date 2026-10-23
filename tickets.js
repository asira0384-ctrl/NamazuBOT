import fs from 'node:fs';
import path from 'node:path';
import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
const labels = { normal: '通常', vip: 'VIP購入' };
const vipText = 'NamazuSMPのサブスクとしてNamazu+を販売します！\n\n値段: **300円/月**\n特典: **home設定数上限が3個→7個・tab表示に[Namazu+]の表示**';
const typeOption = s => s.addStringOption(o => o.setName('type').setDescription('窓口').setRequired(true).addChoices({name:'通常',value:'normal'},{name:'VIP購入',value:'vip'}));
export const ticketCommand = new SlashCommandBuilder().setName('ticket').setDescription('通常・VIP購入チケットの設定').setDefaultMemberPermissions(P.ManageGuild).setDMPermission(false)
 .addSubcommand(s => typeOption(s.setName('setup').setDescription('作成先カテゴリを設定')).addChannelOption(o => o.setName('category').setDescription('チケット作成先').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
 .addSubcommand(s => typeOption(s.setName('staffadd').setDescription('スタッフを追加（繰り返して複数登録）')).addUserOption(o=>o.setName('user').setDescription('スタッフ個人')).addRoleOption(o=>o.setName('role').setDescription('スタッフロール')))
 .addSubcommand(s => typeOption(s.setName('staffremove').setDescription('スタッフを解除')).addUserOption(o=>o.setName('user').setDescription('スタッフ個人')).addRoleOption(o=>o.setName('role').setDescription('スタッフロール')))
 .addSubcommand(s => typeOption(s.setName('panel').setDescription('作成ボタンを投稿')).addChannelOption(o=>o.setName('channel').setDescription('投稿先').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o=>o.setName('title').setDescription('見出し').setMaxLength(256)).addStringOption(o=>o.setName('message').setDescription('説明文。\\nで改行').setMaxLength(1800)))
 .addSubcommand(s => typeOption(s.setName('sync').setDescription('既存チケットのスタッフ権限を再同期')))
 .addSubcommand(s => s.setName('status').setDescription('設定を確認'));
const row = (id,label,style=ButtonStyle.Primary) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style));
export function ticketOverwrites(guildId, botId, owner, config, closed=false) {
 const map = new Map();
 map.set(guildId,{id:guildId,type:0,deny:[P.ViewChannel]});
 const access = [P.ViewChannel,P.ReadMessageHistory];
 const write = [P.SendMessages,P.AttachFiles,P.EmbedLinks];
 const denied = [P.CreatePublicThreads,P.CreatePrivateThreads,P.SendMessagesInThreads,...(closed?write:[])];
 for (const [ids,type] of [[config.roles,0],[[...config.users,owner],1]]) for(const id of ids)
  map.set(id,{id,type,allow:[...access,...(closed?[]:write)],deny:denied});
 map.set(botId,{id:botId,type:1,allow:[...access,...write,P.ManageChannels,P.ManageRoles]});
 return [...map.values()];
}
export function createTickets({client,guildId,dir,safeError=e=>String(e.message||e)}) {
 const file=path.join(dir,'tickets.json');
 const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{config:{normal:{category:null,users:[],roles:[]},vip:{category:null,users:[],roles:[]}},tickets:{}};
 const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 let queue=Promise.resolve();
 const serial=fn=>{const job=queue.catch(()=>{}).then(fn);queue=job;return job;};
 const marker=(t,status='open')=>'ticketbot:'+client.user.id+':'+t.type+':'+t.owner+':'+status;
 async function channel(guild,id) {try{return await guild.channels.fetch(id);}catch(e){if(e.code===10003)return null;throw e;}}
 async function sync(guild,type) {
  let failed=0;
  for(const [id,t] of Object.entries(state.tickets)) if(t.type===type) {
   try{const ch=await channel(guild,id);if(ch)await ch.permissionOverwrites.set(ticketOverwrites(guildId,client.user.id,t.owner,state.config[type],t.closed));else delete state.tickets[id];}
   catch(e){failed++;console.error('[Ticket sync]',safeError(e));}
  }
  save();return failed;
 }
 async function open(i,type) {
  const config=state.config[type];if(!config?.category)throw new Error('管理者が先に /ticket setup を設定してください。');
  const existing=Object.entries(state.tickets).find(([,t])=>t.type===type&&t.owner===i.user.id&&!t.closed);
  if(existing) {const ch=await channel(i.guild,existing[0]);if(ch)return i.editReply('作成済みです：<#'+ch.id+'>');delete state.tickets[existing[0]];save();}
  // Recover a channel created immediately before an interrupted save.
  const all=await i.guild.channels.fetch();
  const recovered=all.find(ch=>ch?.topic===marker({type,owner:i.user.id}));
  if(recovered){state.tickets[recovered.id]={type,owner:i.user.id,closed:false};save();return i.editReply('作成済みです：<#'+recovered.id+'>');}
  const parent=await channel(i.guild,config.category);if(parent?.type!==ChannelType.GuildCategory)throw new Error('カテゴリが見つかりません。setupで設定し直してください。');
  const t={type,owner:i.user.id,closed:false};
  const ch=await i.guild.channels.create({name:(type==='vip'?'vip-':'ticket-')+i.user.id,type:ChannelType.GuildText,parent:parent.id,topic:marker(t),permissionOverwrites:ticketOverwrites(guildId,client.user.id,i.user.id,config),reason:'本人によるチケット作成'});
  state.tickets[ch.id]=t;save();
  const embed=new EmbedBuilder().setColor(type==='vip'?0xf1c40f:0x5865f2).setTitle(type==='vip'?'🛒 Namazu+':'お問い合わせ').setDescription(type==='vip'?vipText:'お問い合わせ内容を書いてください。スタッフが対応します。');
  try{await ch.send({content:[...new Set([i.user.id,...config.users])].map(id=>'<@'+id+'>').concat(config.roles.map(id=>'<@&'+id+'>')).join(' '),embeds:[embed],components:[row('tk:close','close',ButtonStyle.Danger)],allowedMentions:{users:[...new Set([i.user.id,...config.users])],roles:config.roles}});}
  catch(e){return i.editReply('チケットは作成しました：<#'+ch.id+'>。案内投稿に失敗しました：'+safeError(e));}
  return i.editReply('チケットを作成しました：<#'+ch.id+'>');
 }
 async function close(i,confirm) {
  const t=state.tickets[i.channelId];if(!t)throw new Error('登録されたチケット内で使ってください。');
  const member=await i.guild.members.fetch(i.user.id), config=state.config[t.type];
  if(i.user.id!==t.owner&&!member.permissions.has(P.Administrator)&&!config.users.includes(i.user.id)&&!config.roles.some(id=>member.roles.cache.has(id)))throw new Error('作成者・この窓口のスタッフ・管理者だけが閉じられます。');
  if(t.closed)return i.editReply({content:'このチケットは閉じています。',components:[]});
  if(!confirm)return i.editReply({content:'このチケットを閉じますか？会話は読み取り専用で残ります。',components:[row('tk:confirm','閉じる',ButtonStyle.Danger)]});
  await i.channel.permissionOverwrites.set(ticketOverwrites(guildId,client.user.id,t.owner,config,true));
  await i.channel.setTopic(marker(t,'closed'));
  t.closed=true;save();
  await i.channel.setName('closed-'+i.channel.name.slice(0,90)).catch(e=>console.error('[Ticket rename]',safeError(e)));
  await i.editReply({content:'閉じました。履歴はこのチャンネルに残ります。',components:[]});
 }
 async function handle(i) {
  const command=i.isChatInputCommand()&&i.commandName==='ticket';
  const button=i.isButton()&&i.customId.startsWith('tk:');if(!command&&!button)return false;
  try {
   if(i.guildId!==guildId)throw new Error('このサーバーでは使えません。');
   if(command&&!i.memberPermissions?.has(P.ManageGuild))throw new Error('サーバー管理権限が必要です。');
   if(button&&i.message.author.id!==client.user.id)throw new Error('BOTが投稿したボタンを使ってください。');
   await i.deferReply({flags:MessageFlags.Ephemeral});
   await serial(async()=>{
    if(button){if(i.customId==='tk:close'||i.customId==='tk:confirm')return close(i,i.customId==='tk:confirm');const type=i.customId.split(':')[2];if(i.customId==='tk:open:'+type&&labels[type])return open(i,type);throw new Error('無効なボタンです。');}
    const sub=i.options.getSubcommand(),type=i.options.getString('type');
    if(sub==='status')return i.editReply({content:Object.entries(state.config).map(([k,c])=>labels[k]+': カテゴリ '+(c.category?'<#'+c.category+'>':'未設定')+'\n個人: '+(c.users.map(id=>'<@'+id+'>').join(' ')||'なし')+'\nロール: '+(c.roles.map(id=>'<@&'+id+'>').join(' ')||'なし')).join('\n\n').slice(0,1950),allowedMentions:{parse:[]}});
    const c=state.config[type];
    if(sub==='setup'){c.category=i.options.getChannel('category').id;save();return i.editReply(labels[type]+'の作成先を設定しました。既存チケットは移動しません。');}
    if(sub==='staffadd'||sub==='staffremove'){
     const user=i.options.getUser('user'),role=i.options.getRole('role');if(!user&&!role)throw new Error('userかroleを指定してください。両方指定もできます。');
     if(role?.id===guildId)throw new Error('@everyoneはスタッフに指定できません。');
     if(sub==='staffadd'&&user)await i.guild.members.fetch(user.id);
     const next={...c,users:[...c.users],roles:[...c.roles]};
     for(const [key,obj] of [['users',user],['roles',role]])if(obj)next[key]=sub==='staffadd'?[...new Set([...next[key],obj.id])]:next[key].filter(id=>id!==obj.id);
     if(next.users.length+next.roles.length>70)throw new Error('スタッフの登録は個人とロール合計70件までです。');
     state.config[type]=next;save();const failed=await sync(i.guild,type);return i.editReply('スタッフ設定を保存しました。'+(failed?'権限同期に'+failed+'件失敗。BOT権限を確認し /ticket sync で再実行してください。':'既存チケットの閲覧権限にも反映しました。'));
    }
    if(sub==='sync'){const n=await sync(i.guild,type);return i.editReply(n?'同期に'+n+'件失敗。BOT権限を確認してください。':'権限を同期しました。');}
    if(sub==='panel'){
     if(!c.category)throw new Error('先に /ticket setup を設定してください。');
     const target=i.options.getChannel('channel');
     const embed=new EmbedBuilder().setColor(type==='vip'?0xf1c40f:0x5865f2).setTitle(i.options.getString('title')||(type==='vip'?'🛒 Namazu+ VIP購入':'🎫 お問い合わせ')).setDescription((i.options.getString('message')||(type==='vip'?vipText+'\n\n購入をご希望の方は、下のボタンからチケットを作成してください。':'下のボタンから通常チケットを作成してください。')).replace(/\\n/g,'\n'));
     await target.send({embeds:[embed],components:[row('tk:open:'+type,type==='vip'?'🛒 VIP購入チケットを作成':'🎫 通常チケットを作成')],allowedMentions:{parse:[]}});return i.editReply('パネルを投稿しました。');
    }
   });
  } catch(e){console.error('[Ticket]',safeError(e));const payload={content:'エラー: '+safeError(e),allowedMentions:{parse:[]}};if(i.deferred||i.replied)await i.editReply(payload).catch(()=>{});else await i.reply({...payload,flags:MessageFlags.Ephemeral}).catch(()=>{});}
  return true;
 }
 return {handle};
}
