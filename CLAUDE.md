# Paydos CRM — çalışma kuralları

## Türkçe karakter kuralı (zorunlu, her yerde aynı)

JavaScript'in varsayılan büyük/küçük harf işlemleri Türkçe'yi bozar:
`"İ".toLowerCase()` → `"i̇"` (noktalı, görünmez artık karakter), `"i".toUpperCase()` → `"I"` (İ değil),
`/iptal/i` → `"İptal"` ile **eşleşmez**. Bu yüzden:

### 1. Karşılaştırma, arama, eşleştirme → `normalizeTr`
- İki taraf da `normalizeTr(x)` ile ASCII küçük harfe indirilir: `İ I ı → i`, `ş → s`, `ğ → g`, `ü → u`, `ö → o`, `ç → c`.
  `"İptal"`, `"IPTAL"`, `"iptal"`, `"Müşteri İptal Etti"` → hepsi `iptal` içerir.
- Kısayol: `trHas(metin, 'kelime1', 'kelime2')` — metin kelimelerden birini içeriyor mu.
- **Yasak:** Türkçe olabilecek metinde `.toLowerCase()` / `.toUpperCase()` ile karşılaştırma, `/…/i` düzenli ifade.
  Düzenli ifade gerekiyorsa: `/ascii desen/.test(normalizeTr(metin))` (desen ASCII ve küçük harf: `cift`, `uclu`, `ertesi`).
- Bot (telegram-bot/functions) aynı yardımcıları **`tr.js`**'den alır (`normTr`, `trHas`, `titleCaseTr`, `nameForSave`, `normEmail`, `statusLabels`)
  — dosyada yeniden tanımlamayın. Link sayfaları (public/*.html) `nk()` ile aynı ASCII katlamayı yapar.
- Durum etiketiyle sorgu/eşitlik: ayarlardaki yazım farklı olabilir ("ATAMA BEKLİYOR") → `statusLabels(settings, 'Atama Bekliyor')` ile `where('status','in', …)`.

### 2. Gösterim → yerel ayarlı dönüşüm
- Büyük harf: `trUpper(x)` = `toLocaleUpperCase('tr-TR')` (`"şahin"` → `"ŞAHİN"`).
- Küçük harf: `trLower(x)` = `toLocaleLowerCase('tr-TR')`.
- İsim / şehir: `titleCaseTr(x)` (`"İSMAİL GEDİKOĞLU"` → `"İsmail Gedikoğlu"`).
  Metinde hiç Türkçe harf yoksa (`"ISMAIL GEDIKOGLU"`, pasaport MRZ / ASCII Excel) `I` = `i` kabul edilir → `"İsmail Gedikoglu"`;
  `I`'yı `ı` yapıp `"Ismaıl Gedıkoglu"` üretmek YASAK.
- Sıralama: `a.localeCompare(b, 'tr')`.

### 3. Kayıt → olduğu gibi
- Kullanıcının yazdığı Türkçe harfler değiştirilmeden saklanır.
- İsim kaydı her zaman `nameForSave(x)`: Türkçe harfsiz, BÜYÜK harfli ve `I` içeren isim (`"ISMAIL"`, `"YILMAZ"`) **olduğu gibi** kalır
  (I'nın i mi ı mı olduğu bilinemez — tahmin edip kaydı bozmayın). Diğerleri `titleCaseTr` ile kaydedilir.
- Sabit değerler CRM'deki listeyle birebir yazılır (`'Yeşil Pasaport (Hususi)'`, `'Türkiye'`); okurken yine `trHas(x, 'yesil')`.
- ASCII'ye çevirme (`asciiTr`) yalnızca dış sistem gerektirdiğinde: MRZ/pasaport okuma, dosya adı, Türkçe fontu olmayan PDF yedeği.
- E-posta her zaman `normEmail(x)`: Türkçe klavyede yazılan `"İnfo@…"` → `"info@…"`.

### 4. Türkçe harften üretilen kayıtlı anahtarlar (istisna — değiştirmeyin)
- Tur oda fiyat anahtarları (`tek_kiilik`, `doubleRoom` …): üretim ve okuma aynı eski fonksiyonla yapılır; değiştirmek mevcut tur fiyatlarını bozar.
- Özel müşteri alanları: yeni anahtar `fieldKeyTr`, okurken `extraFieldVal` eski (`fieldKeyLegacy`) anahtara da bakar.
- Yeni bir kayıtlı anahtar üretirken `normalizeTr` tabanlı üretin; eskisini değiştirecekseniz geriye uyumlu okuma ekleyin.

### Kontrol
Yeni kodda Türkçe metinle karşılaştırma yapan her satır için: "Bu `İ`/`ı`/`I` ile ve BÜYÜK HARFLE yazılmış haliyle de çalışır mı?"
Örnek test girdileri: `İptal`, `IPTAL`, `ÇİFT`, `ALMANYA TİCARİ`, `TÜRKİYE`, `İstanbul`, `ISTANBUL`.
