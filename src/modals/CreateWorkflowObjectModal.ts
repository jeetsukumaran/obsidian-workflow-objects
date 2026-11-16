import { App, ButtonComponent, Modal, Setting, TextComponent, TFile } from "obsidian";
import { CreationField, DATE_INPUTS, fieldOptions, isLinkField, isListField } from "../services/CreationFieldService";
import { ObjectCreationService } from "../services/ObjectCreationService";
import { CreationFilePickerModal } from "./CreationFilePickerModal";

/** Edit the complete draft before creating any vault file. Errors keep the form open. */
export class CreateWorkflowObjectModal extends Modal {
    private resolve: ((file: TFile | null) => void) | null = null;
    private result: TFile | null = null;
    private saving = false;
    private closed = false;
    private pendingEditors = 0;
    private previewGeneration = 0;
    private formEl!: HTMLFieldSetElement;
    private errorEl!: HTMLElement;
    private previewEl!: HTMLElement;
    private directoryInput!: TextComponent;
    private filenameInput!: TextComponent;
    private createButton!: ButtonComponent;
    private cancelButton!: ButtonComponent;

    constructor(app: App, readonly draft: ObjectCreationService) { super(app); }

    onOpen(): void {
        this.modalEl.addClass("wfo-create-modal");
        this.contentEl.createEl("h2", { text: "Create workflow object" });
        this.contentEl.createEl("p", { text: `Object type: ${this.draft.typeName}`, cls: "wfo-create-type" });
        this.formEl = this.contentEl.createEl("fieldset", { cls: "wfo-create-form" });
        this.renderFields(this.formEl, this.draft.fields);
        this.renderLocation();
        this.errorEl = this.contentEl.createEl("p", { cls: "wfo-create-error", attr: { role: "alert" } });
        new Setting(this.contentEl).setClass("wfo-create-actions")
            .addButton(button => {
                this.createButton = button.setButtonText("Create object").setCta().onClick(() => { void this.submit(); });
            })
            .addButton(button => { this.cancelButton = button.setButtonText("Cancel").onClick(() => this.close()); });
        this.refreshPreview();
        this.contentEl.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }

    private renderFields(parent: HTMLElement, fields: CreationField[]): void {
        for (const field of fields) {
            const { definition, kind } = field;
            const options = fieldOptions(definition);
            const section = parent.createDiv({ cls: "wfo-create-field" });
            const row = new Setting(section).setName(definition.name).setDesc(field.hint || definition.type);
            const changed = (): void => { this.refreshPreview(); };
            if (kind === "object" && field.children.length) {
                this.renderFields(section.createDiv({ cls: "wfo-create-nested" }), field.children);
            } else if (kind === "objectlist" && this.draft.fieldService.childDefinitions(field).length) {
                const items = section.createDiv({ cls: "wfo-create-nested" });
                const renderItems = (): void => {
                    items.empty();
                    field.items.forEach((item, index) => {
                        const container = items.createDiv({ cls: "wfo-create-object-item" });
                        new Setting(container).setName(`Item ${index + 1}`).addButton(button => button.setButtonText("Remove item").onClick(() => {
                            field.items.splice(index, 1); renderItems(); changed();
                        }));
                        this.renderFields(container, item);
                    });
                };
                row.addButton(button => button.setButtonText("Add item").onClick(async () => {
                    this.pendingEditors++;
                    button.setDisabled(true);
                    try {
                        const children = await this.draft.fieldService.makeChildren(field);
                        if (!this.closed) { field.items.push(children); renderItems(); changed(); }
                    } finally { this.pendingEditors--; button.setDisabled(false); }
                }));
            } else if (isLinkField(field)) {
                const selected = section.createEl("p", { cls: "wfo-create-links" });
                const display = (): void => selected.setText(field.links.map(item => item.display).join(", ") || "No files selected");
                display();
                row.addButton(button => button.setButtonText("Choose files").onClick(async () => {
                    const links = await new CreationFilePickerModal(this.app, field, this.draft.fieldService).openAndGetValue();
                    if (links && !this.closed) { field.links = links; display(); changed(); }
                })).addButton(button => button.setButtonText("Clear").onClick(() => { field.links = []; display(); changed(); }));
            } else if (kind === "boolean" || kind === "checkbox") {
                row.addToggle(toggle => toggle.setValue(field.checked).onChange(value => { field.checked = value; changed(); }));
            } else if (DATE_INPUTS[kind] || kind === "number") {
                row.addText(text => {
                    text.inputEl.type = DATE_INPUTS[kind] || "number";
                    text.inputEl.setAttribute("aria-label", definition.name);
                    if (kind === "number") for (const attribute of ["min", "max", "step"]) {
                        const value = options[attribute];
                        if (typeof value === "number" || typeof value === "string") text.inputEl.setAttribute(attribute, String(value));
                    }
                    if (kind === "number" && options.step == null) text.inputEl.step = "any";
                    text.setValue(field.text).onChange(value => { field.text = value; changed(); });
                });
            } else if ((kind === "select" || kind === "cycle") && field.choices.length) {
                row.addDropdown(dropdown => {
                    dropdown.selectEl.setAttribute("aria-label", definition.name);
                    dropdown.addOption("", "Choose a value");
                    for (const value of field.choices) dropdown.addOption(value, value);
                    dropdown.setValue(field.text).onChange(value => { field.text = value; changed(); });
                });
            } else if (kind === "multi" && field.choices.length) {
                const choices = section.createDiv({ cls: "wfo-create-choices" });
                for (const value of field.choices) new Setting(choices).setName(value).addToggle(toggle => toggle.onChange(checked => {
                    field.selectedChoices = checked ? [...field.selectedChoices, value] : field.selectedChoices.filter(item => item !== value);
                    changed();
                }));
            } else {
                row.settingEl.addClass("wfo-create-text-field");
                if (isListField(field)) row.setDesc(`Enter values separated by commas or new lines.${field.hint ? ` ${field.hint}` : ""}`);
                if (["object", "objectlist", "json"].includes(kind)) row.setDesc("Enter JSON. Nested values are saved as structured metadata.");
                if (kind === "yaml") row.setDesc("Enter YAML. Nested values are saved as structured metadata.");
                const computed = ["formula", "lookup"].includes(kind);
                if (computed) row.setDesc("Calculated by the schema provider after the note is saved.");
                row.addTextArea(text => {
                    text.inputEl.rows = 3;
                    text.inputEl.setAttribute("aria-label", definition.name);
                    text.setValue(field.text).setDisabled(computed).onChange(value => { field.text = value; changed(); });
                });
            }
        }
    }

    private renderLocation(): void {
        new Setting(this.formEl).setName("File location").setHeading();
        new Setting(this.formEl).setName("Override directory").setDesc("Use a vault-relative directory. Leave it blank for the vault root.")
            .addToggle(toggle => toggle.onChange(enabled => {
                this.draft.folderOverride = enabled ? this.directoryInput.getValue() : undefined;
                this.directoryInput.setDisabled(!enabled);
                this.refreshPreview();
            }));
        new Setting(this.formEl).setName("Directory").addText(text => {
            this.directoryInput = text.setDisabled(true).setPlaceholder("Vault root").onChange(value => {
                this.draft.folderOverride = value; this.refreshPreview();
            });
            text.inputEl.setAttribute("aria-label", "Directory");
        });
        new Setting(this.formEl).setName("Override filename").setDesc("The .md extension is added if omitted.")
            .addToggle(toggle => toggle.onChange(enabled => {
                this.draft.filenameOverride = enabled ? this.filenameInput.getValue() : undefined;
                this.filenameInput.setDisabled(!enabled);
                this.refreshPreview();
            }));
        new Setting(this.formEl).setName("Filename").addText(text => {
            this.filenameInput = text.setDisabled(true).onChange(value => {
                this.draft.filenameOverride = value; this.refreshPreview();
            });
            text.inputEl.setAttribute("aria-label", "Filename");
        });
        this.previewEl = this.formEl.createEl("p", { cls: "wfo-create-path", attr: { "aria-live": "polite" } });
    }

    private refreshPreview(): void {
        if (!this.previewEl || this.closed) return;
        const generation = ++this.previewGeneration;
        void this.draft.preview().then(path => {
            if (generation !== this.previewGeneration) return;
            this.previewEl.setText(`Destination: ${path.fullPath}`);
            if (this.draft.folderOverride === undefined) this.directoryInput.setValue(path.folder);
            if (this.draft.filenameOverride === undefined) this.filenameInput.setValue(`${path.basename}.md`);
        }).catch((error: unknown) => {
            if (generation === this.previewGeneration) this.previewEl.setText(error instanceof Error ? error.message : String(error));
        });
    }

    private async submit(): Promise<void> {
        if (this.saving || this.pendingEditors) return;
        for (const input of Array.from(this.formEl.querySelectorAll("input"))) {
            if (!input.reportValidity()) return;
        }
        this.saving = true;
        this.errorEl.setText("");
        this.formEl.disabled = true;
        this.formEl.inert = true;
        this.createButton.setDisabled(true);
        this.cancelButton.setDisabled(true);
        try {
            this.result = await this.draft.create();
            this.saving = false;
            this.close();
        } catch (error) {
            this.errorEl.setText(error instanceof Error ? error.message : String(error));
            this.errorEl.scrollIntoView({ block: "nearest" });
        } finally {
            this.saving = false;
            this.formEl.disabled = false;
            this.formEl.inert = false;
            this.createButton.setDisabled(false);
            this.cancelButton.setDisabled(false);
        }
    }

    close(): void { if (!this.saving) super.close(); }

    onClose(): void {
        this.closed = true;
        this.previewGeneration++;
        this.contentEl.empty();
        this.resolve?.(this.result);
        this.resolve = null;
    }

    openAndCreate(): Promise<TFile | null> {
        return new Promise(resolve => { this.resolve = resolve; this.open(); });
    }
}
