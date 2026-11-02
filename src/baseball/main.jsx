import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Scheduling from "./pages/Scheduling.jsx";
import SchedulingAdminSection from "./components/SchedulingAdminSection.jsx";
import "./baseball.css";

function Admin() {
  const [key, setKey] = useState("");
  const [authenticatedKey, setAuthenticatedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/baseball/admin/scheduling-settings", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      setAuthenticatedKey(key);
      setKey("");
    } catch (cause) {
      setError(cause.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticatedKey) return (
    <div className="page"><form className="card" onSubmit={login}>
      <div className="cardTitle">Barrington Little League</div>
      <h1>Scheduling Administration</h1>
      <p className="baseball-admin-note">Set Little League coach and board passwords, manage teams, and import field reservations.</p>
      <label className="label" htmlFor="baseball-admin-key">Site Administrator Key</label>
      <input id="baseball-admin-key" className="input" type="password" autoComplete="off" required value={key} onChange={(event) => setKey(event.target.value)} />
      <p className="baseball-admin-note">Use your existing site administrator key for initial setup. Give coaches and board members their separate Little League scheduling passwords.</p>
      {error && <p role="alert" style={{color:"crimson"}}>{error}</p>}
      <button className="btn" disabled={busy}>{busy ? "Signing in..." : "Log in as Administrator"}</button>
    </form></div>
  );

  return <div className="baseball-admin-page">
    <div className="baseball-admin-top"><h1>Little League Administration</h1><button className="btn-secondary" onClick={() => setAuthenticatedKey("")}>Log out</button></div>
    <SchedulingAdminSection isAuthed adminHeaders={{Authorization:`Bearer ${authenticatedKey}`}} embedded />
  </div>;
}

function App() {
  const [admin, setAdmin] = useState(() => window.location.hash === "#admin");
  const [hiddenHeader, setHiddenHeader] = useState(false);
  useEffect(() => {
    const route = () => { setAdmin(window.location.hash === "#admin"); window.scrollTo(0,0); };
    const scroll = () => setHiddenHeader(window.innerWidth <= 520 && window.scrollY > 24);
    window.addEventListener("hashchange", route);
    window.addEventListener("scroll", scroll, {passive:true});
    window.addEventListener("resize", scroll);
    return () => { window.removeEventListener("hashchange", route); window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); };
  }, []);
  return <div className="bll-app">
    <header className={`bll-header ${hiddenHeader ? "is-mobile-hidden" : ""}`}>
      <div className="bll-header-inner">
        <a className="bll-brand" href="#schedule" aria-label="Barrington Little League home">
          <img className="bll-logo" src="/baseball/logo.svg" alt="Barrington baseball b monogram" />
          <div><div className="bll-title">Barrington Little League</div><div className="bll-brand-subtitle">Field scheduling</div></div>
        </a>
        <nav className="bll-nav" aria-label="Little League navigation">
          <a href="#schedule" className={`bll-link ${!admin ? "active" : ""}`} aria-current={!admin ? "page" : undefined}>Field Scheduling</a>
          <a href="#admin" className={`bll-link ${admin ? "active" : ""}`} aria-current={admin ? "page" : undefined}>Admin</a>
        </nav>
      </div>
    </header>
    <main className="bll-main">
      <div className="baseball-fields" aria-label="Fields and reservation duration"><span>Majors</span><span>Minors</span><span>Tee Ball</span><span>2-hour reservations</span></div>
      {admin ? <Admin /> : <Scheduling />}
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
