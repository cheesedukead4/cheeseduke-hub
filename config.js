/*
 * 倉儲 IT 整合中心｜設定（這個檔案任何人都看得到，不要放密碼）
 *
 * WI_AUTH.clientId：本 App 的 Google Cloud「OAuth 用戶端 ID」（網頁應用程式類型），是公開資訊。
 *   建立方式見「使用說明.md」第 1 步。雲端後端（雲端後端/Code.gs）的 GOOGLE_CLIENT_ID_ 也要填同一個 ID。
 * WI_CLOUD.url：本 App 的 Apps Script 網頁應用程式網址（結尾 /exec），見「使用說明.md」第 2 步。
 */
window.WI_AUTH = {
  clientId: '108931232819-5iv3i1uf96nhq0ihlbtq9thh17em2jn8.apps.googleusercontent.com'
};

window.WI_CLOUD = {
  url: 'https://script.google.com/macros/s/AKfycbx2EWf23Q_9Ahv6p19_4Z_GzUWk-B5hLFCgv4gbl3wMOA7U0lKvjqYE_kRz81q8AWrrnQ/exec'
};
