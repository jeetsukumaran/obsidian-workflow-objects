import { App, Modal, Setting } from "obsidian";
import { FieldDefinition } from "../types";
import { generateFieldId } from "../utils/fieldUtils";

// ── Internal data model ────────────────────────────────────────────────────

interface FieldEntry {
    /** Original name in the source type */
    readonly sourceName: string;
    /** Editable name; defaults to sourceName */
    displayName: string;
    readonly type: string;
    readonly options: Record<string, unknown>;
    readonly path: string;
    /** Whether the field is selected for copying */
    included: boolean;
    /**
     * True when a field with this name already exists in the target.
     * Pre-existing fields default to unchecked; if the user checks them
     * the copied definition will overwrite the existing one.
     */
    readonly existsInTarget: boolean;
    /** Fresh ID — used only for new fields; overwritten fields keep their target ID */
    readonly newId: string;
}

/** Result handed back to the command when the user confirms */
export interface CopyFieldsResult {
    /** Fields the user selected, in the order they arranged them */
    fields: FieldDefinition[];
    /** Ordered IDs — for `fieldsOrder` merging in the target fileClass */
    fieldsOrder: string[];
    /** Names of fields that will overwrite an existing definition in the target */
    overwriteNames: Set<string>;
}

// ── Modal ──────────────────────────────────────────────────────────────────

/**
 * Modal for "Copy fields from …" — copies a subset of fields from a source
 * type into a target type that already exists.
 *
 * Differences from {@link CloneObjectTypeModal}:
 *  - No name input (the target already has a name).
 *  - Fields that already exist in the target are shown with an "overwrite"
 *    badge and default to **unchecked**; the user must explicitly opt in to
 *    replacing them.
 *  - Fields new to the target default to **checked**.
 *  - Drag / ↑↓ reordering and rename inputs behave identically to the clone modal.
 */
export class CopyFieldsFromModal extends Modal {
    private sourceName: string;
    private targetName: string;
    private entries: FieldEntry[];

    private submitted = false;
    private onSubmit: ((result: CopyFieldsResult | null) => void) | null = null;

    private fieldListEl: HTMLElement | null = null;
    private errorEl: HTMLElement | null = null;

    constructor(
        app: App,
        sourceName: string,
        sourceFields: FieldDefinition[],
        targetName: string,
        targetFieldNames: Set<string>
    ) {
        super(app);
        this.sourceName = sourceName;
        this.targetName = targetName;

        this.entries = sourceFields.map((f) => {
            const existsInTarget = targetFieldNames.has(f.name);
            return {
                sourceName: f.name,
                displayName: f.name,
                type: f.type ?? "Input",
                options: (f.options as Record<string, unknown>) ?? {},
                path: ((f as unknown) as Record<string, unknown>).path as string ?? "",
                // Pre-existing fields default unchecked; new fields default checked.
                included: !existsInTarget,
                existsInTarget,
                newId: generateFieldId(),
            };
        });
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("copy-fields-from-modal");

        contentEl.createEl("h2", { text: "Copy fields from…" });

        const metaEl = contentEl.createDiv({ cls: "copy-fields-meta" });
        metaEl.createSpan({ cls: "copy-fields-source-label", text: this.sourceName });
        metaEl.createSpan({ cls: "copy-fields-arrow", text: " → " });
        metaEl.createSpan({ cls: "copy-fields-target-label", text: this.targetName });

        // Legend
        const legendEl = contentEl.createEl("p", { cls: "copy-fields-legend" });
        legendEl.createSpan({ text: "Checked fields will be copied. " });
        const overwriteSpan = legendEl.createSpan({
            cls: "copy-fields-overwrite-badge copy-fields-overwrite-badge--inline",
            text: "overwrite",
        });
        overwriteSpan.setAttr("title", "This field already exists in the target type");
        legendEl.createSpan({ text: " fields already exist in the target and are unchecked by default — check to replace them." });

        this.fieldListEl = contentEl.createDiv({ cls: "clone-field-list" });
        this.renderFieldRows(this.fieldListEl);

        // Error message
        this.errorEl = contentEl.createEl("p", {
            cls: "clone-name-error is-hidden",
            text: "",
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Copy")
                    .setCta()
                    .onClick(() => this.trySubmit())
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close())
            );
    }

    onClose(): void {
        this.contentEl.empty();
        this.fieldListEl = null;
        this.errorEl = null;

        if (this.onSubmit) {
            const cb = this.onSubmit;
            this.onSubmit = null;
            cb(this.submitted ? this.buildResult() : null);
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    openAndGetValue(): Promise<CopyFieldsResult | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }

    // ── Field rows ────────────────────────────────────────────────────────────

    private renderFieldRows(container: HTMLElement): void {
        container.empty();

        let dragSourceIndex = -1;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];

            const rowEl = container.createDiv({
                cls: "mapping-row clone-field-row",
            });
            rowEl.setAttr("draggable", "true");
            rowEl.setAttr(
                "aria-label",
                `Field ${i + 1} of ${this.entries.length}: ${entry.displayName}`
            );

            // ── Drag handle ──────────────────────────────────────────────────
            const handle = rowEl.createSpan({
                cls: "mapping-drag-handle",
                text: "⠿",
            });
            handle.setAttr("title", "Drag to reorder");
            handle.setAttr("aria-hidden", "true");

            handle.addEventListener("mousedown", () => {
                rowEl.setAttr("draggable", "true");
            });

            rowEl.addEventListener("dragstart", (e: DragEvent) => {
                dragSourceIndex = i;
                rowEl.addClass("mapping-row--dragging");
                e.dataTransfer?.setDragImage(rowEl, 0, 0);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            });

            rowEl.addEventListener("dragend", () => {
                rowEl.removeClass("mapping-row--dragging");
                container
                    .querySelectorAll(".mapping-row--drag-over")
                    .forEach((el) => el.removeClass("mapping-row--drag-over"));
            });

            rowEl.addEventListener("dragover", (e: DragEvent) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                container
                    .querySelectorAll(".mapping-row--drag-over")
                    .forEach((el) => el.removeClass("mapping-row--drag-over"));
                if (dragSourceIndex !== i) {
                    rowEl.addClass("mapping-row--drag-over");
                }
            });

            rowEl.addEventListener("dragleave", () => {
                rowEl.removeClass("mapping-row--drag-over");
            });

            rowEl.addEventListener("drop", (e: DragEvent) => {
                e.preventDefault();
                rowEl.removeClass("mapping-row--drag-over");
                if (dragSourceIndex === -1 || dragSourceIndex === i) return;
                const [moved] = this.entries.splice(dragSourceIndex, 1);
                this.entries.splice(i, 0, moved);
                dragSourceIndex = -1;
                this.renderFieldRows(container);
            });

            // ── ↑ / ↓ reorder buttons ────────────────────────────────────────
            const reorderGroup = rowEl.createDiv({ cls: "mapping-reorder-group" });

            const upBtn = reorderGroup.createEl("button", {
                cls: "mapping-reorder-btn",
                text: "↑",
            });
            upBtn.setAttr("aria-label", "Move field up");
            upBtn.setAttr("title", "Move up");
            if (i === 0) upBtn.setAttr("disabled", "true");
            upBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (i === 0) return;
                [this.entries[i - 1], this.entries[i]] = [this.entries[i], this.entries[i - 1]];
                this.renderFieldRows(container);
            });

            const downBtn = reorderGroup.createEl("button", {
                cls: "mapping-reorder-btn",
                text: "↓",
            });
            downBtn.setAttr("aria-label", "Move field down");
            downBtn.setAttr("title", "Move down");
            if (i === this.entries.length - 1) downBtn.setAttr("disabled", "true");
            downBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (i === this.entries.length - 1) return;
                [this.entries[i], this.entries[i + 1]] = [this.entries[i + 1], this.entries[i]];
                this.renderFieldRows(container);
            });

            // ── Checkbox ─────────────────────────────────────────────────────
            const checkbox = rowEl.createEl("input", {
                cls: "clone-field-checkbox",
            });
            checkbox.type = "checkbox";
            checkbox.checked = entry.included;
            checkbox.setAttr("aria-label", `Copy field "${entry.displayName}"`);

            checkbox.addEventListener("change", () => {
                this.entries[i].included = checkbox.checked;
                nameInput.disabled = !checkbox.checked;
                if (!checkbox.checked) {
                    nameInput.addClass("clone-field-name-input--disabled");
                } else {
                    nameInput.removeClass("clone-field-name-input--disabled");
                }
            });

            // ── Name input ───────────────────────────────────────────────────
            const nameInput = rowEl.createEl("input", {
                cls: "clone-field-name-input",
            });
            nameInput.type = "text";
            nameInput.value = entry.displayName;
            nameInput.placeholder = entry.sourceName;
            nameInput.disabled = !entry.included;
            if (!entry.included) nameInput.addClass("clone-field-name-input--disabled");
            nameInput.setAttr("aria-label", `Rename field (source: ${entry.sourceName})`);

            nameInput.addEventListener("input", () => {
                const val = nameInput.value.trim();
                this.entries[i].displayName = val || entry.sourceName;
            });

            nameInput.addEventListener("blur", () => {
                if (!nameInput.value.trim()) {
                    this.entries[i].displayName = entry.sourceName;
                    nameInput.value = entry.sourceName;
                }
            });

            // ── Type badge ───────────────────────────────────────────────────
            rowEl.createSpan({
                cls: "clone-field-type-badge",
                text: entry.type,
            });

            // ── Overwrite badge (only for fields already in target) ───────────
            if (entry.existsInTarget) {
                const badge = rowEl.createSpan({
                    cls: "copy-fields-overwrite-badge",
                    text: "overwrite",
                });
                badge.setAttr("title", "This field already exists in the target type. Check to replace its definition.");
            }
        }
    }

    // ── Validation & submission ───────────────────────────────────────────────

    private trySubmit(): void {
        if (!this.entries.some((e) => e.included)) {
            if (this.errorEl) {
                this.errorEl.textContent = "Select at least one field to copy.";
                this.errorEl.removeClass("is-hidden");
            }
            return;
        }
        this.submitted = true;
        this.close();
    }

    // ── Result builder ────────────────────────────────────────────────────────

    private buildResult(): CopyFieldsResult {
        const included = this.entries.filter((e) => e.included);
        const overwriteNames = new Set(
            included.filter((e) => e.existsInTarget).map((e) => e.displayName)
        );

        const fields: FieldDefinition[] = included.map((e) => ({
            id: e.newId,
            name: e.displayName,
            type: e.type,
            options: e.options,
            ...(e.path ? { path: e.path } : {}),
        }));

        const fieldsOrder = included.map((e) => e.newId);

        return { fields, fieldsOrder, overwriteNames };
    }
}
