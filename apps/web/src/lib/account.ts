// Session helpers for cloud mode (see components/CloudGate.tsx).
import { api } from "./api";

/** Ends this browser's session (or every session of the account) and starts
 * over from a clean page, so nothing of the account stays in memory. */
export async function signOut(everywhere = false): Promise<void> {
  try {
    await api.auth.logout(everywhere);
  } finally {
    window.location.replace("/");
  }
}
