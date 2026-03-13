import ReactDOM from "react-dom/client";

import App from "./App";
import "@/styles/globals.css";

const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function syncTheme() {
  document.documentElement.classList.toggle("dark", mediaQuery.matches);
}

syncTheme();
mediaQuery.addEventListener("change", syncTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
