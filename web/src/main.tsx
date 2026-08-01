import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { LegalPage } from "./LegalPage.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("WEB_ROOT_NOT_FOUND");
}

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const content =
  pathname === "/privacy" ? (
    <LegalPage kind="privacy" />
  ) : pathname === "/terms" ? (
    <LegalPage kind="terms" />
  ) : (
    <App />
  );

createRoot(root).render(
  <StrictMode>
    {content}
  </StrictMode>,
);
