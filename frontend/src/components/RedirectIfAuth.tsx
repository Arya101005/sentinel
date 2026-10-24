import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function RedirectIfAuth() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!ready) {
    return null;
  }

  if (user) {
    const from = (location.state as { from?: string } | undefined)?.from ?? "/";
    navigate(from, { replace: true });
    return null;
  }

  return null;
}
