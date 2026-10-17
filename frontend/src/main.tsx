import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "./index.css";
import App from "./App.tsx";
import { applyTheme } from "./state/preferences";
import { initializeFont } from "./state/fonts";

applyTheme();

void initializeFont().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
