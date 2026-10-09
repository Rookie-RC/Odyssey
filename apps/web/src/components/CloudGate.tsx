"use client";

// Decides between the Atlas and the sign-in screen.
//
// Local mode (the single-user runtime on this computer) goes straight to the
// Atlas, as before. In cloud mode (the multi-user web service) a visitor
// without a session sees AuthScreen; once signed in, the Atlas mounts keyed
// by the account, so switching accounts never shows the previous one's data.
// Any data request answering 401 later on (signed out elsewhere, session
// expired) brings the sign-in screen back.
import { useCallback, useEffect, useState } from "react";
import AtlasApp from "./AtlasApp";
import AuthScreen from "./AuthScreen";
import { api, UNAUTHORIZED_EVENT, type AccountUser } from "../lib/api";

type GateState =
  | { kind: "checking" }
  | { kind: "atlas"; key: string }
  | { kind: "auth"; allowSignup: boolean };

export default function CloudGate() {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  const check = useCallback(async () => {
    try {
      const rt = await api.getRuntime();
      if (rt.mode === "cloud" && !rt.authenticated) {
        setState({ kind: "auth", allowSignup: rt.allowSignup ?? false });
      } else {
        setState({ kind: "atlas", key: rt.user?.id ?? "local" });
      }
    } catch {
      // Runtime unreachable: let the Atlas show its own load error, as it
      // always has.
      setState({ kind: "atlas", key: "local" });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const onUnauthorized = () => {
      setState((s) => (s.kind === "auth" ? s : { kind: "checking" }));
      check();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [check]);

  const onSignedIn = useCallback((user: AccountUser) => {
    setState({ kind: "atlas", key: user.id });
  }, []);

  if (state.kind === "checking") return <div className="atlas-auth-splash" aria-busy="true" />;
  if (state.kind === "auth") return <AuthScreen allowSignup={state.allowSignup} onSignedIn={onSignedIn} />;
  return <AtlasApp key={state.key} />;
}
