import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="layout">
        <nav>
          <strong>Control Correo</strong>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/history">Días históricos</NavLink>
          <NavLink to="/trace">Correos match</NavLink>
          <NavLink to="/runs">Ejecuciones</NavLink>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<App page="dashboard" />} />
            <Route path="/history" element={<App page="history" />} />
            <Route path="/trace" element={<App page="trace" />} />
            <Route path="/runs" element={<App page="runs" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
