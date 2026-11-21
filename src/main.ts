import { Plugin, Menu, TAbstractFile, TFile } from "obsidian";
import { TypedNoteWorkflowsSettings, DEFAULT_SETTINGS } from "./types";
import { NoteTypeService } from "./services/NoteTypeService";
import { FrontmatterService } from "./services/FrontmatterService";
import { TypedNoteWorkflowsSettingTab } from "./SettingsTab";
import {
    createNewTypedNote,
    navigateNext,
    navigatePrevious,
    openTypedNote,
    sortFrontmatter,
    sortFrontmatterSchema,
    sortFrontmatterAlphabetical,
    insertMissingFrontmatter,
    cleanFrontmatterInteractive,
    cleanFrontmatterStandard,
    cleanFrontmatterStrict,
    reshelveTypedNote,
    cleanWorkspace,
    curateVault,
    createTypedNoteCatalog,
    cloneNoteType,
    renameNoteType,
    copyFieldsFrom,
    bulkAssignNoteType,
    assignNoteType,
} from "./commands";

export default class TypedNoteWorkflowsPlugin extends Plugin {
    settings: TypedNoteWorkflowsSettings = DEFAULT_SETTINGS;
    noteTypeService!: NoteTypeService;
    private frontmatterService!: FrontmatterService;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Initialize services
        this.noteTypeService = new NoteTypeService(this.app, this.settings);
        this.frontmatterService = new FrontmatterService(
            this.app,
            this.settings,
            this.noteTypeService
        );

        // Register commands
        this.registerCommands();

        // Add settings tab
        this.addSettingTab(new TypedNoteWorkflowsSettingTab(this.app, this));
    }

    onunload(): void {
        // cleanup handled by Obsidian's plugin lifecycle
    }

    private registerCommands(): void {
        // Create commands
        this.addCommand({
            id: "create-new-typed-note",
            name: "Create new typed note",
            callback: () =>
                createNewTypedNote(this.app, this.settings, this.noteTypeService),
        });

        // Navigation commands
        this.addCommand({
            id: "navigate-next",
            name: "Navigate to next typed note with matching note type",
            callback: () => navigateNext(this.app, this.settings, this.noteTypeService),
        });

        this.addCommand({
            id: "navigate-previous",
            name: "Navigate to previous typed note with matching note type",
            callback: () => navigatePrevious(this.app, this.settings, this.noteTypeService),
        });

        this.addCommand({
            id: "open-typed-note",
            name: "Open typed note by note type",
            callback: () =>
                openTypedNote(this.app, this.settings, this.noteTypeService),
        });

        // Frontmatter commands
        this.addCommand({
            id: "sort-frontmatter",
            name: "Sort frontmatter",
            callback: () =>
                sortFrontmatter(this.app, this.settings, this.frontmatterService),
        });

        this.addCommand({
            id: "sort-frontmatter-schema",
            name: "Sort frontmatter (schema order)",
            callback: () =>
                sortFrontmatterSchema(this.app, this.settings, this.frontmatterService),
        });

        this.addCommand({
            id: "sort-frontmatter-alphabetical",
            name: "Sort frontmatter (alphabetical)",
            callback: () =>
                sortFrontmatterAlphabetical(this.app, this.settings, this.frontmatterService),
        });

        this.addCommand({
            id: "insert-missing-frontmatter-alphabetical",
            name: "Insert missing front matter (alphabetical)",
            callback: () =>
                insertMissingFrontmatter(this.app, this.frontmatterService, "alphabetical"),
        });

        this.addCommand({
            id: "insert-missing-frontmatter-schema",
            name: "Insert missing front matter (schema order)",
            callback: () =>
                insertMissingFrontmatter(this.app, this.frontmatterService, "schema"),
        });

        this.addCommand({
            id: "append-missing-frontmatter",
            name: "Append missing front matter",
            callback: () =>
                insertMissingFrontmatter(this.app, this.frontmatterService, "append"),
        });

        this.addCommand({
            id: "prepend-missing-frontmatter",
            name: "Prepend missing front matter",
            callback: () =>
                insertMissingFrontmatter(this.app, this.frontmatterService, "prepend"),
        });

        this.addCommand({
            id: "clean-frontmatter",
            name: "Clean frontmatter (interactive)",
            callback: () =>
                cleanFrontmatterInteractive(
                    this.app,
                    this.settings,
                    this.noteTypeService,
                    this.frontmatterService
                ),
        });

        this.addCommand({
            id: "clean-frontmatter-standard",
            name: "Clean frontmatter (standard)",
            callback: () =>
                cleanFrontmatterStandard(
                    this.app,
                    this.settings,
                    this.noteTypeService,
                    this.frontmatterService
                ),
        });

        this.addCommand({
            id: "clean-frontmatter-strict",
            name: "Clean frontmatter (strict)",
            callback: () =>
                cleanFrontmatterStrict(
                    this.app,
                    this.settings,
                    this.noteTypeService,
                    this.frontmatterService
                ),
        });

        this.addCommand({
            id: "assign-note-type",
            name: "Assign note type",
            callback: () => assignNoteType(
                this.app,
                this.settings,
                this.noteTypeService,
                this.frontmatterService,
                async options => {
                    this.settings.typeAssignment = { ...options };
                    await this.saveSettings();
                }
            ),
        });

        // Storage commands
        this.addCommand({
            id: "reshelve-typed-note",
            name: "Reshelve typed note",
            callback: () => reshelveTypedNote(this.app, this.settings, this.noteTypeService, this.frontmatterService),
        });

        // Workspace commands
        this.addCommand({
            id: "clean-workspace",
            name: "Clean workspace",
            callback: () => cleanWorkspace(this.app),
        });

        // Vault curation commands
        this.addCommand({
            id: "curate-vault",
            name: "Curate vault (clean / sort / reshelve)",
            callback: () =>
                curateVault(
                    this.app,
                    this.settings,
                    this.noteTypeService,
                    this.frontmatterService
                ),
        });

        // Catalog commands
        this.addCommand({
            id: "create-typed-note-catalog",
            name: "Create typed note catalog",
            callback: () =>
                createTypedNoteCatalog(this.app, this.settings, this.noteTypeService),
        });

        // Clone commands
        this.addCommand({
            id: "clone-note-type",
            name: "Clone note type",
            callback: () =>
                cloneNoteType(this.app, this.settings, this.noteTypeService),
        });

        // Rename note type command
        this.addCommand({
            id: "rename-note-type",
            name: "Rename note type",
            callback: () => renameNoteType(this.app, this.settings, this.noteTypeService,
                this.frontmatterService, () => this.saveSettings()),
        });

        // Copy fields commands
        this.addCommand({
            id: "copy-fields-from",
            name: "Copy fields from…",
            callback: () =>
                copyFieldsFrom(this.app, this.settings, this.noteTypeService),
        });

        // Bulk assign commands
        this.addCommand({
            id: "bulk-assign-note-type",
            name: "Bulk assign note type",
            callback: () =>
                bulkAssignNoteType(
                    this.app,
                    this.settings,
                    this.noteTypeService,
                    this.frontmatterService
                ),
        });

        // Schema operations in the file-explorer context menu.
        this.registerEvent(
            this.app.workspace.on(
                "file-menu",
                (menu: Menu, file: TAbstractFile) => {
                    if (!(file instanceof TFile)) return;
                    if (!this.noteTypeService.isNoteTypeDefinitionFile(file)) return;
                    menu.addSeparator();
                    menu.addItem(item => item.setTitle("Rename note type").setIcon("pencil").setSection("action")
                        .onClick(() => renameNoteType(this.app, this.settings, this.noteTypeService,
                            this.frontmatterService, () => this.saveSettings(), file)));
                    menu.addItem((item) =>
                        item
                            .setTitle("Copy fields from…")
                            .setIcon("copy-plus")
                            .setSection("action")
                            .onClick(() =>
                                copyFieldsFrom(
                                    this.app,
                                    this.settings,
                                    this.noteTypeService,
                                    file
                                )
                            )
                    );
                }
            )
        );
    }

    async loadSettings(): Promise<void> {
        // Normalize the legacy key once; consumers and subsequent saves use the new key.
        const { objectSortDirection: legacySortDirection, ...loaded } = await this.loadData() ?? {};
        const savedSortDirection: unknown = loaded.typedNoteSortDirection;
        const typedNoteSortDirection = savedSortDirection === "asc" || savedSortDirection === "desc"
            ? savedSortDirection
            : legacySortDirection === "asc" || legacySortDirection === "desc"
                ? legacySortDirection : DEFAULT_SETTINGS.typedNoteSortDirection;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded, { typedNoteSortDirection });
        this.settings.typeAssignment = {
            ...DEFAULT_SETTINGS.typeAssignment,
            ...loaded?.typeAssignment,
        };

        // Ensure nested objects are properly merged
        if (loaded?.fields) {
            this.settings.fields = Object.assign(
                {},
                DEFAULT_SETTINGS.fields,
                loaded.fields
            );
        }
        if (loaded?.pathMappings) {
            this.settings.pathMappings = loaded.pathMappings;
        }
        if (loaded?.filenameMappings) {
            this.settings.filenameMappings = loaded.filenameMappings;
        }
        if (loaded?.catalogCtimeField) {
            this.settings.catalogCtimeField = Object.assign(
                {},
                DEFAULT_SETTINGS.catalogCtimeField,
                loaded.catalogCtimeField
            );
        }
        if (loaded?.catalogMtimeField) {
            this.settings.catalogMtimeField = Object.assign(
                {},
                DEFAULT_SETTINGS.catalogMtimeField,
                loaded.catalogMtimeField
            );
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);

        // Update services with new settings
        this.noteTypeService = new NoteTypeService(this.app, this.settings);
        this.frontmatterService = new FrontmatterService(
            this.app,
            this.settings,
            this.noteTypeService
        );
    }
}
