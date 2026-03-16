import { App, Modal, Setting, TFile } from "obsidian";

/**
 * A single entry shown in the preview list.
 */
export interface FilePreviewEntry {
    file: TFile;
    /** The file's current type value, if any */
    currentType: string | undefined;
}

/**
 * Result handed back to the command when the user confirms.
 */
export interface BulkAssignPreviewResult {
    /** The subset of files the user kept selected */
    selectedFiles: TFile[];
}

/**
 * Preview modal for the "Bulk assign object type" command.
 *
 * Shows a scrollable, checkable list of files that will be affected.
 * All files are selected by default; the user can deselect individual files
 * or use "Select all" / "Select none" before committing.
 *
 * Each row shows the file path and, where present, the file's current type
 * value so the user can identify files that will have their type changed
 * rather than set for the first time.
 *
 * On confirm, resolves with a {@link BulkAssignPreviewResult} via
 * `openAndGetValue()`; on cancel resolves with null.
 */
export class BulkAssignPreviewModal extends Modal {
    /** path → selected */
    private selections: Map<string, boolean>;
    private onSubmit: ((result: BulkAssignPreviewResult | null) => void) | null =
        null;
    private submitted = false;

    constructor(
        app: App,
        private entries: FilePreviewEntry[],
        private targetType: string
    ) {
        super(app);
        // All files selected by default
        this.selections = new Map(entries.map((e) => [e.file.path, true]));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Preview: bulk assign type" });

        const selectedCount = (): number =>
            [...this.selections.values()].filter(Boolean).length;

        // Live summary line
        const summaryEl = contentEl.createEl("p", {
            text: this.buildSummary(selectedCount()),
            cls: "wfo-bulk-preview-summary",
        });

        // Select all / none controls
        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText("Select all").onClick(() => {
                    for (const k of this.selections.keys()) {
                        this.selections.set(k, true);
                    }
                    this.refreshList(listEl, summaryEl, selectedCount);
                })
            )
            .addButton((btn) =>
                btn.setButtonText("Select none").onClick(() => {
                    for (const k of this.selections.keys()) {
                        this.selections.set(k, false);
                    }
                    this.refreshList(listEl, summaryEl, selectedCount);
                })
            );

        // Scrollable file list
        const listEl = contentEl.createDiv({ cls: "wfo-bulk-preview-list" });
        this.renderList(listEl, summaryEl, selectedCount);

        // Actions
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Assign")
                    .setCta()
                    .onClick(() => {
                        if (selectedCount() === 0) return;
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
            if (this.submitted) {
                const selectedFiles = this.entries
                    .filter((e) => this.selections.get(e.file.path))
                    .map((e) => e.file);
                cb({ selectedFiles });
            } else {
                cb(null);
            }
        }
    }

    openAndGetValue(): Promise<BulkAssignPreviewResult | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    private buildSummary(count: number): string {
        return (
            `${count} of ${this.entries.length} file(s) will be assigned ` +
            `type "${this.targetType}".`
        );
    }

    private renderList(
        listEl: HTMLElement,
        summaryEl: HTMLElement,
        selectedCount: () => number
    ): void {
        listEl.empty();

        for (const entry of this.entries) {
            const row = listEl.createDiv({ cls: "wfo-bulk-preview-row" });

            // Checkbox
            const checkbox = row.createEl("input");
            checkbox.type = "checkbox";
            checkbox.className = "wfo-bulk-preview-checkbox";
            checkbox.checked = this.selections.get(entry.file.path) ?? true;
            checkbox.addEventListener("change", () => {
                this.selections.set(entry.file.path, checkbox.checked);
                summaryEl.textContent = this.buildSummary(selectedCount());
            });

            // File path
            row.createEl("span", {
                text: entry.file.path,
                cls: "wfo-bulk-preview-path",
            });

            // Current type annotation (if the file already has a type set)
            if (entry.currentType !== undefined) {
                row.createEl("span", {
                    text: `← ${entry.currentType}`,
                    cls: "wfo-bulk-preview-current-type",
                });
            }
        }
    }

    private refreshList(
        listEl: HTMLElement,
        summaryEl: HTMLElement,
        selectedCount: () => number
    ): void {
        this.renderList(listEl, summaryEl, selectedCount);
        summaryEl.textContent = this.buildSummary(selectedCount());
    }
}
