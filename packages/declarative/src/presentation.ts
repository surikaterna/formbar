export type Breakpoint = "base" | "sm" | "md" | "lg" | "xl";
export type ColumnSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "auto" | "full";
export type ResponsiveSpan = ColumnSpan | Readonly<Partial<Record<Breakpoint, ColumnSpan>>>;

export interface NodePresentation {
	readonly span?: ResponsiveSpan;
}
