# Aegis Http GPG Login (Google Chrome) | TR / [EN](README.md)

![Logo](icons/logo.png)

[![Available in the Chrome Web Store](https://developer.chrome.com/docs/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chromewebstore.google.com/detail/lappbcambkogfmigiphapgjcglafcfnd)

Aegis Http, web uygulamalarınızın gönderdiği veri trafiğini (POST, PUT vb.) arka planda tamamen şeffaf ve otonom bir şekilde PGP kullanarak şifreleyen bir Uçtan Uca Şifrelemeli (E2E) ağ geçidi Chrome uzantısıdır. Frontend (Angular, React, Vue vb.) kodlarınızda herhangi bir şifreleme mantığı kullanmadan veri trafiğini güvence altına alır.

## Özellikler

- **Şeffaf Yakalama:** `XMLHttpRequest` çağrılarını otomatik yakalar ve araya girer. Frontend geliştiricilerinin projesinde extra PGP paketi kullanmasına gerek yoktur.
- **Ayrıştırılmış Güvenlik (Native Messaging):** PGP özel anahtarınız (Private Key) asla JavaScript belleğine çekilmez ve tarayıcıya girmez. Chrome'un yerleşik Native Messaging köprüsü ile güvenli bir Rust daemon arka plan servisiyle iletişim kurar.
- **Otonom Çözme:** Çıkan şifreli izlere dönen sunucu yanıtları da PGP şifreli geldiğinde; bu eklenti otomatik olarak yerel köprüden deşifre eder ve sayfanıza ham JSON verisini iade eder.

## Kurulum

1. Chrome tarayıcınızdan `chrome://extensions/` adresine gidin.
2. Sağ üstten **Geliştirici modu (Developer mode)** anahtarını açın.
3. **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın ve bu klasörü (`/google-chrome-extension`) seçin.
4. **Native Host daemon servisinizin kurulduğundan emin olun!** Aksi takdirde, uzantınız arka plandaki GPG servisine mesaj gönderemez ve işlemleriniz şifrelenemez.

## Klasör Yapısı

- `manifest.json`: Manifest v3 standardında Chrome tanımlaması (_nativeMessaging_ izni dahil).
- `background.js`: Content script'leri ve Rust tabanlı yerel process arasında haberleşmeyi sağlayan kalıcı Service Worker.
- `content.js`: Yetkili sitelerde `inject.js` komut setini site DOM'una izole olmayan şekilde enjekte eder.
- `inject.js`: Tarayıcınızdaki `XMLHttpRequest.prototype` işlevlerini ezen, yüksek ayrıcalıklı Proxy/Interceptor dosyasıdır.
- `icons/`: Tarayıcı eklentisindeki UI gösterimleri için optimize edilmiş marka ikonları.
