// MotoLink web sürümü ayarları (Android uygulamasındaki AppConfig ile aynı değerler)
window.MOTOLINK = {
  // Google Apps Script sunucusu (.../exec)
  SERVER: "https://script.google.com/macros/s/AKfycbylhuInIk-rgM2V6kU7mD59I0PkFKwUsd-xb0lp3mj4TNQBgJiCTGv_V-nlvk3HiUqAPw/exec",
  // Apps Script'teki APP_KEY ile aynı
  KEY: "P2ipkBcreueb1nFvKRLPiW7xmmqK38cL",
  VERSION: "web 1.1.10",
  MAX_RIDERS: 50,
  // 1.1.8: iPhone / web bildirimleri (Firebase, ücretsiz). Firebase panelinden alınan değerler.
  // Boş kalırsa bildirim düğmesi çıkmaz, uygulama yine çalışır.
  FIREBASE: {
    apiKey: "AIzaSyBtKTm7NgcyRopy0RxVshsytSht-0y83yw",
    projectId: "motolink-8d517",
    senderId: "266394834782",
    appId: "1:266394834782:web:306f81a46581d01223a1cf",
    vapidKey: "BN7D5h7OBlaUpRaslx8YUAQFMC_VFKn9HLjSY-Ico2CCUtwQCJ5tygFODpv864HjaiuQnshFx96PLReuMtBJjGs"
  }
};
