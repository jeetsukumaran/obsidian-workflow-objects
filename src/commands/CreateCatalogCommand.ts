import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { WorkflowObjectsSettings, FieldDefinition, CatalogTimestampField } from "../types";
import { TypeService } from "../services/TypeService";
import { ensureFolderExists } from "../utils/pathUtils";
import { openFile } from "../utils/helpers";

// ─── String helpers ────────────────────────────────────────────────────────────

/** "workflow-effort" → "Workflow effort" */
function toSentenceCase(fieldName: string): string {
    return fieldName
        .replace(/[-_]/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
}

/** "workflow-effort" → "workflow_effort"  (safe YAML key / formula identifier) */
function toFormulaKey(fieldName: string): string {
    return fieldName.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Expand {{content-type}} placeholder with the selected type name */
function expandCatalogTemplate(template: string, typeName: string): string {
    return template.replace(/\{\{content-type\}\}/g, typeName);
}

// ─── .base content generation ─────────────────────────────────────────────────

/**
 * Build the YAML content for a Bases (.base) file that queries all notes of a
 * given workflow-object type.
 *
 * Column rules:
 *  - First column: formula link → file.asLink(note["title"] || file.name)
 *  - MM "File"/"MultiFile" fields: formula link to linked file's title
 *  - All other schema fields: raw note property with sentence-case display name
 *  - Last two columns: file.ctime ("Date created"), file.mtime ("Date modified")
 *  - The type-discriminator field itself is excluded (it's the filter criterion)
 */
function generateBaseContent(
    typeFieldName: string,
    selectedType: string,
    fields: FieldDefinition[],
    titleFieldName: string,
    remapDisplayNames: boolean,
    ctimeField: CatalogTimestampField,
    mtimeField: CatalogTimestampField
): string {
    const formulaLines: string[] = [];
    const orderItems: string[] = [];
    const propertyLines: string[] = [];

    // ── Pass 1: title formula (always first column) ───────────────────────────
    // if() is the correct conditional — || is a boolean operator in Bases.
    const titleKey = "title_link";
    formulaLines.push(
        `  ${titleKey}: 'file.asLink(if(note["${titleFieldName}"], note["${titleFieldName}"], file.name))'`
    );
    orderItems.push(`      - formula.${titleKey}`);
    if (remapDisplayNames) {
        propertyLines.push(`  formula.${titleKey}:\n    displayName: Title`);
    }

    // ── Pass 2: remaining schema fields → order + formula/property entries ────
    for (const field of fields) {
        const name = field.name;
        // Title shown via formula above; typeField is the filter criterion.
        if (!name || name === titleFieldName || name === typeFieldName) continue;

        if (field.type === "File") {
            // Single linked-file: formula rendering the linked file as a titled link.
            const fKey = `${toFormulaKey(name)}_link`;
            formulaLines.push(
                `  ${fKey}: 'if(note["${name}"], file(note["${name}"]).asLink(file(note["${name}"]).properties["${titleFieldName}"]))'`
            );
            orderItems.push(`      - formula.${fKey}`);
            // Display name goes on the formula key (formula.xxx), not note.xxx.
            if (remapDisplayNames) {
                propertyLines.push(
                    `  formula.${fKey}:\n    displayName: ${toSentenceCase(name)}`
                );
            }
        } else {
            // Plain note property (includes MultiFile — Bases renders link lists natively).
            // Note property keys in the `properties` section MUST use the `note.` prefix.
            orderItems.push(`      - ${name}`);
            if (remapDisplayNames) {
                propertyLines.push(
                    `  note.${name}:\n    displayName: ${toSentenceCase(name)}`
                );
            }
        }
    }

    // ── File system timestamps (conditionally appended last) ──────────────────
    if (ctimeField.enabled) {
        orderItems.push("      - file.ctime");
        if (remapDisplayNames) {
            propertyLines.push(`  file.ctime:\n    displayName: ${ctimeField.displayName}`);
        }
    }
    if (mtimeField.enabled) {
        orderItems.push("      - file.mtime");
        if (remapDisplayNames) {
            propertyLines.push(`  file.mtime:\n    displayName: ${mtimeField.displayName}`);
        }
    }

    // ── Assemble YAML ─────────────────────────────────────────────────────────
    const parts: string[] = [];

    parts.push(`filters: 'note["${typeFieldName}"] == "${selectedType}"'`);
    parts.push("");

    if (formulaLines.length > 0) {
        parts.push("formulas:");
        parts.push(formulaLines.join("\n"));
        parts.push("");
    }

    if (propertyLines.length > 0) {
        parts.push("properties:");
        parts.push(propertyLines.join("\n"));
        parts.push("");
    }

    parts.push("views:");
    parts.push("  - type: table");
    parts.push(`    name: "${toSentenceCase(selectedType)} catalog"`);
    parts.push("    order:");
    parts.push(orderItems.join("\n"));

    return parts.join("\n");
}

// ─── Dialog modal ─────────────────────────────────────────────────────────────

interface CatalogOptions {
    selectedType: string;
    dir: string;
    filename: string;
    remapDisplayNames: boolean;
    ctimeField: CatalogTimestampField;
    mtimeField: CatalogTimestampField;
}

/**
 * Modal that lets the user confirm / tweak the catalog destination before
 * the .base file is created.
 *
 * Displays:
 *   1. Type selector (pre-selected to the type chosen in the suggester, but
 *      changeable in case the user changes their mind)
 *   2. Destination directory (editable, pre-filled from settings template)
 *   3. Filename (editable, pre-filled from settings template)
 */
class CreateCatalogModal extends Modal {
    private typeNames: string[];
    private options: CatalogOptions;
    private onSubmit: ((opts: CatalogOptions | null) => void) | null = null;

    constructor(
        app: App,
        typeNames: string[],
        defaultOptions: CatalogOptions
    ) {
        super(app);
        this.typeNames = typeNames;
        this.options = { ...defaultOptions };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Create new workflow object catalog" });

        // ── Type selector ──────────────────────────────────────────────────
        new Setting(contentEl)
            .setName("Object type")
            .setDesc("The workflow object type this catalog will query.")
            .addDropdown((dd) => {
                for (const t of this.typeNames) dd.addOption(t, t);
                dd.setValue(this.options.selectedType);
                dd.onChange((value) => {
                    this.options.selectedType = value;
                    // Recompute defaults based on new type (dir/filename are already
                    // user-overridable, but we update only if they still match the
                    // previous default — detect by checking current value hasn't drifted).
                    // Simplest approach: leave dir/filename as-is; user can edit manually.
                });
            });

        // ── Destination directory ──────────────────────────────────────────
        new Setting(contentEl)
            .setName("Destination directory")
            .setDesc("Folder path where the .base file will be created. Created if it does not exist.")
            .addText((text) => {
                text.setValue(this.options.dir)
                    .setPlaceholder("catalogs/my-type")
                    .onChange((v) => { this.options.dir = v.trim(); });
            });

        // ── Filename ───────────────────────────────────────────────────────
        new Setting(contentEl)
            .setName("Filename")
            .setDesc("Filename for the .base file (include the .base extension).")
            .addText((text) => {
                text.setValue(this.options.filename)
                    .setPlaceholder("catalog.my-type.base")
                    .onChange((v) => { this.options.filename = v.trim(); });
            });

        // ── Remap display names ────────────────────────────────────────────
        new Setting(contentEl)
            .setName("Remap field names to display names")
            .setDesc(
                "Register sentence-case display names for all schema fields " +
                "(e.g. \"workflow-effort\" → \"Workflow effort\"). " +
                "When off, Bases shows raw field keys as column headers."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options.remapDisplayNames)
                    .onChange((v) => { this.options.remapDisplayNames = v; })
            );

        // ── Timestamp columns ──────────────────────────────────────────────
        this.renderTimestampSetting(
            contentEl,
            "Include \"date created\" column (file.ctime)",
            "ctimeField"
        );
        this.renderTimestampSetting(
            contentEl,
            "Include \"date modified\" column (file.mtime)",
            "mtimeField"
        );

        // ── Buttons ────────────────────────────────────────────────────────
        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText("Create").setCta().onClick(() => {
                    this.resolve(this.options);
                })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => {
                    this.resolve(null);
                })
            );
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.onSubmit) {
            this.onSubmit(null);
            this.onSubmit = null;
        }
    }

    private resolve(opts: CatalogOptions | null): void {
        if (this.onSubmit) {
            const cb = this.onSubmit;
            this.onSubmit = null;
            this.close();
            cb(opts);
        }
    }

    /** Render a toggle + display-name text input for one timestamp field. */
    private renderTimestampSetting(
        container: HTMLElement,
        label: string,
        key: "ctimeField" | "mtimeField"
    ): void {
        new Setting(container)
            .setName(label)
            .setDesc("Display name used as the column header in the catalog.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options[key].enabled)
                    .onChange((v) => {
                        this.options[key] = { ...this.options[key], enabled: v };
                    })
            )
            .addText((text) =>
                text
                    .setValue(this.options[key].displayName)
                    .setPlaceholder("Column header")
                    .onChange((v) => {
                        this.options[key] = {
                            ...this.options[key],
                            displayName: v.trim() || this.options[key].displayName,
                        };
                    })
            );
    }

    openAndGetValue(): Promise<CatalogOptions | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }
}

// ─── Collision modal ──────────────────────────────────────────────────────────

type CollisionAction = "replace" | "rename" | "cancel";

interface CollisionResult {
    action: CollisionAction;
    /** Only set when action === "rename" */
    newFilename?: string;
}

/**
 * Shown when a .base file already exists at the computed path.
 * Offers three choices:
 *   Replace  — overwrite the existing file
 *   Rename   — enter a new filename and create alongside
 *   Cancel   — abort
 */
class CollisionModal extends Modal {
    private existingPath: string;
    private currentFilename: string;
    private onSubmit: ((result: CollisionResult) => void) | null = null;

    constructor(app: App, existingPath: string) {
        super(app);
        this.existingPath = existingPath;
        // Strip directory prefix to show just the filename in the rename field
        this.currentFilename = existingPath.split("/").pop() ?? existingPath;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "File already exists" });
        contentEl.createEl("p", {
            text: `A catalog already exists at: ${this.existingPath}`,
            cls: "setting-item-description",
        });

        // ── Rename field (shown above the action buttons) ──────────────────
        let newFilename = this.currentFilename;

        new Setting(contentEl)
            .setName("New filename")
            .setDesc(
                "Edit below then click Rename, or choose Replace / Cancel."
            )
            .addText((text) => {
                text.setValue(newFilename)
                    .setPlaceholder("catalog.my-type.base")
                    .onChange((v) => { newFilename = v.trim(); });
                // Pre-select the text so the user can type immediately
                window.setTimeout(() => {
                    text.inputEl.focus();
                    text.inputEl.select();
                }, 10);
            });

        // ── Action buttons ─────────────────────────────────────────────────
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Replace")
                    .setWarning()
                    .onClick(() => this.resolve({ action: "replace" }))
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Rename")
                    .setCta()
                    .onClick(() => {
                        const name = newFilename || this.currentFilename;
                        this.resolve({ action: "rename", newFilename: name });
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .onClick(() => this.resolve({ action: "cancel" }))
            );
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.onSubmit) {
            this.onSubmit({ action: "cancel" });
            this.onSubmit = null;
        }
    }

    private resolve(result: CollisionResult): void {
        if (this.onSubmit) {
            const cb = this.onSubmit;
            this.onSubmit = null;
            this.close();
            cb(result);
        }
    }

    openAndGetValue(): Promise<CollisionResult> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }
}

// ─── Resolve path with collision handling ─────────────────────────────────────

/**
 * Given a desired full path, check for an existing file and prompt the user
 * to replace, rename (returns a new path), or cancel (returns null).
 *
 * Rename loops: if the user enters a name that also collides, the dialog
 * re-opens so they can try again or replace.
 */
async function resolvePathWithCollision(
    app: App,
    dir: string,
    filename: string
): Promise<{ fullPath: string; replace: boolean } | null> {
    let currentFilename = filename;

    while (true) {
        const fullPath = dir ? `${dir}/${currentFilename}` : currentFilename;

        if (!app.vault.getAbstractFileByPath(fullPath)) {
            return { fullPath, replace: false };
        }

        const modal = new CollisionModal(app, fullPath);
        const result = await modal.openAndGetValue();

        if (result.action === "cancel") return null;

        if (result.action === "replace") {
            return { fullPath, replace: true };
        }

        // rename — normalise extension and loop back to check the new name
        let next = result.newFilename ?? currentFilename;
        if (!next.endsWith(".base")) next += ".base";
        currentFilename = next;
    }
}

// ─── Command entry point ───────────────────────────────────────────────────────

/**
 * "Create new workflow object catalog" command.
 *
 * Flow:
 *  1. Show type suggester → user picks a type
 *  2. Show options dialog (type re-selectable, dir + filename pre-filled)
 *  3. Generate schema-aware .base file and open it
 */
export async function createWorkflowObjectCatalog(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    try {
        // 1. Fetch available types
        const typeNames = typeService.getTypeNames();
        if (!typeNames) return;

        // 2. Type suggester (first prompt)
        const { StringSuggesterModal } = await import("../modals");
        const suggester = new StringSuggesterModal(
            app,
            typeNames,
            "Create new catalog for object of type"
        );
        const selectedType = await suggester.openAndGetValue();
        if (!selectedType) return;

        // 3. Compute default dir / filename by expanding {{content-type}}
        const defaultDir = expandCatalogTemplate(settings.catalogDir, selectedType);
        const defaultFilename = expandCatalogTemplate(settings.catalogFilename, selectedType);

        // 4. Options dialog (type pre-selected, dir + filename editable)
        const modal = new CreateCatalogModal(app, typeNames, {
            selectedType,
            dir: defaultDir,
            filename: defaultFilename,
            remapDisplayNames: settings.catalogRemapDisplayNames,
            ctimeField: { ...settings.catalogCtimeField },
            mtimeField: { ...settings.catalogMtimeField },
        });
        const opts = await modal.openAndGetValue();
        if (!opts) return;

        // 5. Normalise filename, resolve dir, handle collisions
        let filename = opts.filename || `catalog.${opts.selectedType}.base`;
        if (!filename.endsWith(".base")) filename += ".base";

        const dir = opts.dir.replace(/\/+$/, ""); // strip trailing slashes

        const resolved = await resolvePathWithCollision(app, dir, filename);
        if (!resolved) return;

        const { fullPath, replace } = resolved;

        // 6. Gather schema fields in definition order
        const fields = typeService.getTypeFieldDefinitions(opts.selectedType) ?? [];
        // Respect fieldsOrder if present (same logic TypeService uses internally)
        const orderedNames = typeService.getFieldSortOrder(opts.selectedType);
        const orderedFields: FieldDefinition[] = orderedNames
            ? orderedNames
                .map((name) => fields.find((f) => f.name === name))
                .filter((f): f is FieldDefinition => f != null)
            : fields;

        // 7. Generate .base content
        const typeFieldName = typeService.getTypeFieldName();
        const content = generateBaseContent(
            typeFieldName,
            opts.selectedType,
            orderedFields,
            settings.fields.title,
            opts.remapDisplayNames,
            opts.ctimeField,
            opts.mtimeField
        );

        // 8. Ensure folder exists, write file (replace or create), and open
        await ensureFolderExists(app, dir);
        let file: TFile;
        if (replace) {
            const existing = app.vault.getAbstractFileByPath(fullPath);
            if (existing instanceof TFile) {
                await app.vault.modify(existing, content);
                file = existing;
            } else {
                file = await app.vault.create(fullPath, content);
            }
        } else {
            file = await app.vault.create(fullPath, content);
        }
        await openFile(app, file);
        new Notice(`${replace ? "Replaced" : "Created"} catalog: ${fullPath}`);
    } catch (error) {
        console.error("Workflow Objects: Error creating catalog", error);
        new Notice(`Error creating catalog: ${error}`);
    }
}
