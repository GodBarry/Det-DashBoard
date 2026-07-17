import { useEffect, useState } from "react";

import {
  clearSession,
  login,
  logout,
  me,
  readSession,
  register,
  UNAUTHORIZED_EVENT,
} from "../../api-client.js";

export function submitAuth({ mode, credentials }) {
  return mode === "login" ? login(credentials) : register(credentials);
}

export function useAuthSessionController() {
  const [currentUser, setCurrentUser] = useState(() => readSession());
  const [authMode, setAuthMode] = useState(() => (
    window.localStorage.getItem("det-dashboard-user") ? null : "login"
  ));

  const signOut = async () => {
    await logout().catch(() => clearSession());
    setCurrentUser(null);
    setAuthMode("login");
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      clearSession();
      setCurrentUser(null);
      setAuthMode("login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    me()
      .then(() => setCurrentUser(readSession()))
      .catch(() => {});
  }, [currentUser?.token]);

  return {
    authMode,
    currentUser,
    setAuthMode,
    setCurrentUser,
    signOut,
  };
}
