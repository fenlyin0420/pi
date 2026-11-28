// 通知窗口的入口：把自己挂到 #root 上，样式与主题变量在 notification.css 里一次性引入。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotificationStack } from "./NotificationStack.tsx";
import "./notification.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root container");

createRoot(container).render(
	<StrictMode>
		<NotificationStack />
	</StrictMode>,
);
