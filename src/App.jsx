// src/App.jsx
import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";

import ParentLogin from "./pages/ParentLogin.jsx";
import ParentHome from "./pages/ParentHome.jsx";
import Coach from "./pages/Coach.jsx";
import Admin from "./pages/Admin.jsx";
import Scheduling from "./pages/Scheduling.jsx";

import { getParentKey, getTeamSlug } from "./auth/parentAuth";

function TopNav() {
  const { pathname } = useLocation();
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);

  // ✅ Consider BOTH routes as "Parent" for highlighting
  const isParent = pathname === "/parent" || pathname === "/parent-login";
  const isCoach = pathname === "/coach";
  const isAdmin = pathname === "/admin";
  const isScheduling = pathname === "/scheduling";

  // ✅ If parent already selected team + key, go straight to /parent.
  // Otherwise, go to /parent-login (matches what you’re seeing in prod).
  const hasKey = Boolean((getParentKey() || "").trim());
  const hasTeam = Boolean((getTeamSlug() || "").trim());
  const parentTo = hasKey && hasTeam ? "/parent" : "/parent-login";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function handleScroll() {
      const currentY = window.scrollY;
      const isMobile = window.innerWidth <= 520;

      if (!isMobile) {
        setMobileHeaderHidden(false);
        return;
      }

      setMobileHeaderHidden(currentY > 24);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [pathname]);

  return (
    <header className={`bgsl-header ${mobileHeaderHidden ? "is-mobile-hidden" : ""}`}>
      <div className="bgsl-header-inner">
        <div className="bgsl-brand">
          <img className="bgsl-logo" src="/bgsl-logo.png" alt="BGSL logo" />
          <div className="bgsl-title">Barrington Girls Softball</div>
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
            Play Walkup Songs
          </NavLink>

          <NavLink
            to="/admin"
            className={() => `bgsl-link ${isAdmin ? "active" : ""}`}
          >
            Admin
          </NavLink>

          <NavLink
            to="/scheduling"
            className={() => `bgsl-link ${isScheduling ? "active" : ""}`}
          >
            Field Scheduling
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  useEffect(() => {
    document.title = "BGSL";
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
          <Route path="/scheduling" element={<Scheduling />} />

          <Route path="*" element={<Navigate to="/parent-login" replace />} />
        </Routes>
      </main>
    </div>
  );
}
