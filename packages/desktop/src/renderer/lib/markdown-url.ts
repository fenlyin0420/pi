// markdown 地址的放行规则：图片走自己的解析管线，其余链接保持 react-markdown 的默认白名单。

import { defaultUrlTransform } from "react-markdown";

/**
 * react-markdown 的 urlTransform，交给图片用的 markdown 渲染器。
 * 默认白名单会把 `C:/Users/...` 当成协议 `c:` 抹成空串（Windows 上的粘贴图片正是这种路径），
 * 而图片地址本来就由 issue 图片解析管线把关，所以 src 原样保留；href 仍然走默认白名单。
 */
export function keepImageSource(url: string, key: string): string {
	return key === "src" ? url : defaultUrlTransform(url);
}
