import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && !window.subtitleTranslator) {
    const [{ installDevSubtitleTranslatorMock }, { installDevDemoData }] = await Promise.all([
      import("./devSubtitleTranslatorMock"),
      import("./devDemoData")
    ]);
    installDevSubtitleTranslatorMock();
    installDevDemoData();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
