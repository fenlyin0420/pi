// 图标：lucide 的薄封装，统一线宽和尺寸，避免每处各写一遍 SVG 属性。

import type { LucideProps } from "lucide-react";
import {
	ArrowDown,
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Command,
	Copy,
	Ellipsis,
	FileText,
	FolderClosed,
	FolderOpen,
	Image as ImageIcon,
	LoaderCircle,
	Maximize2,
	Minimize2,
	Moon,
	PanelLeftClose,
	PanelLeftOpen,
	Paperclip,
	Pencil,
	Pin,
	PinOff,
	Plus,
	RotateCw,
	Search,
	Send,
	Settings,
	Sparkles,
	Square,
	Sun,
	Terminal,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import type { ComponentType } from "react";

type IconProps = LucideProps & { size?: number };

function icon(Component: ComponentType<LucideProps>) {
	return function Icon({ size = 16, ...props }: IconProps) {
		return <Component size={size} strokeWidth={1.7} absoluteStrokeWidth {...props} />;
	};
}

export const IconArrowDown = icon(ArrowDown);
export const IconArrowUp = icon(ArrowUp);
export const IconBrain = icon(Brain);
export const IconCheck = icon(Check);
export const IconChevronDown = icon(ChevronDown);
export const IconChevronRight = icon(ChevronRight);
export const IconCommand = icon(Command);
export const IconCopy = icon(Copy);
export const IconEllipsis = icon(Ellipsis);
export const IconFile = icon(FileText);
export const IconFolder = icon(FolderClosed);
export const IconFolderOpen = icon(FolderOpen);
export const IconImage = icon(ImageIcon);
export const IconLoader = icon(LoaderCircle);
export const IconMaximize = icon(Maximize2);
export const IconMinimize = icon(Minimize2);
export const IconMoon = icon(Moon);
export const IconPanelLeftClose = icon(PanelLeftClose);
export const IconPanelLeftOpen = icon(PanelLeftOpen);
export const IconPaperclip = icon(Paperclip);
export const IconPencil = icon(Pencil);
export const IconPin = icon(Pin);
export const IconPinOff = icon(PinOff);
export const IconPlus = icon(Plus);
export const IconRefresh = icon(RotateCw);
export const IconSearch = icon(Search);
export const IconSend = icon(Send);
export const IconSettings = icon(Settings);
export const IconSparkles = icon(Sparkles);
export const IconStop = icon(Square);
export const IconSun = icon(Sun);
export const IconTerminal = icon(Terminal);
export const IconTrash = icon(Trash2);
export const IconClose = icon(X);
export const IconZap = icon(Zap);
