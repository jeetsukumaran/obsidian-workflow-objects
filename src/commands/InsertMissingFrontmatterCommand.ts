import { App, Notice } from "obsidian";
import { MissingFrontmatterMode } from "../types";
import { FrontmatterService } from "../services/FrontmatterService";
import { getActiveFileWithMeta } from "../utils/helpers";

/** Add missing fields to the active note using the requested placement. */
export async function insertMissingFrontmatter(
    app: App,
    frontmatterService: FrontmatterService,
    mode: MissingFrontmatterMode
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    try {
        const added = await frontmatterService.insertMissingFrontmatter(result.file, mode);
        const sorted = mode === "alphabetical" || mode === "schema";
        if (added === 0 && !sorted) {
            new Notice("No missing front matter fields");
            return;
        }
        new Notice(
            `Added ${added} missing front matter field(s)${sorted ? "; sorted front matter" : ""}`
        );
    } catch (error) {
        console.error("Typed Note Workflows: Error inserting missing front matter", error);
        new Notice(
            `Error inserting missing front matter: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
