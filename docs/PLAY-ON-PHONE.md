# 外出先でスマホからプレイする

最終更新：令和8年7月30日

結論から。**自宅のWi-Fiで一度だけ開いてホーム画面に追加すれば、以後は電波が
無くても、外出先でもそのまま遊べます。** インターネット上への公開は不要です。

理由：このゲームは Service Worker（`sw.js`）を持つ PWA で、初回に**全ファイルを
端末内へ保存**します。2回目以降はネットワークを一切見ません。

---

## 手順（初回だけ。5分）

### 1. PC 側でサーバーを起動する

```
cd C:\Users\user\Desktop\homerun-derby
npm run build
python tools/make_sw_manifest.py     ← ビルド後に必ず実行（後述）
python -m http.server 8123
```

### 2. PC の LAN IP を調べる

```
ipconfig
```
`IPv4 アドレス` の `192.168.x.x` を控える。

### 3. スマホを同じ Wi-Fi につなぎ、Safari／Chrome で開く

```
http://192.168.x.x:8123/index.html
```

**`?nosw=1` を付けないこと。** これを付けると Service Worker が動かず、
端末に保存されません。

### 4. ホーム画面に追加する

- iPhone（Safari）：共有ボタン → 「ホーム画面に追加」
- Android（Chrome）：メニュー → 「アプリをインストール」

### 5. その場で機内モードにして、動くことを確かめる

ここを飛ばさないこと。**保存に失敗していても、Wi-Fi がある間は普通に動きます。**
機内モードで起動して遊べたら完了で、そのまま外へ持ち出せます。

---

## 更新したとき

コードを変えたら、上の 1〜3 をもう一度。ただし `sw.js` の `CACHE` の版
（`bhrd-v6` の数字）を上げないと、端末は古い版を出し続けます。

```
npm run build
python tools/make_sw_manifest.py
```

**`make_sw_manifest.py` を忘れると、外出先で起動しなくなります。**
`cache.addAll` は原子的で、1ファイルでも欠けると**何も保存されません**。
しかも自宅では正常に動くので気付けない。実際に、`batter.js`・`level.js`・
`logo_back.png` など29ファイルが抜けたまま放置されていました。
`tests/offline.test.ts` が検出するので、`npm test` を通すことでも防げます。

---

## 公開URLが欲しい場合（未実施・要判断）

「リンクを踏むだけ」にしたいなら公開ホスティングが要りますが、**まだやって
いません**。理由は2つ：

1. **技術的**：`gh` が未ログインで、こちらから公開できない。アカウント作成と
   ログインは代行できない
2. **中身**：`assets/` は3名の本人許諾を得た似顔絵、`src/core/constants.ts` は
   実名、背中には会社ロゴが入る。**社内利用の許諾と、全世界公開の許諾は別物**

やる場合の最短手順（takaya さんが実行）：

```
gh auth login                       ← ブラウザでGitHubにログイン
gh repo create homerun-derby --private --source=. --push
gh api repos/:owner/homerun-derby/pages -f source[branch]=main -f source[path]=/
```

`--private` でもGitHub Pagesは**公開URL**になります。閲覧を絞るなら
Cloudflare Pages + Cloudflare Access（メールアドレスで限定）を推奨します。
どちらにするかは判断を仰ぎます。

---

## うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| 黒い画面のまま | 30秒で診断カードが出る。UA・保存領域の可否・SWの状態が読める |
| 古い版が出る | `CACHE` の版を上げてPCで再ビルド、スマホで再読込 |
| 外出先だけ起動しない | 保存に失敗している。手順5をやっていない可能性が高い |
| 横向きで崩れる | 縦画面専用。回転を促す画面が出る |
| 電波が弱い場所で固まる | `sw.js` が2.5秒でネットワークを見切ってキャッシュに切り替える |
