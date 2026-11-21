import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { NoteTypeRenameService } from "../services/NoteTypeRenameService";

/** Choose the note type and its replacement name; keep errors and input in the dialog. */
export class RenameNoteTypeModal extends Modal {
    private oldName: string;
    private newName: string;
    private busy = false;
    private resolve: (() => void) | null = null;
    private status!: HTMLElement;
    private submit!: ButtonComponent;
    private nameInput!: TextComponent;
    private rows: Setting[] = [];

    constructor(app: App, private names: string[], initial: string, private service: NoteTypeRenameService) {
        super(app);
        this.oldName = initial;
        this.newName = initial;
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass("tnw-rename-note-type-modal");
        this.contentEl.createEl("h2", { text: "Rename note type" });
        this.contentEl.createEl("p", {
            text: "Rename the note type definition and update note type declarations throughout the vault, including templates and child schemas.",
        });
        this.rows = [new Setting(this.contentEl).setName("Note type").addDropdown(dropdown => {
            for (const name of this.names) dropdown.addOption(name, name);
            dropdown.setValue(this.oldName).onChange(value => {
                this.oldName = value;
                this.newName = value;
                this.nameInput.setValue(value);
                this.validate();
            });
        }), new Setting(this.contentEl).setName("New name")
            .setDesc("Must be unique. For a note type in a subfolder, include subfolder/name. Omit .md.")
            .addText(text => {
                this.nameInput = text;
                text.setValue(this.newName).onChange(value => { this.newName = value; this.validate(); });
                text.inputEl.addEventListener("keydown", event => {
                    if (event.key === "Enter") { event.preventDefault(); void this.rename(); }
                });
            })];
        this.status = this.contentEl.createEl("p", { cls: "tnw-rename-note-type-status", attr: { role: "status", "aria-live": "polite" } });
        this.rows.push(new Setting(this.contentEl)
            .addButton(button => { this.submit = button.setButtonText("Rename note type").setCta().onClick(() => this.rename()); })
            .addButton(button => button.setButtonText("Cancel").onClick(() => this.close())));
        this.validate();
        this.nameInput.inputEl.focus();
        this.nameInput.inputEl.select();
    }

    private validate(): boolean {
        const error = this.service.validateName(this.oldName, this.newName);
        this.status.setText(error ?? "");
        this.submit.setDisabled(this.busy || !!error);
        return !error;
    }

    private async rename(): Promise<void> {
        if (this.busy || !this.validate()) return;
        this.busy = true;
        this.rows.forEach(row => { row.setDisabled(true); });
        this.status.setText("Scanning the vault and updating note type references…");
        try {
            const result = await this.service.rename(this.oldName, this.newName);
            new Notice(`Renamed note type "${this.oldName}" to "${this.newName.trim()}". Updated metadata in ${result.filesUpdated} files.`);
            this.busy = false;
            this.close();
        } catch (error) {
            this.status.setText(error instanceof Error ? error.message : String(error));
        } finally {
            this.busy = false;
            this.rows.forEach(row => { row.setDisabled(false); });
        }
    }

    close(): void { if (!this.busy) super.close(); }

    onClose(): void {
        this.contentEl.empty();
        this.resolve?.();
        this.resolve = null;
    }

    openAndWait(): Promise<void> {
        return new Promise(resolve => { this.resolve = resolve; this.open(); });
    }
}
