// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { blockNativeMenu } from "./shell/native-menu";
import "./theme/fonts";
import "./theme/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

blockNativeMenu(document);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
