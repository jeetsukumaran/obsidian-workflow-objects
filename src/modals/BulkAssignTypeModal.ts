import { App, Modal, Setting, TFolder } from "obsidian";
import { WorkflowObjectsSettings } from "../types";

/**
 * Options collected from the bulk-assign-type configuration modal
 */
export interface BulkAssignTypeOptions {
    /** The type name to write into the type field of every matched file */
    targetType: string;
    /** Vault-relative directory to operate on ("" = root) */
    directory: string;
    /** Whether to recurse into subdirectories */
    recursive: boolean;
    /** Optional regex that file paths must match (empty = all) */
    includePattern: string;
    /** Optional regex that file paths must NOT match (empty = none excluded) */
    excludePattern: string;
    /** Run clean-frontmatter after assigning the type */
    runClean: boolean;
    /** Clean mode */
    cleanMode: "standard" | "strict";
    /** Run sort-frontmatter after assigning (and optionally cleaning) the type */
    runSort: boolean;
    /** Sort mode */
    sortMode: "schema" | "alphabetical";
    /** Move / rename files to match their new type and title after assigning */
    runReshelve: boolean;
}

/**
 * Configuration modal for the "Bulk assign object type" command.
 *
 * Collects the target type, file scope / filters, and optional post-assign
 * operations (clean, sort).  Reshelve is intentionally excluded — path
 * changes are a distinct, more destructive operation that the user should
 * trigger separately after reviewing the new type assignments.
 *
 * On confirm the modal resolves with a {@link BulkAssignTypeOptions} via
 * `openAndGetValue()`; on cancel it resolves with null.
 */
export class BulkAssignTypeModal extends Modal {
    private options: BulkAssignTypeOptions;
    private onSubmit: ((opts: BulkAssignTypeOptions | null) => void) | null = null;
    private submitted = false;
    private errorEl: HTMLElement | null = null;

    constructor(
        app: App,
        private settings: WorkflowObjectsSettings,
        private typeNames: string[],
        defaults?: Partial<BulkAssignTypeOptions>
    ) {
        super(app);
        this.options = {
            targetType: typeNames[0] ?? "",
            directory: "",
            recursive: true,
            includePattern: "",
            excludePattern: "",
            runClean: true,
            cleanMode: "standard",
            runSort: true,
            sortMode: settings.defaultFieldSort,
            runReshelve: true,
            ...defaults,
        };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Bulk assign object type" });

        // ── Type ─────────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Type to assign" });

        new Setting(contentEl)
            .setName("Object type")
            .setDesc(
                "The type value that will be written into the type field of every matched file."
            )
            .addDropdown((dd) => {
                for (const name of this.typeNames) {
                    dd.addOption(name, name);
                }
                dd.setValue(this.options.targetType).onChange((v) => {
                    this.options.targetType = v;
                });
            });

        // ── Scope ────────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Scope" });

        const folderNames = this.getAllFolderPaths();
        new Setting(contentEl)
            .setName("Directory")
            .setDesc(
                "Vault-relative path to operate on (leave blank for root)"
            )
            .addText((text) => {
                text.setPlaceholder("(root)").setValue(this.options.directory);

                // Datalist for folder autocomplete
                const listId = "wfo-bulk-folder-list";
                const datalist = text.inputEl.createEl(
                    "datalist" as keyof HTMLElementTagNameMap
                );
                datalist.id = listId;
                for (const name of folderNames) {
                    const opt = datalist.createEl(
                        "option" as keyof HTMLElementTagNameMap
                    );
                    (opt as HTMLOptionElement).value = name;
                }
                text.inputEl.setAttribute("list", listId);

                text.onChange((v) => {
                    this.options.directory = v.trim();
                });
            });

        new Setting(contentEl)
            .setName("Recursive")
            .setDesc("Process files in subdirectories")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options.recursive)
                    .onChange((v) => {
                        this.options.recursive = v;
                    })
            );

        // ── Filters ───────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Filters" });

        new Setting(contentEl)
            .setName("Include pattern")
            .setDesc(
                "Regex that file paths must match (e.g. ^projects/). Leave blank to include all."
            )
            .addText((text) =>
                text
                    .setPlaceholder("(all files)")
                    .setValue(this.options.includePattern)
                    .onChange((v) => {
                        this.options.includePattern = v.trim();
                    })
            );

        new Setting(contentEl)
            .setName("Exclude pattern")
            .setDesc(
                "Regex that file paths must NOT match (e.g. ^system/). Leave blank to exclude none."
            )
            .addText((text) =>
                text
                    .setPlaceholder("(none)")
                    .setValue(this.options.excludePattern)
                    .onChange((v) => {
                        this.options.excludePattern = v.trim();
                    })
            );

        // ── Post-assign operations ────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Post-assign operations" });

        let cleanModeRow: Setting;
        new Setting(contentEl)
            .setName("Clean frontmatter")
            .setDesc(
                "Remove empty / undefined fields and add missing schema fields after assigning the type"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options.runClean)
                    .onChange((v) => {
                        this.options.runClean = v;
                        cleanModeRow.settingEl.toggle(v);
                    })
            );

        cleanModeRow = new Setting(contentEl)
            .setName("Clean mode")
            .setDesc(
                "Standard: preserve defined fields, add missing. Strict: also remove undefined fields."
            )
            .addDropdown((dd) =>
                dd
                    .addOption("standard", "Standard (inclusive)")
                    .addOption("strict", "Strict (exclusive)")
                    .setValue(this.options.cleanMode)
                    .onChange((v) => {
                        this.options.cleanMode = v as "standard" | "strict";
                    })
            );
        cleanModeRow.settingEl.setCssProps({ "padding-left": "2em" });
        cleanModeRow.settingEl.toggle(this.options.runClean);

        let sortModeRow: Setting;
        new Setting(contentEl)
            .setName("Sort frontmatter")
            .setDesc("Reorder frontmatter fields after assigning the type")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options.runSort)
                    .onChange((v) => {
                        this.options.runSort = v;
                        sortModeRow.settingEl.toggle(v);
                    })
            );

        sortModeRow = new Setting(contentEl)
            .setName("Sort mode")
            .addDropdown((dd) =>
                dd
                    .addOption("schema", "Schema order")
                    .addOption("alphabetical", "Alphabetical")
                    .setValue(this.options.sortMode)
                    .onChange((v) => {
                        this.options.sortMode = v as "schema" | "alphabetical";
                    })
            );
        sortModeRow.settingEl.setCssProps({ "padding-left": "2em" });
        sortModeRow.settingEl.toggle(this.options.runSort);

        new Setting(contentEl)
            .setName("Reshelve files")
            .setDesc(
                "Move / rename each file to match its new type and title after assigning"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.options.runReshelve)
                    .onChange((v) => {
                        this.options.runReshelve = v;
                    })
            );

        // ── Actions ───────────────────────────────────────────────────────────

        this.errorEl = contentEl.createEl("p", { cls: "mod-warning wfo-hidden" });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Preview →")
                    .setCta()
                    .onClick(() => {
                        if (!this.options.targetType) {
                            this.showError("Please select an object type.");
                            return;
                        }
                        this.submitted = true;
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close())
            );
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.onSubmit) {
            const cb = this.onSubmit;
            this.onSubmit = null;
            cb(this.submitted ? this.options : null);
        }
    }

    openAndGetValue(): Promise<BulkAssignTypeOptions | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private showError(msg: string): void {
        if (!this.errorEl) return;
        this.errorEl.textContent = msg;
        this.errorEl.removeClass("wfo-hidden");
        window.setTimeout(() => {
            if (this.errorEl) this.errorEl.addClass("wfo-hidden");
        }, 3000);
    }

    private getAllFolderPaths(): string[] {
        const paths: string[] = [];
        this.app.vault.getAllFolders().forEach((folder: TFolder) => {
            if (folder.path !== "/") paths.push(folder.path);
        });
        return paths.sort();
    }
}
