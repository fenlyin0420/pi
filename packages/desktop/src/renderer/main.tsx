// renderer 入口：挂载 <App />，样式与主题变量在这里一次性引入。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root container");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
