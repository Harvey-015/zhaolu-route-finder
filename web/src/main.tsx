import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("WEB_ROOT_NOT_FOUND");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
