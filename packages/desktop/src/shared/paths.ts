// 路径的纯字符串处理：显示用的末段目录名，以及判断两个路径是不是同一处（main 和 renderer 共用）。

import type { Platform } from "./contract.ts";

/** 路径末段目录名；根目录这类没有末段时退回原路径。 */
export function folderName(path: string): string {
	const parts = path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/** 两个路径是否同一处：Windows 和 macOS 上分隔符、大小写不算差别，Linux 上算。 */
export function samePath(a: string, b: string, platform: Platform): boolean {
	const normalize = (path: string) => {
		const slashed = path.replace(/\\/g, "/").replace(/\/+$/, "");
		return platform === "linux" ? slashed : slashed.toLowerCase();
	};
	return normalize(a) === normalize(b);
}
