import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";

// HashRouter (not BrowserRouter) is used deliberately — GitHub Pages serves
// static files with no server-side rewrite rules, so a path-based router
// would 404 on refresh at any route other than "/". Hash routing avoids that.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
