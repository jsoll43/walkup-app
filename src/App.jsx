// src/App.jsx
import { useEffect } from "react";
import { Routes, Route, Navigate, NavLink } from "react-router-dom";

import ParentLogin from "./pages/ParentLogin.jsx";
import ParentHome from "./pages/ParentHome.jsx";
import Coach from "./pages/Coach.jsx";
import Admin from "./pages/Admin.jsx";

function TopNav() {
  return (
    <header className="bgsl-header">
      <div className="bgsl-header-inner">
        <div className="bgsl-brand">
          <img className="bgsl-logo" src="/bgsl-logo.png" alt="BGSL logo" />
          <div className="bgsl-title">Barrington Girls Softball Walk-up App</div>
        </div>

        <nav className="bgsl-nav">
          <NavLink className={({ isActive }) => `bgsl-link ${isActive ? "active" : ""}`} to="/parent">
            Parent
          </NavLink>
          <NavLink className={({ isActive }) => `bgsl-link ${isActive ? "active" : ""}`} to="/coach">
            Coach
          </NavLink>
          <NavLink className={({ isActive }) => `bgsl-link ${isActive ? "active" : ""}`} to="/admin">
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
          <Route path="/" element={<Navigate to="/parent" replace />} />
          <Route path="/parent-login" element={<ParentLogin />} />
          <Route path="/parent" element={<ParentHome />} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/parent" replace />} />
        </Routes>
      </main>
    </div>
  );
}
