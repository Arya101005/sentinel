import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearSession, getStoredUser, getToken, setSession, type User } from "./api";

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const ROLE_LABELS: Record<string, string> = {
  admin: "System Administrator",
  officer: "AICTE Officer",
  institution: "Institution User",
  auditor: "Read-Only Auditor",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser<User>());
  const [ready, setReady] = useState(false);

  // Validate any stored session once on mount (handles expiry gracefully).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (getToken()) {
        try {
          const me = await api.get<User>("/auth/me");
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) {
            clearSession();
            setUser(null);
          }
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>("/auth/login", {
      username,
      password,
    });
    setSession(res.access_token, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isStaff(role?: string | null): boolean {
  return role === "admin" || role === "officer" || role === "auditor";
}
export function canEdit(role?: string | null): boolean {
  return role === "admin" || role === "officer" || role === "institution";
}
export function isOfficer(role?: string | null): boolean {
  return role === "admin" || role === "officer";
}
