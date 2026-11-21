import { App, Notice, TFile } from "obsidian";
import { TypedNoteWorkflowsSettings, FieldDefinition } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { StringSuggesterModal } from "../modals/SuggesterModal";
import { CopyFieldsFromModal } from "../modals/CopyFieldsFromModal";

/**
 * "Copy fields from…" command.
 *
 * Entry points:
 *  - Command palette: uses the active file as the target (must be a note type
 *    definition file in the note types folder).
 *  - File-explorer context menu: `targetFile` is passed directly.
 *
 * Flow:
 *  1. Validate the target file is a note type definition.
 *  2. Suggest-modal: pick a source note type (any note type except the target itself).
 *  3. CopyFieldsFromModal: select / rename / reorder fields; pre-existing
 *     fields in the target default to unchecked.
 *  4. Merge selected fields into the target's frontmatter via
 *     `processFrontMatter` — same mechanism Metadata Menu uses internally.
 *     - New fields are appended to `fields[]` and `fieldsOrder[]`.
 *     - Overwrite fields replace the matching entry in `fields[]` and keep
 *       their existing position in `fieldsOrder[]`.
 */
export async function copyFieldsFrom(
    app: App,
    _settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService,
    targetFile?: TFile
): Promise<void> {
    try {
        // ── Step 1: resolve target ─────────────────────────────────────────
        const target = targetFile ?? app.workspace.getActiveFile();

        if (!target) {
            new Notice("No active file — open a note type definition file first.");
            return;
        }

        if (!noteTypeService.isNoteTypeDefinitionFile(target)) {
            new Notice(
                `"${target.basename}" is not a note type definition file.\n` +
                `Open (or right-click) a file in the note types folder.`
            );
            return;
        }

        const targetName = target.basename;

        // ── Step 2: source note type suggester ──────────────────────────────────
        const allNoteTypeNames = noteTypeService.getAvailableNoteTypeNames();
        if (!allNoteTypeNames || allNoteTypeNames.length === 0) return;

        // Exclude the target itself — copying a note type onto itself is a no-op.
        const sourceChoices = allNoteTypeNames.filter(
            (n) => n.toLowerCase() !== targetName.toLowerCase()
        );

        if (sourceChoices.length === 0) {
            new Notice("No other note type definitions found to copy from.");
            return;
        }

        const suggester = new StringSuggesterModal(
            app,
            sourceChoices,
            `Copy fields from — choose source (target: ${targetName})`
        );
        const sourceName = await suggester.openAndGetValue();
        if (!sourceName) return;

        // ── Step 3: read source and target field definitions ───────────────
        const sourceFields = noteTypeService.getNoteTypeFieldDefinitions(sourceName);
        if (!sourceFields || sourceFields.length === 0) {
            new Notice(`"${sourceName}" has no field definitions to copy.`);
            return;
        }

        const targetFields = noteTypeService.getNoteTypeFieldDefinitions(targetName) ?? [];
        const targetFieldNames = new Set(targetFields.map((f) => f.name));

        // ── Step 4: show copy modal ────────────────────────────────────────
        const modal = new CopyFieldsFromModal(
            app,
            sourceName,
            sourceFields,
            targetName,
            targetFieldNames
        );
        const result = await modal.openAndGetValue();
        if (!result) return;

        // ── Step 5: merge into target frontmatter ──────────────────────────
        //
        // Read the raw frontmatter of the target note type definition file so we
        // can splice in the new field definitions.  We access it through
        // processFrontMatter — no raw file read needed.
        //
        // Merge rules:
        //  - result.overwriteNames  → replace the matching FieldDefinition in
        //    place; the field keeps its existing slot in fieldsOrder.
        //  - new fields (not in overwriteNames) → append to fields[] and
        //    add their new IDs to the end of fieldsOrder[].
        await app.fileManager.processFrontMatter(
            target,
            (fm: Record<string, unknown>) => {
                // Normalise existing arrays (may be undefined in a blank fileClass)
                const existingFields: FieldDefinition[] =
                    Array.isArray(fm["fields"])
                        ? (fm["fields"] as FieldDefinition[])
                        : [];

                const existingOrder: string[] =
                    Array.isArray(fm["fieldsOrder"])
                        ? (fm["fieldsOrder"] as string[])
                        : existingFields
                            .map((f) => f.id)
                            .filter((id): id is string => !!id);

                // Build a mutable copy of the existing fields list
                const mergedFields: FieldDefinition[] = [...existingFields];
                const mergedOrder: string[] = [...existingOrder];

                for (const incoming of result.fields) {
                    if (result.overwriteNames.has(incoming.name)) {
                        // Replace existing entry by name
                        const idx = mergedFields.findIndex(
                            (f) => f.name === incoming.name
                        );
                        if (idx !== -1) {
                            // Preserve the existing ID so fieldsOrder stays valid
                            const existingId = mergedFields[idx].id;
                            mergedFields[idx] = {
                                ...incoming,
                                id: existingId ?? incoming.id,
                            };
                            // If this ID is not in mergedOrder, add it now
                            if (existingId && !mergedOrder.includes(existingId)) {
                                mergedOrder.push(existingId);
                            }
                        } else {
                            // Edge case: field in target names but not in fields array
                            mergedFields.push(incoming);
                            mergedOrder.push(incoming.id ?? "");
                        }
                    } else {
                        // New field — append
                        mergedFields.push(incoming);
                        if (incoming.id) mergedOrder.push(incoming.id);
                    }
                }

                fm["fields"] = mergedFields;
                fm["fieldsOrder"] = mergedOrder.filter(Boolean);
            }
        );

        const overwriteCount = result.overwriteNames.size;
        const newCount = result.fields.length - overwriteCount;

        const parts: string[] = [];
        if (newCount > 0) parts.push(`${newCount} new`);
        if (overwriteCount > 0) parts.push(`${overwriteCount} overwritten`);

        new Notice(
            `Copied fields from "${sourceName}" → "${targetName}" ` +
            `(${parts.join(", ")})`
        );
    } catch (error) {
        console.error("Typed Note Workflows: Error copying fields", error);
        new Notice(
            `Error copying fields: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
