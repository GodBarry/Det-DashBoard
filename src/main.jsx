import React from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import "./multi-user.css";
import App from "./App.jsx";
import { AppErrorBoundary } from "./app/AppErrorBoundary.jsx";
import { installGlobalFetchAuthInterceptor } from "./api-client.js";

installGlobalFetchAuthInterceptor();

createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
