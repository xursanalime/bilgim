# MinIO → Cloudflare R2 ko'chirish

Platformaning barcha fayllari (yuklangan video/rasm/PDF, HLS transcoding
natijasi, jonli dars yozuvlari) `R2Service` orqali saqlanadi. Bu servis
Cloudflare R2 uchun yozilgan; MinIO shunchaki S3-mos emulyator sifatida
ishlatilgan. Shuning uchun **kodni o'zgartirish shart emas** — faqat env
o'zgaruvchilari almashadi.

## Nima uchun ko'chiriladi

Railway'dagi `minio-volume` 500 MB. Bitta 20 soniyalik video taxminan
56 MB egallaydi:

| Nima | Hajm |
| --- | --- |
| Original fayl | ~34 MB |
| HLS ladder (240p + 480p + 720p + 1080p) | ~22 MB |

Ya'ni volume'ga ~8 ta qisqa video sig'adi. R2 bepul rejasi 10 GB beradi —
taxminan 180 ta shunday video.

## Cloudflare tomonida

1. Cloudflare dashboard → **R2** → **Create bucket** (masalan `bilgim-media`).
   Hudud: Automatic.
2. **R2 → Manage API Tokens → Create API token**.
   - Ruxsat: **Object Read & Write**
   - Bucket: yuqorida yaratilgan bucket
   - Yaratilgandan keyin **Access Key ID** va **Secret Access Key**
     ko'rsatiladi — secret faqat bir marta ko'rinadi.
3. **Account ID** ni R2 overview sahifasidan oling. Bu token ID emas.

## Railway tomonida (`api` servisi)

```
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
R2_BUCKET_NAME=bilgim-media
R2_PUBLIC_URL=
```

`R2_PUBLIC_URL` **bo'sh bo'lishi shart**. Bo'sh bo'lganda kod
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` manzilini ishlatadi;
qiymat berilsa u butun stack'ni o'sha manzilga yo'naltiradi (MinIO uchun
aynan shu ishlatilgan).

Ko'chirish tugagach Railway'dan `minio` servisini va `minio-volume` ni
o'chirsa bo'ladi.

### Noto'g'ri sozlashdan himoya

`NODE_ENV=production` bo'lganda uchta kalitdan biri yo'q bo'lsa yoki
`local-dev` qiymatida qolsa, API **ishga tushmaydi** va qaysi
o'zgaruvchi yetishmayotganini aytadi. Busiz ilova sog'lom ko'rinib
ishga tushardi-yu, har bir yuklash va ijro tushunarsiz
`SignatureDoesNotMatch` bilan yiqilardi.

## Mavjud fayllar

Env almashtirish eski fayllarni ko'chirmaydi — MinIO'dagi videolar va
rasmlar yangi bucket'da bo'lmaydi va ishlamay qoladi. Sinov ma'lumotlari
bo'lsa e'tibor bermasa ham bo'ladi; aks holda `rclone` bilan ko'chiring:

```bash
rclone config create minio s3 provider=Minio \
  endpoint=<minio-url> access_key_id=<key> secret_access_key=<secret>
rclone config create r2 s3 provider=Cloudflare \
  endpoint=https://<account-id>.r2.cloudflarestorage.com \
  access_key_id=<key> secret_access_key=<secret>

rclone copy minio:edubridge-media r2:bilgim-media --progress
```

## Bepul reja limitlari

| Nima | Limit / oy | Oshsa |
| --- | --- | --- |
| Saqlash | 10 GB | $0.015/GB |
| Class A (yozish: upload, list) | 1 mln | $4.50/mln |
| Class B (o'qish) | 10 mln | $0.36/mln |
| Egress | cheksiz bepul | — |

Operatsiyalar bo'yicha zaxira katta: bitta 20 soniyalik video ko'rilishi
~5 ta Class B so'rov (master + variant playlist + segmentlar), ya'ni
10 mln limit oyiga ~2 mln ko'rishga yetadi.

**Diqqat:** HLS segmentlari `MediaStreamController` orqali proksi
qilinadi, ya'ni trafik R2 → API → foydalanuvchi yo'nalishida boradi.
R2 egress'i bepul, lekin Railway chiqish trafigi hisoblanadi.

## Lokal ishlab chiqish

O'zgarmaydi — `infra/docker/docker-compose.yml` hamon MinIO ko'taradi.
Lokal `.env` da:

```
R2_PUBLIC_URL="http://localhost:9000"
```
