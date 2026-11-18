import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { TypeRenameService } from "../services/TypeRenameService";

/** Choose the type and its replacement name; keep errors and input in the dialog. */
export class RenameTypeModal extends Modal {
    private oldName: string;
    private newName: string;
    private busy = false;
    private resolve: (() => void) | null = null;
    private status!: HTMLElement;
    private submit!: ButtonComponent;
    private nameInput!: TextComponent;
    private rows: Setting[] = [];

    constructor(app: App, private names: string[], initial: string, private service: TypeRenameService) {
        super(app);
        this.oldName = initial;
        this.newName = initial;
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass("wfo-rename-type-modal");
        this.contentEl.createEl("h2", { text: "Rename type" });
        this.contentEl.createEl("p", {
            text: "Rename the type definition and update type declarations throughout the vault, including templates and child schemas.",
        });
        this.rows = [new Setting(this.contentEl).setName("Type").addDropdown(dropdown => {
            for (const name of this.names) dropdown.addOption(name, name);
            dropdown.setValue(this.oldName).onChange(value => {
                this.oldName = value;
                this.newName = value;
                this.nameInput.setValue(value);
                this.validate();
            });
        }), new Setting(this.contentEl).setName("New name")
            .setDesc("Must be unique. For a type in a subfolder, include subfolder/name. Omit .md.")
            .addText(text => {
                this.nameInput = text;
                text.setValue(this.newName).onChange(value => { this.newName = value; this.validate(); });
                text.inputEl.addEventListener("keydown", event => {
                    if (event.key === "Enter") { event.preventDefault(); void this.rename(); }
                });
            })];
        this.status = this.contentEl.createEl("p", { cls: "wfo-rename-type-status", attr: { role: "status", "aria-live": "polite" } });
        this.rows.push(new Setting(this.contentEl)
            .addButton(button => { this.submit = button.setButtonText("Rename type").setCta().onClick(() => this.rename()); })
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
        this.status.setText("Scanning the vault and updating type references…");
        try {
            const result = await this.service.rename(this.oldName, this.newName);
            new Notice(`Renamed type "${this.oldName}" to "${this.newName.trim()}". Updated metadata in ${result.filesUpdated} files.`);
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
