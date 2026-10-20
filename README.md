# TikTok LIVE通知・ロールパネルBOT v1.3
1サーバー・1人用。Discordのコマンドで通知先、文章、ロールを設定します。

## Railwayで動かす
1. ZIPを解凍し、中のファイルをGitHubの新しいリポジトリの一番上へアップロード。
   package.json、package-lock.json、index.js、Dockerfile、railway.jsonを必ず入れる。
2. https://discord.com/developers/applications でNew Application → BotからBOTを作成しTokenを取得。
   このBOTは特権Intents不要。Message Content等をONにする必要はありません。
3. OAuth2の招待URLで scopes「bot」「applications.commands」を選ぶ。
   権限は「View Channels」「Send Messages」。通知ロールをメンション可能にするか、
   BOTへ「Mention Everyone」の権限を追加する（コードから@everyoneは送信しません）。
   サーバーへ招待する。通知先のチャンネル権限も確認。
4. Discord設定 → 詳細設定 → 開発者モードON。
   自分のサーバーを右クリック → サーバーIDをコピー。
5. RailwayでNew Project → Deploy from GitHub repo → 対象リポジトリ。
6. BOTサービスのVariablesに以下を登録：
   DISCORD_TOKEN = BOTのToken
   GUILD_ID = サーバーID
   DATA_DIR = /data
7. BOTサービスにVolumeを追加し、Mount Pathを /data にする。
   Volumeがないと再デプロイで設定・通知済み配信IDが失われます。
   データベースやSupabaseは不要。Replicaは1にしてください。
8. デプロイ。ログにReadyが出たらDiscordで /live setup を実行。
   常時起動が必要です。Railwayのスリープ機能は使わないでください。
   HTTP公開ドメインは不要です。Railwayの利用料金は別途発生する場合があります。

TokenはGitHubやチャットへ貼らずRailwayのVariablesにだけ保存してください。
このパッケージは新しい専用BOT用です。同じBOTに登録済みの同サーバーのコマンドは置き換わります。

## コマンド（サーバー管理権限が必要）
|コマンド|内容|
|---|---|
|/live setup user:ユーザー名 channel:通知先|監視する1人と通知先を指定。再設定で変更|
|/live message text:文章|通知メッセージを変更|
|/live role role:ロール|通知ロールを指定。roleを省略すると解除|
|/live toggle enabled:True/False|自動検知ON/OFF|
|/live test|通知先へテスト送信。メンションなし|
|/live check|今すぐ検知。未通知の配信なら実際に送信|
|/live status|設定・最終検知・最終送信・エラー|
|/live debug|経路ごとの検知結果・取得エラー|
|/live notify|検知と関係なく手動で本番通知。ロールへのメンションあり|

通知文の例：
配信始めた！見に来てね！\n{url}
{user} is LIVE on TikTok!\n{url}

{user} → @ユーザー名
{url} → 配信URL
\n → 改行
指定ロールだけにメンションします。本文内の@everyoneや別ユーザーのメンションは通知されません。
配信タイトル・サムネイル取得はありません。自由な文章とリンクの通知です。

## 検知について
- 既定10秒間隔で公開配信を確認。TikTokページとAPIを並行取得し、配信中の応答が出れば通知。
- 実際の通知時間にはTikTok側の反映遅延・通信時間が加わります。10秒以内を保証するものではありません。
- POLL_SECONDSをVariablesで指定可能（最小10秒）。取得タイムアウトは約8.5秒。
- /live setup と自動検知ONへの変更時にも確認を実行。
- 1つの経路で未配信でも、別経路で配信中なら配信中を優先。
- HTMLのscriptタグの属性順・改行の違いにも対応。
- TikTok Live Connector 2.5.0を使用する非公式検知です。TikTokの仕様変更、アクセス制限、
  RailwayのIP、限定配信などにより検知できない場合があります。
- 未配信と取得エラーを区別して表示します。エラーは /live status とRailwayログで確認。
- 自動検知の配信IDを保存して同じ配信の繰り返し通知を抑えます。
- BOT起動時に既に配信中でも、その配信IDが未通知なら通知します。
- 通常はAPIキーなしで試せます。直接取得の2経路が失敗する場合、
  https://www.eulerstream.com で適切なAPI利用権限を持つキーを取得し、SIGN_API_KEYに設定できます。
  キーを追加しても必ず検知できる保証はなく、サービス側の利用条件・料金を確認してください。
- 自動検知できない場合も /live notify で通知可能。これは手動であり自動検知の代替ではありません。
  別の既製TikTok通知サービスへの接続はこのZIPには含めていません。
- 手動通知は60秒に1回。手動通知から10分以内に初めて検知した配信は追加通知を省略します。
- Discord送信直後・保存直前の異常終了などでは重複する余地があります。
- 実際のTikTokアカウント・Discordトークンでの接続試験は未実施です。

## v1.0から更新
ZIPの中身をGitHubの同じ場所に上書き。新しいdetector.jsと更新したDockerfileも必須です。
RailwayのVariables・Volumeは同じ設定を使用。既存の通知文・監視アカウントはVolumeから引き継ぎます。
デプロイログに Ready v1.1 と interval=10s が出たら更新完了。
/live test が届くのに配信が検知されない場合は、/live check → /live debug の表示を確認してください。
TikTok側に直接取得を制限されている場合、間隔を短くするだけでは解決しません。
SIGN_API_KEYを使う経路にも適切なAPI権限が必要で、無料・無制限の動作は保証しません。

## ロール選択パネル（v1.2）
1. Discordのサーバー設定 → ロールで、BOTのロールに「ロールの管理」を付ける。
2. BOTのロールを、配布するロールより上へドラッグする。
3. 設置先チャンネルでBOTに「チャンネルを見る」「メッセージを送信」「埋め込みリンク」を許可する。
4. /rolepanel create channel:設置先 title:タイトル message:説明文 を実行。
5. 自分にだけ表示される選択メニューで配布するロールを1〜25個選び、確定。
6. 指定チャンネルへパネルが投稿され、一般メンバーも自由に使用できる。

利用者が選択したロールは、持っていなければ付与、持っていれば解除されます。
複数同時に選べます。選んでいないロールは変更しません。
付与・解除結果は本人にだけ表示します。
メニューの選択表示は所有ロール一覧ではありません。同じロールを再度確定すると付け外しが実行されます。
パネルは複数作成できます。1つに最大25ロール。
作成には「サーバー管理」と「ロールの管理」が必要。
管理・モデレーション権限を持つロール、BOT管理ロール、@everyoneは配布できません。
登録後にロールへ管理権限が追加された場合も、パネルからは付与できません。

/rolepanel list：設置済みパネルのリンクとID
/rolepanel delete id:パネルID：パネルを無効化し、投稿を削除。付与済みロールは残る。
内容を変更したい場合は、新しいパネルを作成し、古いパネルをdeleteで無効化してください。

既存の /live role で指定した通知用ロールをパネルにも登録すれば、メンバーが通知の受け取りを選べます。
パネル設定はDATA_DIR内のrolepanels.jsonに保存されます。既存の /data Volumeをそのまま使用できます。
追加のVariables・データベース・特権Intentsは不要です。

## v1.2への更新
ZIPの中身を同じGitHubリポジトリに上書きしてください。
rolepanels.jsとDockerfileも必須です。デプロイログの Ready v1.2 を確認。
既存のVolumeを付けたまま更新すれば、LIVE設定とパネル設定を保持します。
ロール付与・解除、設定読み直し、権限変更時の拒否は模擬試験済み。実Discordでの接続試験は未実施。

## v1.3：複数ボタン式ロールパネル
ZIPの中身を同じGitHubに上書きしてデプロイ。Variablesの追加は不要。
/rolepanel create で投稿先・タイトル・説明文を設定し、管理者用のロール選択画面でボタンにするロールを選ぶ。
公開パネルは選択メニューではなく、1ロールにつき1個のボタンです（最大25個、5個×5行）。
メンバーは欲しいロールのボタンをそれぞれ押せます。複数のロールを同時に持てます。
持っているロールのボタンをもう一度押すと、そのロールだけ解除します。
ボタンの色は全員共通で、個人の所有状態は付与・解除時の本人専用メッセージで確認します。

既存パネルを変換：
1. /rolepanel list でパネルIDを確認。
2. /rolepanel buttons id:そのID で、同じ投稿をボタン式に変更。

旧選択メニューのパネルも引き続き操作可能です。
ボタン式への変更後も再起動をまたいで利用できます。
BOTの「ロールの管理」権限とロールの上下関係は従来どおり必要です。
