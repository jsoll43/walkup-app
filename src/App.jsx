// src/App.jsx
import { useEffect, useMemo } from "react";
import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";

import ParentLogin from "./pages/ParentLogin.jsx";
import ParentHome from "./pages/ParentHome.jsx";
import Coach from "./pages/Coach.jsx";
import Admin from "./pages/Admin.jsx";

import { getParentKey, getTeamSlug } from "./auth/parentAuth";

function TopNav() {
  const { pathname } = useLocation();

  // ✅ Consider BOTH routes as "Parent" for highlighting
  const isParent = pathname === "/parent" || pathname === "/parent-login";
  const isCoach = pathname === "/coach";
  const isAdmin = pathname === "/admin";

  // ✅ If parent already selected team + key, go straight to /parent.
  // Otherwise, go to /parent-login (matches what you’re seeing in prod).
  const parentTo = useMemo(() => {
    const hasKey = Boolean((getParentKey() || "").trim());
    const hasTeam = Boolean((getTeamSlug() || "").trim());
    return hasKey && hasTeam ? "/parent" : "/parent-login";
  }, [pathname]); // recompute when route changes (cheap + keeps it fresh)

  return (
    <header className="bgsl-header">
      <div className="bgsl-header-inner">
        <div className="bgsl-brand">
          <img className="bgsl-logo" src="/bgsl-logo.png" alt="BGSL logo" />
          <div className="bgsl-title">Barrington Girls Softball Walk-up App</div>
        </div>

        <nav className="bgsl-nav">
          <NavLink
            to={parentTo}
            className={() => `bgsl-link ${isParent ? "active" : ""}`}
          >
            Parent
          </NavLink>

          <NavLink
            to="/coach"
            className={() => `bgsl-link ${isCoach ? "active" : ""}`}
          >
            Coach
          </NavLink>

          <NavLink
            to="/admin"
            className={() => `bgsl-link ${isAdmin ? "active" : ""}`}
          >
            Admin
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  useEffect(() => {
    document.title = "Barrington Girls Softball Walk-up App";
  }, []);

  return (
    <div className="bgsl-app">
      <TopNav />
      <main className="bgsl-main">
        <Routes>
          {/* ✅ Send base URL to the screen users actually see first */}
          <Route path="/" element={<Navigate to="/parent-login" replace />} />

          <Route path="/parent-login" element={<ParentLogin />} />
          <Route path="/parent" element={<ParentHome />} />

          <Route path="/coach" element={<Coach />} />
          <Route path="/admin" element={<Admin />} />

          <Route path="*" element={<Navigate to="/parent-login" replace />} />
        </Routes>
      </main>
    </div>
  );
}
