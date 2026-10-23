// Side panels can't show the microphone permission prompt, so voice input sends the
// user here once. Granting it here grants it to the whole extension, panel included.
const status = document.getElementById("status");
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    stream.getTracks().forEach((t) => t.stop());
    status.className = "ok";
    status.textContent = "Microphone allowed. You can close this tab and use voice input in the sidebar.";
    setTimeout(() => window.close(), 2500);
  })
  .catch((e) => {
    status.className = "err";
    status.textContent = `Microphone not allowed (${e.name}). Allow it from the address bar's site settings, then reload this tab.`;
  });
