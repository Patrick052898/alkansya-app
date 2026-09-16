# Alkansya

Libreta ng pamilya para sa kita at gastos — isang simpleng, self-hosted
household budget tracker. Gumawa o sumali sa isang "sambahayan" gamit ang
isang code, magtala ng kita/gastos, magtakda ng buwanang budget per
kategorya, at makita ang lahat ng ito nang live sa lahat ng miyembro.

## Paano gamitin nang lokal

```bash
npm install
npm start
```

Bubukas ang app sa `http://localhost:3000`.

## Paano i-deploy sa Render

1. I-push ang folder na ito sa isang GitHub repo (kasama ang `server.js`,
   `package.json`, at ang `public/` folder — huwag isama ang `node_modules/`
   o `data/households.json`, nasa `.gitignore` na ang mga iyon).
2. Sa [Render](https://render.com), gumawa ng bagong **Web Service** at
   ikonekta ang repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
4. I-deploy. Ibibigay sa iyo ni Render ang isang URL (hal.
   `https://alkansya.onrender.com`) — iyan na ang link na maishe-share mo
   sa pamilya.

### Tungkol sa pag-iimbak ng datos (mahalaga)

Ginagamit ng app na ito ang isang simpleng JSON file
(`data/households.json`) bilang storage — sapat na ito para sa personal o
pamilyang gamit. Sa Render, **mababawi ang laman ng disk sa bawat bagong
deploy** maliban kung mag-attach ka ng
[Persistent Disk](https://render.com/docs/disks) at itinuro mo ang
`DATA_DIR` doon (tingnan ang `server.js` — baguhin ang `DATA_DIR` para
tumuro sa mount path ng disk, hal. `/var/data`). Kung gusto mong mas
matatag na storage (hal. maraming sambahayan, mas malaking trapiko),
palitan ang JSON file ng tunay na database tulad ng Postgres — may libreng
tier din ang Render para dito.

## Istraktura ng proyekto

```
alkansya-app/
├── server.js          # Express API + static file server
├── package.json
├── public/
│   └── index.html     # buong frontend (walang build step)
└── data/
    └── households.json  # simpleng JSON storage
```

## Tungkol sa "real-time" updates

Nag-po-poll ang bawat browser tab ng bagong datos bawat 4 segundo habang
bukas ang dashboard, kaya makikita ng ibang miyembro ang bagong tala sa
loob ng ilang segundo — hindi ito instant tulad ng WebSockets, pero sapat
na para sa isang family budget app.

## Seguridad

Walang password/login system ang app na ito — ang access ay batay sa
sinong may hawak ng link at ng household code (tulad ng isang shared na
Google Sheet). Huwag i-publish ang link nang pampubliko kung sensitibo
ang datos ng inyong pamilya.
