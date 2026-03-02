import { App, Modal, Setting } from "obsidian";

/**
 * Modal for text input
 */
export class InputModal extends Modal {
    private defaultValue: string;
    private promptText: string;
    private placeholder: string;
    private onSubmit: ((value: string | null) => void) | null = null;
    private inputEl: HTMLInputElement | null = null;

    constructor(
        app: App,
        promptText: string,
        placeholder: string = "",
        defaultValue: string = ""
    ) {
        super(app);
        this.promptText = promptText;
        this.placeholder = placeholder;
        this.defaultValue = defaultValue;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h3", { text: this.promptText });

        new Setting(contentEl)
            .setName("")
            .addText((text) => {
                this.inputEl = text.inputEl;
                text.setPlaceholder(this.placeholder)
                    .setValue(this.defaultValue);
                
                text.inputEl.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        this.submitValue();
                    }
                });
            });

        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText("OK").setCta().onClick(() => {
                    this.submitValue();
                })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => {
                    this.close();
                })
            );

        // Focus and select
        window.setTimeout(() => {
            if (this.inputEl) {
                this.inputEl.focus();
                this.inputEl.select();
            }
        }, 10);
    }

    private submitValue(): void {
        const value = this.inputEl?.value.trim() || "";
        if (this.onSubmit) {
            this.onSubmit(value || null);
            this.onSubmit = null;
        }
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        // If onSubmit still set, user cancelled
        if (this.onSubmit) {
            this.onSubmit(null);
            this.onSubmit = null;
        }
        this.inputEl = null;
    }

    /**
     * Open the modal and return the entered value
     */
    openAndGetValue(): Promise<string | null> {
        return new Promise((resolve) => {
            this.onSubmit = resolve;
            this.open();
        });
    }
}
