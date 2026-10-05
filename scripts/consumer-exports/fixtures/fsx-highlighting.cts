import { EditorState, type Extension } from "@codemirror/state";
import { type FsxSyntaxAnalysis, analyzeFsxSyntax } from "@formbar/fsx-authoring";
import { fsxHighlighting } from "@formbar/fsx-editor";

const extension: Extension = fsxHighlighting();
const analysis: FsxSyntaxAnalysis = analyzeFsxSyntax('<Field value={"}"} />');
export const state = EditorState.create({ doc: "<Field />", extensions: [extension] });
export const boundary: "confirmed" | "ambiguous" | undefined = analysis.guestRegions[0]?.boundary;
