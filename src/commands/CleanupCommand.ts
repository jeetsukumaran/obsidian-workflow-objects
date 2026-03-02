import { App, Notice } from "obsidian";
import {
    WorkflowObjectsSettings,
    CleanupOptions,
    DEFAULT_CLEANUP_OPTIONS,
} from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { StringSuggesterModal, ConfirmModal } from "../modals";
import { getActiveFileWithMeta, formatValueForDisplay } from "../utils/helpers";

/**
 * Sort frontmatter fields (using default from settings)
 */
export async function sortFrontmatter(
    app: App,
    settings: WorkflowObjectsSettings,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    await frontmatterService.sortFrontmatter(result.file, "default");
}

/**
 * Sort frontmatter fields according to schema order
 */
export async function sortFrontmatterSchema(
    app: App,
    settings: WorkflowObjectsSettings,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    await frontmatterService.sortFrontmatter(result.file, "schema");
}

/**
 * Sort frontmatter fields alphabetically
 */
export async function sortFrontmatterAlphabetical(
    app: App,
    settings: WorkflowObjectsSettings,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    await frontmatterService.sortFrontmatter(result.file, "alphabetical");
}

/**
 * Clean frontmatter with interactive profile selection
 */
export async function cleanFrontmatterInteractive(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const { file, frontmatter } = result;
    const typeValue = frontmatter[typeService.getTypeFieldName()] as string;

    const { typeInfo, schemaComplete } = typeService.resolveTypeInfo(typeValue || undefined);

    // Build menu options
    const menuOptions = [
        "Sort alphabetical",
        "Sort following schema",
        "Ensure schema (default sort)",
        "Ensure schema (select sort...)",
        "Enforce schema (default sort)",
        "Enforce schema (select sort...)",
        "Custom...",
    ];

    const menuSuggester = new StringSuggesterModal(
        app,
        menuOptions,
        "Select cleanup action"
    );
    const selectedOption = await menuSuggester.openAndGetValue();
    if (!selectedOption) return;

    let options: CleanupOptions;

    switch (selectedOption) {
        case "Sort alphabetical":
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: false,
                addMissingFields: false,
                sortMode: "alphabetical",
            };
            break;

        case "Sort following schema":
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: false,
                addMissingFields: false,
                sortMode: "schema",
            };
            break;

        case "Ensure schema (default sort)":
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: false,
                addMissingFields: true,
                sortMode: settings.defaultFieldSort,
            };
            break;

        case "Ensure schema (select sort...)": {
            const sortMode = await getSortModeChoice(app);
            if (sortMode === null) return;
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: false,
                addMissingFields: true,
                sortMode,
            };
            break;
        }

        case "Enforce schema (default sort)":
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: true,
                addMissingFields: true,
                sortMode: settings.defaultFieldSort,
            };
            break;

        case "Enforce schema (select sort...)": {
            const sortMode = await getSortModeChoice(app);
            if (sortMode === null) return;
            options = {
                preserveDefinedFields: true,
                removeUndefinedFields: true,
                addMissingFields: true,
                sortMode,
            };
            break;
        }

        case "Custom...":
            options = await getCustomCleanupOptions(app, settings);
            break;

        default:
            return;
    }

    // Analyze and confirm if deleting non-empty fields
    const analysis = frontmatterService.analyzeCleanup(frontmatter, typeInfo, options, schemaComplete);
    const nonEmptyDeletions = analysis.toRemove.filter((item) => !item.isEmpty);

    if (nonEmptyDeletions.length > 0) {
        const fieldList = nonEmptyDeletions
            .map((item) => `• ${item.key}: ${formatValueForDisplay(item.value)}`)
            .join("\n");

        const confirmModal = new ConfirmModal(
            app,
            `Delete ${nonEmptyDeletions.length} field(s) with values?`,
            `The following fields will be permanently deleted:\n\n${fieldList}`,
            "Delete",
            "Cancel"
        );
        const confirm = await confirmModal.openAndGetValue();
        if (!confirm) return;
    }

    const stats = await frontmatterService.cleanFrontmatter(file, options);
    showCleanupStats(stats, options.sortMode);
}

/**
 * Clean frontmatter with standard (inclusive) options
 */
export async function cleanFrontmatterStandard(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const { file, frontmatter } = result;
    const typeValue = frontmatter[typeService.getTypeFieldName()] as string;

    if (typeValue && !typeService.typeExists(typeValue)) {
        new Notice(`Type "${typeValue}" not found`);
        return;
    }

    const options: CleanupOptions = {
        ...DEFAULT_CLEANUP_OPTIONS,
        sortMode: settings.defaultFieldSort,
    };

    const stats = await frontmatterService.cleanFrontmatter(file, options);
    showCleanupStats(stats, options.sortMode);
}

/**
 * Clean frontmatter with strict (exclusive) options
 */
export async function cleanFrontmatterStrict(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const { file, frontmatter } = result;
    const typeValue = frontmatter[typeService.getTypeFieldName()] as string;

    if (typeValue && !typeService.typeExists(typeValue)) {
        new Notice(`Type "${typeValue}" not found`);
        return;
    }

    const options: CleanupOptions = {
        preserveDefinedFields: true,
        removeUndefinedFields: true,
        addMissingFields: true,
        sortMode: settings.defaultFieldSort,
    };

    const stats = await frontmatterService.cleanFrontmatter(file, options);
    showCleanupStats(stats, options.sortMode);
}

/**
 * Get sort mode choice through interactive prompt
 */
async function getSortModeChoice(
    app: App
): Promise<"schema" | "alphabetical" | "none" | null> {
    const sortOptions = ["Schema order", "Alphabetical", "No sorting"];
    const sortSuggester = new StringSuggesterModal(
        app,
        sortOptions,
        "Select field sort order"
    );
    const sortChoice = await sortSuggester.openAndGetValue();
    if (!sortChoice) return null;

    switch (sortChoice) {
        case "Schema order":
            return "schema";
        case "Alphabetical":
            return "alphabetical";
        case "No sorting":
            return "none";
        default:
            return "schema";
    }
}

/**
 * Get custom cleanup options through interactive prompts
 */
async function getCustomCleanupOptions(
    app: App,
    settings: WorkflowObjectsSettings
): Promise<CleanupOptions> {
    const options: CleanupOptions = {
        preserveDefinedFields: true,
        removeUndefinedFields: false,
        addMissingFields: true,
        sortMode: settings.defaultFieldSort,
    };

    const q1 = new ConfirmModal(
        app,
        "Preserve defined fields?",
        "Keep fields defined in type schema even if empty?"
    );
    options.preserveDefinedFields = await q1.openAndGetValue();

    const q2 = new ConfirmModal(
        app,
        "Remove undefined fields?",
        "Delete fields NOT in type schema (even if they have values)?"
    );
    options.removeUndefinedFields = await q2.openAndGetValue();

    const q3 = new ConfirmModal(
        app,
        "Add missing fields?",
        "Add fields from type schema that are missing?"
    );
    options.addMissingFields = await q3.openAndGetValue();

    const sortMode = await getSortModeChoice(app);
    if (sortMode !== null) {
        options.sortMode = sortMode;
    }

    return options;
}

/**
 * Display cleanup statistics
 */
function showCleanupStats(
    stats: { removed: string[]; added: string[]; preserved: string[] },
    sortMode: "schema" | "alphabetical" | "none"
): void {
    const parts: string[] = [];
    if (stats.removed.length) parts.push(`removed ${stats.removed.length}`);
    if (stats.added.length) parts.push(`added ${stats.added.length}`);
    if (stats.preserved.length) parts.push(`preserved ${stats.preserved.length} empty`);
    if (sortMode !== "none") parts.push(`sorted (${sortMode})`);

    new Notice(parts.length ? parts.join(", ") : "No changes");
}
