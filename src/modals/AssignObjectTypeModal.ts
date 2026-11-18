import { App, Modal, Setting } from "obsidian";
import { TypeAssignmentOptions } from "../types";

/** Options for assigning the active object to a selected type. */
export class AssignObjectTypeModal extends Modal {
    private options: TypeAssignmentOptions;
    private submitted = false;
    private onSubmit: ((options: TypeAssignmentOptions | null) => void) | null = null;

    constructor(
        app: App,
        private typeNames: string[],
        private filePath: string,
        defaults: TypeAssignmentOptions
    ) {
        super(app);
        this.options = { ...defaults };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Assign object to different type" });
        contentEl.createEl("p", { text: this.filePath, cls: "setting-item-description" });

        new Setting(contentEl)
            .setName("New object type")
            .setDesc("Select a content type from the type definitions folder.")
            .addDropdown(dropdown => {
                for (const name of this.typeNames) dropdown.addOption(name, name);
                dropdown.setValue(this.options.targetType).onChange(value => { this.options.targetType = value; });
            });

        new Setting(contentEl).setName("File location").setHeading();
        let renameRow: Setting;
        let reshelveRow: Setting;
        new Setting(contentEl)
            .setName("Update file location")
            .setDesc("Enable automatic renaming and moving using the new object type.")
            .addToggle(toggle => toggle.setValue(this.options.updateFileLocation).onChange(value => {
                this.options.updateFileLocation = value;
                renameRow.setDisabled(!value);
                reshelveRow.setDisabled(!value);
            }));
        renameRow = new Setting(contentEl)
            .setName("Auto-rename")
            .setDesc("Apply filename rules using the current title. Keep the folder unless auto-reshelve is enabled.")
            .addToggle(toggle => toggle.setValue(this.options.autoRename).onChange(value => { this.options.autoRename = value; }))
            .setDisabled(!this.options.updateFileLocation);
        reshelveRow = new Setting(contentEl)
            .setName("Auto-reshelve")
            .setDesc("Move to the folder determined by the new type's path rules. Keep the filename unless auto-rename is enabled.")
            .addToggle(toggle => toggle.setValue(this.options.autoReshelve).onChange(value => { this.options.autoReshelve = value; }))
            .setDisabled(!this.options.updateFileLocation);

        new Setting(contentEl).setName("Metadata").setHeading();
        new Setting(contentEl)
            .setName("Add missing fields")
            .setDesc("Add defaults from the complete new schema. Preserve values in fields already present.")
            .addToggle(toggle => toggle.setValue(this.options.addMissingFields).onChange(value => { this.options.addMissingFields = value; }));
        new Setting(contentEl)
            .setName("Remove fields outside the new schema")
            .setDesc("Keep fields required by inherited and contextual classes. The type field and tags that bind classes are retained.")
            .addDropdown(dropdown => dropdown
                .addOption("empty", "Only if empty")
                .addOption("all", "Even if not empty")
                .addOption("never", "Never: preserve all fields")
                .setValue(this.options.removeFields)
                .onChange(value => { this.options.removeFields = value as TypeAssignmentOptions["removeFields"]; }));

        let positionRow: Setting;
        new Setting(contentEl)
            .setName("Sort fields")
            .addDropdown(dropdown => dropdown
                .addOption("schema", "Following schema")
                .addOption("alphabetical", "Alphabetically")
                .addOption("none", "Do not sort")
                .setValue(this.options.sortMode)
                .onChange(value => {
                    this.options.sortMode = value as TypeAssignmentOptions["sortMode"];
                    positionRow.settingEl.toggle(value === "none");
                }));
        positionRow = new Setting(contentEl)
            .setName("New fields")
            .setDesc("Preserve the order of existing fields and place new fields at the selected end.")
            .addDropdown(dropdown => dropdown
                .addOption("append", "Appended")
                .addOption("prepend", "Prepended")
                .setValue(this.options.newFieldsPosition)
                .onChange(value => { this.options.newFieldsPosition = value as TypeAssignmentOptions["newFieldsPosition"]; }));
        positionRow.settingEl.toggle(this.options.sortMode === "none");

        new Setting(contentEl)
            .addButton(button => button.setButtonText("Review fields").setCta().onClick(() => {
                if (!this.typeNames.includes(this.options.targetType)) return;
                this.submitted = true;
                this.close();
            }))
            .addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.onSubmit) {
            const resolve = this.onSubmit;
            this.onSubmit = null;
            resolve(this.submitted ? { ...this.options } : null);
        }
    }

    openAndGetValue(): Promise<TypeAssignmentOptions | null> {
        return new Promise(resolve => {
            this.onSubmit = resolve;
            this.open();
        });
    }
}
