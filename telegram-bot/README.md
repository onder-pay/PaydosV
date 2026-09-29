# Paydos Telegram Bot

Firebase Cloud Function (`telegramBot`, proje `paydos-crm`). Telegram'dan gelen pasaport/vize fotoğraflarını okuyup CRM'e işler; vize görseli gelince açık başvuruyu "Onay" durumuna alır.

Bot PC'de değil Firebase'de çalışır. Bu klasör kaynak kodun yedeği ve düzenleme yeridir.

## Deploy (PC'de)

```
cd telegram-bot/functions
npm install
cd ..
npx firebase-tools deploy --only functions:telegramBot
```

## Gizli bilgiler

- Telegram token ve AI anahtarı kodda değil, Firestore'daki ayar belgesinden okunur.
- `VIZE_EVRAK_SA` (servis hesabı) ortam değişkeni `.env` dosyasındadır; `.env` ve anahtar dosyaları `.gitignore` ile dışarıda tutulur, repoya eklenmez.
