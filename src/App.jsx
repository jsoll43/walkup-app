import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";

import ParentHome from "./pages/ParentHome";
import ParentRecord from "./pages/ParentRecord";
import ParentLogin from "./pages/ParentLogin";

import Coach from "./pages/Coach";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 16, borderBottom: "1px solid #ddd" }}>
        <Link to="/parent" style={{ marginRight: 12 }}>Parent</Link>
        <Link to="/coach" style={{ marginRight: 12 }}>Coach</Link>
        <Link to="/admin">Admin</Link>
      </div>

      <Routes>
        {/* Default: send / to /parent */}
        <Route path="/" element={<Navigate to="/parent" replace />} />

        {/* Parent privacy gate */}
        <Route path="/parent-login" element={<ParentLogin />} />
        <Route path="/parent" element={<ParentHome />} />
        <Route path="/parent/:playerId" element={<ParentRecord />} />

        {/* Coach/Admin */}
        <Route path="/coach" element={<Coach />} />
        <Route path="/admin" element={<Admin />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/parent" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
