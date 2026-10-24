import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../lib/auth";
import Login from "../pages/Login";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Dashboard home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Login", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the login form and demo hints", () => {
    renderLogin();
    expect(screen.getByTestId("username")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/Synthetic demo accounts/i)).toBeInTheDocument();
  });

  it("stores the session on successful login and navigates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
      json: async () => ({
        access_token: "test-token",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: 1,
          display_name: "Officer",
          email: "officer@example.com",
          role: "officer",
          is_active: true,
          is_competent_authority: false,
          created_at: "2026-01-01T00:00:00",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLogin();
    await userEvent.type(screen.getByTestId("username"), "officer");
    await userEvent.type(screen.getByTestId("password"), "Demo@Sentinel123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Dashboard home")).toBeInTheDocument();
    expect(localStorage.getItem("fdr_sentinel_token")).toBe("test-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error message on invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => "application/json" },
        json: async () => ({ detail: { code: "invalid_credentials", message: "Incorrect username or password." } }),
      }),
    );

    renderLogin();
    await userEvent.type(screen.getByTestId("username"), "admin");
    await userEvent.type(screen.getByTestId("password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/Incorrect username or password/i)).toBeInTheDocument();
    expect(localStorage.getItem("fdr_sentinel_token")).toBeNull();
  });
});
