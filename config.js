// MotoLink web sürümü ayarları (Android uygulamasındaki AppConfig ile aynı değerler)
window.MOTOLINK = {
  // Google Apps Script sunucusu (.../exec)
  SERVER: "https://script.google.com/macros/s/AKfycbylhuInIk-rgM2V6kU7mD59I0PkFKwUsd-xb0lp3mj4TNQBgJiCTGv_V-nlvk3HiUqAPw/exec",
  // Apps Script'teki APP_KEY ile aynı
  KEY: "P2ipkBcreueb1nFvKRLPiW7xmmqK38cL",
  VERSION: "web 1.1.9",
  MAX_RIDERS: 50,
  // 1.1.8: iPhone / web bildirimleri (Firebase, ücretsiz). Firebase panelinden alınan değerler.
  // Boş kalırsa bildirim düğmesi çıkmaz, uygulama yine çalışır.
  FIREBASE: {
    apiKey: "",
    projectId: "motolink-8d517",
    senderId: "266394834782",
    appId: "",
    vapidKey: ""
  }
};
