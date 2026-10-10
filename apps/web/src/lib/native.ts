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

/** Saves through the Android bridge; resolves to the saved location ("" when
 * it failed). The app toasts the result itself, so a caller that toasts too
 * would say it twice. */
export async function androidSave(bridge: AndroidBridge, blob: Blob, fileName: string): Promise<string> {
  return bridge.saveFile(await blobToBase64(blob), fileName, blob.type || "application/octet-stream");
}

/** Whether a file like this can go through the system share sheet here: the
 * Android app's, or the browser's (Web Share, which only takes some file types). */
export function canShareFile(fileName: string, mime: string): boolean {
  if (androidBridge()) return true;
  try {
    const probe = new File([new Blob()], fileName, { type: mime });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Opens the system share sheet with one file. Resolves once it is open (or the
 * person dismissed it); rejects when the file could not be handed over. A
 * browser wants this called straight from a tap, not after a long wait. */
export async function shareBlob(blob: Blob, fileName: string, title: string): Promise<void> {
  const android = androidBridge();
  if (android) {
    android.shareFile(await blobToBase64(blob), fileName, blob.type || "application/octet-stream", title);
    return;
  }
  try {
    await navigator.share({ files: [new File([blob], fileName, { type: blob.type })], title });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // dismissed
    throw e;
  }
}
