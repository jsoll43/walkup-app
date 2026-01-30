import ParentRecord from "./pages/ParentRecord";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ParentHome from "./pages/ParentHome";
import Coach from "./pages/Coach";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 16, borderBottom: "1px solid #ddd" }}>
        <Link to="/" style={{ marginRight: 12 }}>Parent</Link>
        <Link to="/coach" style={{ marginRight: 12 }}>Coach</Link>
        <Link to="/admin">Admin</Link>
      </div>

      <Routes>
        <Route path="/record/:playerId" element={<ParentRecord />} />
        <Route path="/" element={<ParentHome />} />
        <Route path="/coach" element={<Coach />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}
