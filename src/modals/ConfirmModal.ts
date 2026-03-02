import { App, Modal, Setting } from "obsidian";

/**
 * Modal for yes/no confirmation
 */
export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private yesText: string;
    private noText: string;
    private onChoice: ((value: boolean) => void) | null = null;

    constructor(
        app: App,
        title: string,
        message: string,
        yesText: string = "Yes",
        noText: string = "No"
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.yesText = yesText;
        this.noText = noText;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h3", { text: this.title });
        
        const msgEl = contentEl.createEl("div", { cls: "workflow-objects-confirm-message" });
        msgEl.style.whiteSpace = "pre-wrap";
        msgEl.style.marginBottom = "1em";
        msgEl.setText(this.message);

        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText(this.yesText).setCta().onClick(() => {
                    if (this.onChoice) {
                        this.onChoice(true);
                        this.onChoice = null;
                    }
                    this.close();
                })
            )
            .addButton((btn) =>
                btn.setButtonText(this.noText).onClick(() => {
                    if (this.onChoice) {
                        this.onChoice(false);
                        this.onChoice = null;
                    }
                    this.close();
                })
            );
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        // If onChoice still set, user closed without choosing (treat as no)
        if (this.onChoice) {
            this.onChoice(false);
            this.onChoice = null;
        }
    }

    /**
     * Open the modal and return the user's choice
     */
    openAndGetValue(): Promise<boolean> {
        return new Promise((resolve) => {
            this.onChoice = resolve;
            this.open();
        });
    }
}
