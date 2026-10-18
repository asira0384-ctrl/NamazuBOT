# TikTok LIVE通知BOT v1.0
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
- 約60秒間隔（通信時間により遅れる）で公開配信の状態を確認。
- TikTok Live Connector 2.5.0を使用する非公式検知です。TikTokの仕様変更、アクセス制限、
  RailwayのIP、限定配信などにより検知できない場合があります。
- 未配信と取得エラーを区別して表示します。エラーは /live status とRailwayログで確認。
- 自動検知の配信IDを保存して同じ配信の繰り返し通知を抑えます。
- BOT起動時に既に配信中でも、その配信IDが未通知なら通知します。
- 通常はAPIキーなしで試せます。ライブラリがEuler Streamへのフォールバックを必要とする場合、
  https://www.eulerstream.com で適切なAPI利用権限を持つキーを取得し、SIGN_API_KEYに設定できます。
  キーを追加しても必ず検知できる保証はなく、サービス側の利用条件・料金を確認してください。
- 自動検知できない場合も /live notify で通知可能。これは手動であり自動検知の代替ではありません。
  別の既製TikTok通知サービスへの接続はこのZIPには含めていません。
- 手動通知は60秒に1回。手動通知から10分以内に初めて検知した配信は追加通知を省略します。
- Discord送信直後・保存直前の異常終了などでは重複する余地があります。
- 実際のTikTokアカウント・Discordトークンでの接続試験は未実施です。
