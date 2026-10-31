import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { getProfile, updateProfile } from "../../api/profile.js";
import { ProfileContext } from "./profileState.js";

// The signed-in reader's own profile, loaded once per session and shared by the hub, the lists and the one-time sheet.
export function ProfileProvider({ children }) {
  const auth = useAuth();
  const key = auth.isAuthenticated ? String(auth.sessionGeneration) : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: "", attempt: 0, profile: null, failed: false });
  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    getProfile().then(
      profile => { if (active) setState({ key, attempt, profile, failed: false }); },
      () => { if (active) setState({ key, attempt, profile: null, failed: true }); },
    );
    return () => { active = false; };
  }, [key, attempt]);
  const current = state.key === key && state.attempt === attempt;
  const save = useCallback(async changes => {
    const profile = await updateProfile(changes);
    setState(previous => ({ ...previous, profile, failed: false }));
    return profile;
  }, []);
  const value = useMemo(() => ({
    profile: key ? state.profile : null,
    loading: Boolean(key) && !current,
    failed: Boolean(key) && current && state.failed,
    reload: () => setAttempt(value => value + 1),
    save,
  }), [key, state, current, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
