import { App, Modal, Setting } from "obsidian";
import { TypedNoteField, TypedNoteFieldService, FileCandidate } from "../services/TypedNoteFieldService";

/** FileClass-style candidates, keeping multi-selection in source-view order. */
export class TypedNoteFilePickerModal extends Modal {
    private selected = new Map<string, FileCandidate>();
    private items: FileCandidate[] = [];
    private resolve: ((value: FileCandidate[] | null) => void) | null = null;
    private result: FileCandidate[] | null = null;
    private generation = 0;
    private query = "";
    private listEl!: HTMLElement;
    private statusEl!: HTMLElement;

    constructor(app: App, private field: TypedNoteField, private fields: TypedNoteFieldService) {
        super(app);
        for (const candidate of field.links) this.selected.set(candidate.file.path, candidate);
    }

    onOpen(): void {
        this.modalEl.addClass("tnw-create-modal");
        this.contentEl.createEl("h2", { text: `Choose ${this.field.definition.name}` });
        this.statusEl = this.contentEl.createEl("p", { cls: "setting-item-description", attr: { "aria-live": "polite" } });
        new Setting(this.contentEl).setName("Filter files").addText(text => {
            text.inputEl.setAttribute("aria-label", "Filter files");
            text.onChange(value => { this.query = value.toLowerCase(); this.render(); });
        });
        new Setting(this.contentEl).setName("Show all files").setDesc("Ignore the field's base view for this selection.")
            .addToggle(toggle => toggle.onChange(value => { void this.load(value); }));
        this.listEl = this.contentEl.createDiv({ cls: "tnw-create-file-list" });
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText("Use selected files").setCta().onClick(() => {
                const available = new Map(this.items.map(item => [item.file.path, item]));
                this.result = [
                    ...this.items.filter(item => this.selected.has(item.file.path)),
                    ...[...this.selected.values()].filter(item => !available.has(item.file.path)),
                ];
                this.close();
            }))
            .addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
        void this.load(false);
    }

    private async load(allFiles: boolean): Promise<void> {
        const generation = ++this.generation;
        this.statusEl.setText("Loading files…");
        try {
            const result = await this.fields.candidates(this.field, allFiles);
            if (generation !== this.generation) return;
            this.items = result.items;
            this.statusEl.setText(result.message);
            this.render();
        } catch (error) {
            if (generation === this.generation) this.statusEl.setText(error instanceof Error ? error.message : String(error));
        }
    }

    private render(): void {
        this.listEl.empty();
        const filtered = this.items.filter(item => `${item.display} ${item.file.path}`.toLowerCase().includes(this.query));
        if (!filtered.length) this.listEl.createEl("p", { text: "No matching files." });
        let group: string | null | undefined;
        for (const candidate of filtered) {
            if (candidate.group !== undefined && candidate.group !== group) {
                group = candidate.group;
                this.listEl.createEl("h3", { text: group ?? "No group" });
            }
            const row = new Setting(this.listEl).setName(candidate.display).setDesc(candidate.file.path);
            if (this.field.kind.startsWith("multi")) {
                row.addToggle(toggle => toggle.setValue(this.selected.has(candidate.file.path)).onChange(value => {
                    if (value) this.selected.set(candidate.file.path, candidate);
                    else this.selected.delete(candidate.file.path);
                }));
            } else row.addButton(button => button.setButtonText("Select").onClick(() => {
                this.result = [candidate];
                this.close();
            }));
        }
    }

    onClose(): void {
        this.generation++;
        this.contentEl.empty();
        this.resolve?.(this.result);
        this.resolve = null;
    }

    openAndGetValue(): Promise<FileCandidate[] | null> {
        return new Promise(resolve => { this.resolve = resolve; this.open(); });
    }
}
