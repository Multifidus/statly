import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initEngineTransport } from "@/lib/engineMode";
import { initTheme } from "@/stores/theme";
import "./index.css";

initTheme();

void initEngineTransport().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
