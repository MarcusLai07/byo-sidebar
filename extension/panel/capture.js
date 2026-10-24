// Screen capture into the chat, for things Lumen can't read directly: another
// extension's popup, a native app, a video frame. The order matters because
// extension popups close as soon as they lose focus:
//   1. you pick a screen or window in the browser's picker,
//   2. a countdown runs while you open what you want captured,
//   3. one frame is grabbed and sharing stops immediately.

const MAX_WIDTH = 1920;

function pickSource() {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture) return reject(new Error("Screen capture isn't available in this browser."));
    chrome.desktopCapture.chooseDesktopMedia(["screen", "window"], (streamId) => {
      if (streamId) resolve(streamId);
      else reject(new Error("Capture cancelled."));
    });
  });
}

async function grabFrame(stream) {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // Let the first real frame arrive.
  await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 200)));
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  video.pause();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// onTick(secondsLeft) runs once a second during the countdown (0 = capturing now).
// Returns an image attachment, or throws (cancelled, permission denied…).
export async function captureScreen({ seconds = 4, label = "Screen capture", onTick = () => {}, signal } = {}) {
  const streamId = await pickSource();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: streamId, maxWidth: 3840, maxHeight: 2160 } },
    });
  } catch (e) {
    throw new Error(
      e.name === "NotAllowedError"
        ? "The browser isn't allowed to record the screen. On macOS: System Settings → Privacy & Security → Screen Recording → turn on your browser, then restart it."
        : `Couldn't start the capture: ${e.message}`
    );
  }
  try {
    for (let s = seconds; s > 0; s--) {
      if (signal?.aborted) throw new Error("Capture cancelled.");
      onTick(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (signal?.aborted) throw new Error("Capture cancelled.");
    onTick(0);
    await new Promise((r) => setTimeout(r, 180)); // let the countdown overlay disappear first
    const url = await grabFrame(stream);
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { kind: "image", mime: "image/jpeg", name: `${label} ${time}`, data: url.split(",")[1] };
  } finally {
    stream.getTracks().forEach((t) => t.stop()); // stop sharing right away
  }
}
