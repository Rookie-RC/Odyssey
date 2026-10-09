// The Android app (apps/android) hosts this same frontend in a WebView, with
// the local runtime running on the phone. A WebView cannot save a blob: link
// or open the system share sheet by itself, so the app exposes a small bridge
// as window.OdysseyAndroid; everywhere else these helpers fall back to what a
// browser does.

interface AndroidBridge {
  /** Saves a file to the phone's Downloads; returns where it went. */
  saveFile(base64: string, fileName: string, mime: string): string;
  /** Opens the system share sheet with one file (WeChat, Xiaohongshu …). */
  shareFile(base64: string, fileName: string, mime: string, title: string): void;
}

export function androidBridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { OdysseyAndroid?: AndroidBridge }).OdysseyAndroid;
  return b && typeof b.saveFile === "function" ? b : null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("could not read the file"));
    r.readAsDataURL(blob);
  });
}

/** Saves through the Android bridge; resolves to the saved location. */
export async function androidSave(bridge: AndroidBridge, blob: Blob, fileName: string): Promise<string> {
  return bridge.saveFile(await blobToBase64(blob), fileName, blob.type || "application/octet-stream");
}

export async function androidShare(bridge: AndroidBridge, blob: Blob, fileName: string, title: string): Promise<void> {
  bridge.shareFile(await blobToBase64(blob), fileName, blob.type || "application/octet-stream", title);
}
