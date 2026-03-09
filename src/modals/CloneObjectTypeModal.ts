import { App, Modal, Setting } from "obsidian";
import { FieldDefinition } from "../types";

// ── Internal data model ────────────────────────────────────────────────────

/**
 * A mutable working copy of one source field, used inside the modal.
 */
interface FieldEntry {
    /** Name from the source (shown as placeholder) */
    readonly sourceName: string;
    /** Editable name; defaults to sourceName */
    displayName: string;
    readonly type: string;
    readonly options: Record<string, unknown>;
    readonly path: string;
    /** Whether the field is selected for inclusion in the clone */
    included: boolean;
    /** Fresh ID assigned at modal-open time; stable for the life of the modal */
    readonly newId: string;
}

/** Result handed back to the command when the user confirms */
export interface CloneObjectTypeResult {
    /** The name the user typed for the new object type */
    newName: string;
    /**
     * Fields to write into the clone, in the order the user left them.
     * Only includes fields the user kept checked.
     */
    fields: FieldDefinition[];
    /** Ordered array of the new field IDs — for `fieldsOrder` in the fileClass */
    fieldsOrder: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a random alphanumeric ID string.
 * Length 6 matches Metadata Menu's own convention and gives 2 billion
 * combinations — collision risk in any real vault is negligible.
 */
function generateFieldId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

// ── Modal ──────────────────────────────────────────────────────────────────

/**
 * Modal for cloning an existing object type (fileClass).
 *
 * Presents:
 *  • A name input with live collision-checking against existing type names.
 *  • A draggable, reorderable field list where each row can be:
 *      – included/excluded via checkbox
 *      – renamed via an inline text input
 *      – reordered via drag-and-drop OR ↑/↓ buttons
 *
 * On confirm, returns a {@link CloneObjectTypeResult} via `openAndGetValue()`.
 */
export class CloneObjectTypeModal extends Modal {
    private sourceName: string;
    private existingNames: string[];
    private entries: FieldEntry[];

    // live state
    private newName = "";
    private submitted = false;
    private onSubmit: ((result: CloneObjectTypeResult | null) => void) | null = null;

    // DOM refs for live re-render
    private nameInputEl: HTMLInputElement | null = null;
    private nameErrorEl: HTMLElement | null = null;
    private fieldListEl: HTMLElement | null = null;

    constructor(
        app: App,
        sourceName: string,
        sourceFields: FieldDefinition[],
        existingTypeNames: string[]
    ) {
        super(app);
        this.sourceName = sourceName;
        this.existingNames = existingTypeNames.map((n) => n.toLowerCase());
        this.newName = sourceName + "-copy";

        // Build working entries from source fields, assigning fresh IDs
        this.entries = sourceFields.map((f) => ({
            sourceName: f.name,
            displayName: f.name,
            type: f.type ?? "Input",
            options: (f.options as Record<string, unknown>) ?? {},
            path: ((f as unknown) as Record<string, unknown>).path as string ?? "",
            included: true,
            newId: generateFieldId(),
        }));
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("clone-object-type-modal");

        contentEl.createEl("h2", { text: "Clone object type" });
        contentEl.createEl("p", {
            text: `Source: ${this.sourceName}`,
            cls: "clone-source-label",
        });

        this.renderNameSection(contentEl);
        this.renderFieldSection(contentEl);
        this.renderActions(contentEl);

        // Focus the name input and select-all for quick replacement
        window.setTimeout(() => {
            if (this.nameInputEl) {
                this.nameInputEl.focus();
                this.nameInputEl.select();
            }
        }, 10);
    }

    onClose(): void {
        this.contentEl.empty();
        this.nameInputEl = null;
        this.nameErrorEl = null;
        this.fieldListEl = null;

        if (this.onSubmit) {
            const cb = this.onSubmit;
            this.onSubmit = null;
            cb(this.submitted ? this.buildResult() : null);
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    openAndGetValue(): Promise<CloneObjectTypeResult | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    private renderNameSection(parent: HTMLElement): void {
        parent.createEl("h3", { text: "New name" });

        new Setting(parent)
            .setName("Name")
            .setDesc("Must be unique — no two object types can share a name.")
            .addText((text) => {
                this.nameInputEl = text.inputEl;
                text.setValue(this.newName)
                    .setPlaceholder(`${this.sourceName}-copy`);

                text.inputEl.addEventListener("input", () => {
                    this.newName = text.inputEl.value.trim();
                    this.updateNameError();
                });

                text.inputEl.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        this.trySubmit();
                    }
                });
            });

        // Error message (hidden until there's a problem)
        this.nameErrorEl = parent.createEl("p", {
            cls: "clone-name-error is-hidden",
            text: "",
        });

        // Validate immediately so "copy" suffix collision is flagged upfront
        this.updateNameError();
    }

    private renderFieldSection(parent: HTMLElement): void {
        parent.createEl("h3", { text: "Fields" });
        parent.createEl("p", {
            text: "Uncheck to omit a field from the clone. Edit the name to rename it. Drag or use ↑/↓ to reorder.",
            cls: "clone-field-hint",
        });

        this.fieldListEl = parent.createDiv({ cls: "clone-field-list" });
        this.renderFieldRows(this.fieldListEl);
    }

    private renderFieldRows(container: HTMLElement): void {
        container.empty();

        let dragSourceIndex = -1;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];

            const rowEl = container.createDiv({
                cls: "mapping-row clone-field-row",
            });
            rowEl.setAttr("draggable", "true");
            rowEl.setAttr("aria-label", `Field ${i + 1} of ${this.entries.length}: ${entry.displayName}`);

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
                // Re-render field rows (container ref is stable)
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
            checkbox.setAttr("aria-label", `Include field "${entry.displayName}"`);
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
                // Normalise on blur: if left blank, revert to source name
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
        }
    }

    private renderActions(parent: HTMLElement): void {
        new Setting(parent)
            .addButton((btn) =>
                btn
                    .setButtonText("Clone")
                    .setCta()
                    .onClick(() => this.trySubmit())
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close())
            );
    }

    // ── Validation & submission ───────────────────────────────────────────────

    private nameError(): string | null {
        const name = this.newName.trim();
        if (!name) return "Name cannot be empty.";
        if (name.toLowerCase() === this.sourceName.toLowerCase()) {
            return "Name must differ from the source type.";
        }
        if (this.existingNames.includes(name.toLowerCase())) {
            return `An object type named "${name}" already exists.`;
        }
        return null;
    }

    private updateNameError(): void {
        if (!this.nameErrorEl) return;
        const err = this.nameError();
        if (err) {
            this.nameErrorEl.textContent = err;
            this.nameErrorEl.removeClass("is-hidden");
        } else {
            this.nameErrorEl.textContent = "";
            this.nameErrorEl.addClass("is-hidden");
        }
    }

    private trySubmit(): void {
        this.updateNameError();
        if (this.nameError()) {
            this.nameInputEl?.focus();
            return;
        }
        if (!this.entries.some((e) => e.included)) {
            if (this.nameErrorEl) {
                this.nameErrorEl.textContent = "At least one field must be included.";
                this.nameErrorEl.removeClass("is-hidden");
            }
            return;
        }
        this.submitted = true;
        this.close();
    }

    // ── Result builder ────────────────────────────────────────────────────────

    private buildResult(): CloneObjectTypeResult {
        const included = this.entries.filter((e) => e.included);

        const fields: FieldDefinition[] = included.map((e) => ({
            id: e.newId,
            name: e.displayName,
            type: e.type,
            options: e.options,
            // preserve path (nesting) — cast through unknown for safety
            ...(e.path !== undefined ? { path: e.path } : {}),
        }));

        const fieldsOrder = included.map((e) => e.newId);

        return {
            newName: this.newName.trim(),
            fields,
            fieldsOrder,
        };
    }
}
