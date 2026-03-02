import { App, SuggestModal } from "obsidian";

/**
 * Generic suggester modal using SuggestModal
 */
export class SuggesterModal<T> extends SuggestModal<T> {
    private items: T[];
    private displayFn: (item: T) => string;
    private onSelect: ((item: T | null) => void) | null = null;

    constructor(
        app: App,
        items: T[],
        displayFn: (item: T) => string,
        placeholder?: string
    ) {
        super(app);
        this.items = items;
        this.displayFn = displayFn;
        if (placeholder) {
            this.setPlaceholder(placeholder);
        }
        this.setInstructions([
            { command: "↑↓", purpose: "to navigate" },
            { command: "↵", purpose: "to select" },
            { command: "esc", purpose: "to cancel" },
        ]);
    }

    getSuggestions(query: string): T[] {
        const lowerQuery = query.toLowerCase();
        if (!lowerQuery) return this.items;
        return this.items.filter((item) =>
            this.displayFn(item).toLowerCase().includes(lowerQuery)
        );
    }

    renderSuggestion(item: T, el: HTMLElement): void {
        el.createEl("div", { text: this.displayFn(item) });
    }

    onChooseSuggestion(item: T, _evt: MouseEvent | KeyboardEvent): void {
        if (this.onSelect) {
            const callback = this.onSelect;
            this.onSelect = null;
            callback(item);
        }
    }

    onClose(): void {
        // Delay to let onChooseSuggestion fire first (Obsidian calls onClose before onChooseSuggestion)
        window.setTimeout(() => {
            if (this.onSelect) {
                this.onSelect(null);
                this.onSelect = null;
            }
        }, 10);
    }

    /**
     * Open the modal and return the selected item
     */
    openAndGetValue(): Promise<T | null> {
        return new Promise((resolve) => {
            this.onSelect = resolve;
            this.open();
        });
    }
}

/**
 * Simple string suggester
 */
export class StringSuggesterModal extends SuggesterModal<string> {
    constructor(app: App, items: string[], placeholder?: string) {
        super(app, items, (item) => item, placeholder);
    }
}
