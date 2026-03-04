import { App, PluginSettingTab, Setting } from "obsidian";
import WorkflowObjectsPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

// ─── Shared template syntax description ───────────────────────────────────────

const TEMPLATE_SYNTAX = [
    "Templates expand {{field}} placeholders using the note's frontmatter.",
    "Any frontmatter field can be used, not just title.",
    "",
    "Modifiers (stackable, separated by ::):",
    "  {{field::prefix:/}}          → prepend '/' when the field has a value",
    "  {{field::suffix:-}}          → append '-' when the field has a value",
    "  {{field::default:unknown}}   → use 'unknown' when the field is absent",
    "",
    "Examples:",
    "  {{production-role::default:artifact}}",
    "  {{section::prefix:/}}{{title}}",
    "  {{tag::prefix:[::suffix:]}}",
].join("\n");

// ─── Settings tab ─────────────────────────────────────────────────────────────

export class WorkflowObjectsSettingTab extends PluginSettingTab {
    plugin: WorkflowObjectsPlugin;

    constructor(app: App, plugin: WorkflowObjectsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Type Definitions ──────────────────────────────────────────────────
        new Setting(containerEl).setName("Type definitions").setHeading();

        new Setting(containerEl)
            .setName("Types path")
            .setDesc(
                "Vault path to a folder of type-definition notes. " +
                "Each note's filename becomes a type name and its frontmatter fields " +
                "define the schema for workflow objects of that type. " +
                "Leave empty to auto-read from the Metadata Menu plugin."
            )
            .addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.typesPath || "")
                    .onChange(async (value) => {
                        this.plugin.settings.typesPath = value || null;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Fallback types path")
            .setDesc(
                "Path used when Metadata Menu is not installed and no Types path is set. " +
                "Defaults to '" + DEFAULT_SETTINGS.typesPathFallback + "'."
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.typesPathFallback)
                    .setValue(this.plugin.settings.typesPathFallback)
                    .onChange(async (value) => {
                        this.plugin.settings.typesPathFallback =
                            value || DEFAULT_SETTINGS.typesPathFallback;
                        await this.plugin.saveSettings();
                    })
            );

        // ── Field Names ───────────────────────────────────────────────────────
        new Setting(containerEl).setName("Field names").setHeading();

        const resolvedTypeField = this.plugin.typeService.getTypeFieldName();
        const typeFieldDesc = this.plugin.settings.fields.type
            ? "Frontmatter field that identifies a note's workflow object type. " +
              "Used by navigation, reshelving, and open-by-type commands."
            : "Frontmatter field that identifies a note's workflow object type. " +
              `Auto-detected as "${resolvedTypeField}" from Metadata Menu. ` +
              "Set manually to override.";

        new Setting(containerEl)
            .setName("Type field")
            .setDesc(typeFieldDesc)
            .addText((text) =>
                text
                    .setPlaceholder(resolvedTypeField)
                    .setValue(this.plugin.settings.fields.type)
                    .onChange(async (value) => {
                        this.plugin.settings.fields.type = value.trim();
                        await this.plugin.saveSettings();
                        this.display();
                    })
            );

        new Setting(containerEl)
            .setName("Title field")
            .setDesc(
                "Frontmatter field used as the human-readable title of a workflow object. " +
                "Referenced as {{title}} in path and filename templates."
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.fields.title)
                    .setValue(this.plugin.settings.fields.title)
                    .onChange(async (value) => {
                        this.plugin.settings.fields.title =
                            value || DEFAULT_SETTINGS.fields.title;
                        await this.plugin.saveSettings();
                    })
            );

        // ── Behaviour ─────────────────────────────────────────────────────────
        new Setting(containerEl).setName("Behaviour").setHeading();

        new Setting(containerEl)
            .setName("Wrap around navigation")
            .setDesc(
                "When navigating past the last workflow object of a type, wrap around to the first (and vice versa). " +
                "Disable to stop at the boundary."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.wrapAround)
                    .onChange(async (value) => {
                        this.plugin.settings.wrapAround = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Default field sort")
            .setDesc(
                "Sort order applied by 'Sort frontmatter' when no explicit order is requested. " +
                "'Schema order' follows the field sequence defined in the type definition; " +
                "'Alphabetical' sorts A–Z regardless of schema."
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("schema", "Schema order")
                    .addOption("alphabetical", "Alphabetical")
                    .setValue(this.plugin.settings.defaultFieldSort)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultFieldSort = value as "schema" | "alphabetical";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Object list sort direction")
            .setDesc(
                "Sort order for file lists shown when navigating or opening objects by type. " +
                "Descending places the most recent timestamped filenames first, " +
                "which is usually the most useful order."
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("desc", "Descending (newest first)")
                    .addOption("asc", "Ascending (oldest first)")
                    .setValue(this.plugin.settings.objectSortDirection)
                    .onChange(async (value) => {
                        this.plugin.settings.objectSortDirection = value as "asc" | "desc";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Maximum title length")
            .setDesc(
                "Maximum number of characters taken from the title field when constructing filenames. " +
                "Longer titles are truncated at this limit before sanitisation."
            )
            .addText((text) =>
                text
                    .setPlaceholder(String(DEFAULT_SETTINGS.maxTitleLength))
                    .setValue(String(this.plugin.settings.maxTitleLength))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.maxTitleLength = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Date format")
            .setDesc(
                "Moment.js format string used when writing date-type fields into new workflow objects. " +
                "Example: 'YYYY-MM-DDTHH:mm' produces '2024-03-15T09:30'."
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
                    .setValue(this.plugin.settings.dateFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.dateFormat =
                            value || DEFAULT_SETTINGS.dateFormat;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Date prefix source fields")
            .setDesc(
                "Frontmatter fields to check (in order) when determining the date used in a filename prefix during reshelving. " +
                "The first field that contains a valid date wins. " +
                "Falls back to the file's creation time if none are found. " +
                "One field name per line."
            )
            .addTextArea((text) =>
                text
                    .setPlaceholder(
                        DEFAULT_SETTINGS.titlePrefixDateProperties.join("\n")
                    )
                    .setValue(
                        this.plugin.settings.titlePrefixDateProperties.join("\n")
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.titlePrefixDateProperties = value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        await this.plugin.saveSettings();
                    })
            );

        // ── Object catalog defaults ───────────────────────────────────────────
        new Setting(containerEl).setName("Object catalog defaults").setHeading();

        const catalogDesc = containerEl.createEl("p", { cls: "setting-item-description" });
        catalogDesc.createEl("span", {
            text:
                "Default paths used when creating a new workflow object catalog (.base file). " +
                "Use {{content-type}} in either template to insert the selected object type name.",
        });

        new Setting(containerEl)
            .setName("Catalog directory")
            .setDesc(
                "Vault folder where catalog files are created. " +
                "Leave empty to place catalogs in the vault root. " +
                "Folders are created automatically as needed. " +
                "Use {{content-type}} to insert the object type name."
            )
            .addText((text) =>
                text
                    .setPlaceholder("(vault root)")
                    .setValue(this.plugin.settings.catalogDir)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogDir = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Catalog filename")
            .setDesc(
                "Filename template for new catalog files (must end with .base). " +
                "Example: 'catalog.{{content-type}}.base'."
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.catalogFilename)
                    .setValue(this.plugin.settings.catalogFilename)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogFilename =
                            value || DEFAULT_SETTINGS.catalogFilename;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Remap field names to display names")
            .setDesc(
                "Default for the per-catalog checkbox. " +
                "When on, newly created catalogs register sentence-case display names for all schema fields " +
                "(e.g. \"workflow-effort\" → \"Workflow effort\"). " +
                "Can be overridden each time in the catalog creation dialog."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.catalogRemapDisplayNames)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogRemapDisplayNames = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Include \"date created\" column (file.ctime)")
            .setDesc(
                "Append a creation-date column to generated catalogs by default. " +
                "The text field sets the default display name for the column header."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.catalogCtimeField.enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogCtimeField = {
                            ...this.plugin.settings.catalogCtimeField,
                            enabled: value,
                        };
                        await this.plugin.saveSettings();
                    })
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.catalogCtimeField.displayName)
                    .setValue(this.plugin.settings.catalogCtimeField.displayName)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogCtimeField = {
                            ...this.plugin.settings.catalogCtimeField,
                            displayName: value || DEFAULT_SETTINGS.catalogCtimeField.displayName,
                        };
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Include \"date modified\" column (file.mtime)")
            .setDesc(
                "Append a last-modified column to generated catalogs by default. " +
                "The text field sets the default display name for the column header."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.catalogMtimeField.enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogMtimeField = {
                            ...this.plugin.settings.catalogMtimeField,
                            enabled: value,
                        };
                        await this.plugin.saveSettings();
                    })
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.catalogMtimeField.displayName)
                    .setValue(this.plugin.settings.catalogMtimeField.displayName)
                    .onChange(async (value) => {
                        this.plugin.settings.catalogMtimeField = {
                            ...this.plugin.settings.catalogMtimeField,
                            displayName: value || DEFAULT_SETTINGS.catalogMtimeField.displayName,
                        };
                        await this.plugin.saveSettings();
                    })
            );

        // ── Path Mappings ─────────────────────────────────────────────────────
        new Setting(containerEl).setName("Path mappings").setHeading();

        const pathDesc = containerEl.createEl("p", { cls: "setting-item-description" });
        pathDesc.createEl("span", {
            text: "Map a workflow object's type value to a destination folder. " +
                  "The pattern is a regex matched against the type field value; " +
                  "the first matching rule wins. " +
                  "Regex capture groups are available as $1, $2, … in the template.",
        });
        pathDesc.createEl("br");
        pathDesc.createEl("br");
        pathDesc.createEl("span", { text: "Example: pattern ^(.+)$ → template content/$1 puts every type under content/<type>." });
        pathDesc.createEl("br");
        pathDesc.createEl("br");
        pathDesc.createEl("span", { text: TEMPLATE_SYNTAX, cls: "workflow-objects-code-hint" });

        const mappingsContainer = containerEl.createDiv({ cls: "path-mappings" });
        this.renderPathMappings(mappingsContainer);

        // ── Filename Mappings ─────────────────────────────────────────────────
        new Setting(containerEl).setName("Filename mappings").setHeading();

        const filenameDesc = containerEl.createEl("p", { cls: "setting-item-description" });
        filenameDesc.createEl("span", {
            text: "Map a workflow object's type value to a filename template. " +
                  "The first matching pattern wins. " +
                  "{{date}} expands to the date prefix (YYYYMMDDTHHmm). " +
                  "Any other {{field}} expands using the note's frontmatter.",
        });
        filenameDesc.createEl("br");
        filenameDesc.createEl("br");
        filenameDesc.createEl("span", {
            text: "Example: {{date::YYYYMMDDTHHmm}}--{{title}} produces '20240315T0930--My Note'.",
        });
        filenameDesc.createEl("br");
        filenameDesc.createEl("br");
        filenameDesc.createEl("span", { text: TEMPLATE_SYNTAX, cls: "workflow-objects-code-hint" });

        const filenameMappingsContainer = containerEl.createDiv({ cls: "filename-mappings" });
        this.renderFilenameMappings(filenameMappingsContainer);
    }

    // ── Generic mapping renderer ───────────────────────────────────────────────

    /**
     * Render a reorderable list of [pattern, template] mappings.
     *
     * Each row has:
     *  • A drag handle (⠿) — HTML5 drag-and-drop for mouse/touch reordering.
     *  • ↑ / ↓ buttons   — keyboard-accessible move controls.
     *  • Pattern and template inputs.
     *  • A remove (✕) button.
     *
     * @param container   The host element to render into.
     * @param mappings    Reference to the live settings array.
     * @param rowCls      CSS class for each row element.
     * @param patternPh   Placeholder text for the pattern input.
     * @param templatePh  Placeholder text for the template input.
     * @param defaultRow  Factory for the default [pattern, template] when adding.
     * @param onUpdate    Called after any mutation so the caller can save + re-render.
     */
    private renderMappingList(
        container: HTMLElement,
        mappings: [string, string][],
        rowCls: string,
        patternPh: string,
        templatePh: string,
        defaultRow: () => [string, string],
        onUpdate: () => Promise<void>
    ): void {
        container.empty();

        // Track which row is being dragged so we can compute the drop target.
        let dragSourceIndex = -1;

        for (let i = 0; i < mappings.length; i++) {
            const [pattern, template] = mappings[i];

            const rowEl = container.createDiv({ cls: `mapping-row ${rowCls}` });
            rowEl.setAttr("draggable", "true");
            rowEl.setAttr("aria-label", `Mapping ${i + 1} of ${mappings.length}`);

            // ── Drag handle ──────────────────────────────────────────────────
            const handle = rowEl.createSpan({ cls: "mapping-drag-handle", text: "⠿" });
            handle.setAttr("aria-hidden", "true");
            handle.setAttr("title", "Drag to reorder");

            // HTML5 drag-and-drop — attached to the whole row but initiated via
            // the handle so accidental drags on inputs are avoided.
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
                // Highlight the row the user is hovering over.
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

                // Reorder: remove the dragged item and insert it at the drop position.
                const [moved] = mappings.splice(dragSourceIndex, 1);
                mappings.splice(i, 0, moved);
                dragSourceIndex = -1;
                void onUpdate();
            });

            // ── Move up / Move down buttons ──────────────────────────────────
            const reorderGroup = rowEl.createDiv({ cls: "mapping-reorder-group" });

            const upBtn = reorderGroup.createEl("button", {
                cls: "mapping-reorder-btn",
                text: "↑",
            });
            upBtn.setAttr("aria-label", "Move up");
            upBtn.setAttr("title", "Move up");
            if (i === 0) upBtn.setAttr("disabled", "true");
            upBtn.addEventListener("click", () => {
                if (i === 0) return;
                [mappings[i - 1], mappings[i]] = [mappings[i], mappings[i - 1]];
                void onUpdate();
            });

            const downBtn = reorderGroup.createEl("button", {
                cls: "mapping-reorder-btn",
                text: "↓",
            });
            downBtn.setAttr("aria-label", "Move down");
            downBtn.setAttr("title", "Move down");
            if (i === mappings.length - 1) downBtn.setAttr("disabled", "true");
            downBtn.addEventListener("click", () => {
                if (i === mappings.length - 1) return;
                [mappings[i], mappings[i + 1]] = [mappings[i + 1], mappings[i]];
                void onUpdate();
            });

            // ── Pattern input ────────────────────────────────────────────────
            const patternInput = rowEl.createEl("input", {
                type: "text",
                value: pattern,
                placeholder: patternPh,
            });
            patternInput.addEventListener("change", () => {
                mappings[i][0] = patternInput.value;
                void this.plugin.saveSettings();
            });

            rowEl.createSpan({ text: "→", cls: "mapping-arrow" });

            // ── Template input ───────────────────────────────────────────────
            const templateInput = rowEl.createEl("input", {
                type: "text",
                value: template,
                placeholder: templatePh,
            });
            templateInput.addEventListener("change", () => {
                mappings[i][1] = templateInput.value;
                void this.plugin.saveSettings();
            });

            // ── Remove button ────────────────────────────────────────────────
            const removeBtn = rowEl.createEl("button", {
                cls: "mapping-remove-btn",
                text: "✕",
            });
            removeBtn.setAttr("aria-label", "Remove mapping");
            removeBtn.setAttr("title", "Remove");
            removeBtn.addEventListener("click", () => {
                mappings.splice(i, 1);
                void onUpdate();
            });
        }

        // ── Add row ──────────────────────────────────────────────────────────
        const addBtn = container.createEl("button", {
            cls: "mapping-add-btn",
            text: "Add mapping",
        });
        addBtn.addEventListener("click", () => {
            mappings.push(defaultRow());
            void onUpdate();
        });
    }

    // ── Thin wrappers kept for backward-compat (called from display()) ────────

    private renderPathMappings(container: HTMLElement): void {
        this.renderMappingList(
            container,
            this.plugin.settings.pathMappings,
            "path-mapping",
            "Pattern (regex, e.g. ^(.+)$)",
            "Template (e.g. content/$1/{{title::prefix:_}})",
            () => ["^(.+)$", "content/$1"],
            async () => {
                await this.plugin.saveSettings();
                this.renderPathMappings(container);
            }
        );
    }

    private renderFilenameMappings(container: HTMLElement): void {
        this.renderMappingList(
            container,
            this.plugin.settings.filenameMappings,
            "filename-mapping",
            "Pattern (regex, e.g. ^.*$)",
            "Template (e.g. {{date}}--{{title}})",
            () => ["^.*$", "{{date::YYYYMMDDTHHmm}}--{{title}}"],
            async () => {
                await this.plugin.saveSettings();
                this.renderFilenameMappings(container);
            }
        );
    }
}
