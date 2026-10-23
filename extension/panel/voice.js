// Voice input via the browser's speech recognition. Some Chromium browsers don't
// ship the speech service, and side panels can't show the microphone prompt, so the
// first use may open a small tab to grant microphone access.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = !!Recognition;

let active = null;

export function listening() {
  return !!active;
}

// onText(text, final) receives the running transcript; onEnd(error?) when it stops.
export function start({ onText, onEnd }) {
  if (!Recognition) {
    onEnd("Voice input isn't available in this browser.");
    return;
  }
  const rec = new Recognition();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText(finalText + interim, !interim);
  };
  rec.onerror = (e) => {
    active = null;
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
      onEnd("Allow microphone access in the tab that just opened, then try again.");
    } else if (e.error === "network") {
      onEnd("This browser's speech service isn't reachable, so voice input won't work here.");
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      onEnd(`Voice input stopped: ${e.error}`);
    } else onEnd();
  };
  rec.onend = () => {
    if (active === rec) {
      active = null;
      onEnd();
    }
  };
  active = rec;
  rec.start();
}

export function stop() {
  active?.stop();
}
