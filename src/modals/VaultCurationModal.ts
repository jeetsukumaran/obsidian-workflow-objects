import { App, Modal, Setting, TFolder } from "obsidian";
import { WorkflowObjectsSettings } from "../types";

/**
 * Options collected from the vault curation modal
 */
export interface VaultCurationOptions {
    /** Vault-relative directory to operate on ("" = root) */
    directory: string;
    /** Whether to recurse into subdirectories */
    recursive: boolean;
    /** Optional regex that file paths must match (empty = all) */
    includePattern: string;
    /** Optional regex that file paths must NOT match (empty = none excluded) */
    excludePattern: string;
    /** Run the clean operation */
    runClean: boolean;
    /** Clean mode */
    cleanMode: "standard" | "strict";
    /** Run the sort operation */
    runSort: boolean;
    /** Sort mode */
    sortMode: "schema" | "alphabetical";
    /** Run the reshelve operation */
    runReshelve: boolean;
}

/**
 * Modal for configuring vault-wide curation operations
 */
export class VaultCurationModal extends Modal {
    private options: VaultCurationOptions;
    private onSubmit: ((opts: VaultCurationOptions | null) => void) | null = null;
    private submitted = false;

    constructor(
        app: App,
        private settings: WorkflowObjectsSettings,
        defaults?: Partial<VaultCurationOptions>
    ) {
        super(app);
        this.options = {
            directory: "",
            recursive: true,
            includePattern: "",
            excludePattern: "",
            runClean: true,
            cleanMode: "standard",
            runSort: false,
            sortMode: settings.defaultFieldSort,
            runReshelve: false,
            ...defaults,
        };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Curate vault" });

        // ── Scope ────────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Scope" });

        // Directory picker — text input + datalist of all folders
        const folderNames = this.getAllFolderPaths();
        new Setting(contentEl)
            .setName("Directory")
            .setDesc('Vault-relative path to operate on (leave blank for root)')
            .addText((text) => {
                text.setPlaceholder("(root)")
                    .setValue(this.options.directory);

                // Attach a datalist for autocomplete
                const listId = "wfo-vault-folder-list";
                const datalist = text.inputEl.createEl("datalist" as keyof HTMLElementTagNameMap);
                datalist.id = listId;
                for (const name of folderNames) {
                    const opt = datalist.createEl("option" as keyof HTMLElementTagNameMap);
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
                toggle.setValue(this.options.recursive).onChange((v) => {
                    this.options.recursive = v;
                })
            );

        // ── Filters ───────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Filters" });

        new Setting(contentEl)
            .setName("Include pattern")
            .setDesc("Regex that file paths must match (e.g. ^projects/). Leave blank to include all.")
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
            .setDesc("Regex that file paths must NOT match (e.g. ^system/). Leave blank to exclude none.")
            .addText((text) =>
                text
                    .setPlaceholder("(none)")
                    .setValue(this.options.excludePattern)
                    .onChange((v) => {
                        this.options.excludePattern = v.trim();
                    })
            );

        // ── Operations ────────────────────────────────────────────────────────

        contentEl.createEl("h3", { text: "Operations" });

        // Clean
        let cleanModeRow: Setting;
        new Setting(contentEl)
            .setName("Clean frontmatter")
            .setDesc("Remove empty/undefined fields and add missing schema fields")
            .addToggle((toggle) =>
                toggle.setValue(this.options.runClean).onChange((v) => {
                    this.options.runClean = v;
                    cleanModeRow.settingEl.toggle(v);
                })
            );

        cleanModeRow = new Setting(contentEl)
            .setName("Clean mode")
            .setDesc("Standard: preserve defined fields, add missing. Strict: also remove undefined fields.")
            .addDropdown((dd) =>
                dd
                    .addOption("standard", "Standard (inclusive)")
                    .addOption("strict", "Strict (exclusive)")
                    .setValue(this.options.cleanMode)
                    .onChange((v) => {
                        this.options.cleanMode = v as "standard" | "strict";
                    })
            );
        cleanModeRow.settingEl.style.paddingLeft = "2em";
        cleanModeRow.settingEl.toggle(this.options.runClean);

        // Sort
        let sortModeRow: Setting;
        new Setting(contentEl)
            .setName("Sort frontmatter")
            .setDesc("Reorder frontmatter fields")
            .addToggle((toggle) =>
                toggle.setValue(this.options.runSort).onChange((v) => {
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
        sortModeRow.settingEl.style.paddingLeft = "2em";
        sortModeRow.settingEl.toggle(this.options.runSort);

        // Reshelve
        new Setting(contentEl)
            .setName("Reshelve files")
            .setDesc("Move / rename files to match their type and title")
            .addToggle((toggle) =>
                toggle.setValue(this.options.runReshelve).onChange((v) => {
                    this.options.runReshelve = v;
                })
            );

        // ── Actions ───────────────────────────────────────────────────────────

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Run")
                    .setCta()
                    .onClick(() => {
                        if (!this.options.runClean && !this.options.runSort && !this.options.runReshelve) {
                            // Nothing selected — show inline hint
                            const hint = contentEl.createEl("p", {
                                text: "Please enable at least one operation.",
                                cls: "mod-warning",
                            });
                            window.setTimeout(() => hint.remove(), 3000);
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

    openAndGetValue(): Promise<VaultCurationOptions | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private getAllFolderPaths(): string[] {
        const paths: string[] = [];
        this.app.vault.getAllFolders().forEach((folder: TFolder) => {
            if (folder.path !== "/") {
                paths.push(folder.path);
            }
        });
        return paths.sort();
    }
}
