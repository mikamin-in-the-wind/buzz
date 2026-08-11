# BUZZ!!

Discord と YouTube Live のコメントを Google Cloud Text-to-Speech で読み上げます。Electron は使用せず、Node.js のローカル Web サーバーと既定ブラウザだけで動く軽量構成です。

## 起動

```bash
npm install
npm start
```

`http://127.0.0.1:3210` をブラウザで開いてください。ポートは `PORT=3211 npm start` のように変更できます。

Google Cloud で Cloud Text-to-Speech と Cloud Translation を有効にし、課金アカウントをリンクしたサービスアカウント JSON の絶対パスを画面へ入力します。設定は OS のアプリデータフォルダに保存され、音声の一時ファイルも同じ場所に保存・再生後に削除されます。

## 音声と料金

既定は高品質な `ja-JP-Chirp3-HD-Aoede` です。Chirp 3: HD は日本語を含む多言語に対応し、月100万文字まで無料です。Gemini TTS は無料枠がありません。

## Discord コマンド

- `/buzz join` — 実行者がいるボイスチャンネルに参加
- `/buzz shutdown` — ボイスチャンネルから退出
- `/buzz speak ja-JP こんにちは` — 任意のテキストを読み上げ
- `/buzz translate en-US ja-JP hello` — 原文と翻訳を順に読み上げ
- `/buzz choice 赤,青,緑` — 候補からランダムに選ぶ

言語コードは BCP 47 形式（例: `ja-JP`, `en-US`, `cmn-CN`, `ru-RU`）を使います。

## YouTube 投稿者ごとの音声

YouTube Live の投稿者はコメントで自分用の音声を選択できます。選択は公開チャンネルIDに紐づけて保存され、表示名が変わっても維持されます。

- `/buzz voice kore` — 話者名を指定して変更（30種類）
- `/buzz voice female` — Aoede（女性）のショートカット
- `/buzz voice male` — Achird（男性）のショートカット
- `/buzz voice default` — 標準音声へ戻す
