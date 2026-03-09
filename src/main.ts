import { Plugin, Menu, TAbstractFile, TFile } from "obsidian";
import { WorkflowObjectsSettings, DEFAULT_SETTINGS } from "./types";
import { TypeService } from "./services/TypeService";
import { FrontmatterService } from "./services/FrontmatterService";
import { WorkflowObjectsSettingTab } from "./SettingsTab";
import {
    createNewWorkflowObject,
    navigateNext,
    navigatePrevious,
    openWorkflowObject,
    sortFrontmatter,
    sortFrontmatterSchema,
    sortFrontmatterAlphabetical,
    cleanFrontmatterInteractive,
    cleanFrontmatterStandard,
    cleanFrontmatterStrict,
    reshelveWorkflowObject,
    cleanWorkspace,
    curateVault,
    createWorkflowObjectCatalog,
    cloneObjectType,
    copyFieldsFrom,
} from "./commands";

export default class WorkflowObjectsPlugin extends Plugin {
    settings: WorkflowObjectsSettings = DEFAULT_SETTINGS;
    typeService!: TypeService;
    private frontmatterService!: FrontmatterService;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Initialize services
        this.typeService = new TypeService(this.app, this.settings);
        this.frontmatterService = new FrontmatterService(
            this.app,
            this.settings,
            this.typeService
        );

        // Register commands
        this.registerCommands();

        // Add settings tab
        this.addSettingTab(new WorkflowObjectsSettingTab(this.app, this));
    }

    onunload(): void {
        // cleanup handled by Obsidian's plugin lifecycle
    }

    private registerCommands(): void {
        // Create commands
        this.addCommand({
            id: "create-new-workflow-object",
            name: "Create new workflow object",
            callback: () =>
                createNewWorkflowObject(this.app, this.settings, this.typeService),
        });

        // this.addCommand({
        //     id: "create-new-workflow-object-simple",
        //     name: "Create new workflow object (simple)",
        //     callback: () =>
        //         createNewWorkflowObjectSimple(this.app, this.settings, this.typeService),
        // });

        // Navigation commands
        this.addCommand({
            id: "navigate-next",
            name: "Navigate to next workflow object of same type",
            callback: () => navigateNext(this.app, this.settings, this.typeService),
        });

        this.addCommand({
            id: "navigate-previous",
            name: "Navigate to previous workflow object of same type",
            callback: () => navigatePrevious(this.app, this.settings, this.typeService),
        });

        this.addCommand({
            id: "open-workflow-object",
            name: "Open workflow object by type",
            callback: () =>
                openWorkflowObject(this.app, this.settings, this.typeService),
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
            id: "clean-frontmatter",
            name: "Clean frontmatter (interactive)",
            callback: () =>
                cleanFrontmatterInteractive(
                    this.app,
                    this.settings,
                    this.typeService,
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
                    this.typeService,
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
                    this.typeService,
                    this.frontmatterService
                ),
        });

        // Storage commands
        this.addCommand({
            id: "reshelve-workflow-object",
            name: "Reshelve workflow object",
            callback: () => reshelveWorkflowObject(this.app, this.settings, this.typeService),
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
                    this.typeService,
                    this.frontmatterService
                ),
        });

        // Catalog commands
        this.addCommand({
            id: "create-workflow-object-catalog",
            name: "Create new workflow object catalog",
            callback: () =>
                createWorkflowObjectCatalog(this.app, this.settings, this.typeService),
        });

        // Clone commands
        this.addCommand({
            id: "clone-object-type",
            name: "Clone object type",
            callback: () =>
                cloneObjectType(this.app, this.settings, this.typeService),
        });

        // Copy fields commands
        this.addCommand({
            id: "copy-fields-from",
            name: "Copy fields from…",
            callback: () =>
                copyFieldsFrom(this.app, this.settings, this.typeService),
        });

        // File-explorer context menu: show "Copy fields from…" on type definition files
        this.registerEvent(
            this.app.workspace.on(
                "file-menu",
                (menu: Menu, file: TAbstractFile) => {
                    if (!(file instanceof TFile)) return;
                    if (!this.typeService.isTypeDefinitionFile(file)) return;
                    menu.addSeparator();
                    menu.addItem((item) =>
                        item
                            .setTitle("Copy fields from…")
                            .setIcon("copy-plus")
                            .setSection("action")
                            .onClick(() =>
                                copyFieldsFrom(
                                    this.app,
                                    this.settings,
                                    this.typeService,
                                    file
                                )
                            )
                    );
                }
            )
        );
    }

    async loadSettings(): Promise<void> {
        const loaded = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

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
        this.typeService = new TypeService(this.app, this.settings);
        this.frontmatterService = new FrontmatterService(
            this.app,
            this.settings,
            this.typeService
        );
    }
}
