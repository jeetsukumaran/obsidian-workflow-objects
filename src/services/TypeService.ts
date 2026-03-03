import { App, TFile, Notice } from "obsidian";
import {
    WorkflowObjectsSettings,
    TypeFieldInfo,
    TypeDefinitionFrontmatter,
    FieldDefinition,
} from "../types";
import { getDefaultValueForType } from "../utils/helpers";

/** Default Metadata Menu fileClass alias used when nothing else is available */
const MM_DEFAULT_TYPE_ALIAS = "fileClass";

/**
 * Service for interacting with Metadata Menu type definitions
 */
export class TypeService {
    constructor(
        private app: App,
        private settings: WorkflowObjectsSettings
    ) {}

    /** Access the live Metadata Menu plugin instance (null if not installed) */
    private getMmPlugin(): Record<string, unknown> | null {
        const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
        return (plugins?.["metadata-menu"] as Record<string, unknown>) ?? null;
    }

    /**
     * Resolve the effective frontmatter field name used to identify a note's type.
     * Priority: user setting (non-empty) → MM fileClassAlias → "fileClass"
     */
    getTypeFieldName(): string {
        if (this.settings.fields.type) {
            return this.settings.fields.type;
        }
        const mm = this.getMmPlugin();
        const mmSettings = mm?.["settings"] as Record<string, unknown> | undefined;
        const mmAlias = mmSettings?.["fileClassAlias"];
        return (typeof mmAlias === "string" && mmAlias) ? mmAlias : MM_DEFAULT_TYPE_ALIAS;
    }

    /**
     * Return MM's global preset fields as FieldDefinition[].
     * Returns [] when MM is not installed or has no preset fields.
     */
    getPresetFields(): FieldDefinition[] {
        const mm = this.getMmPlugin();
        const mmSettings = mm?.["settings"] as Record<string, unknown> | undefined;
        const presets: unknown = mmSettings?.["presetFields"];
        if (!Array.isArray(presets)) return [];
        return presets
            .filter((p): p is Record<string, unknown> =>
                typeof p === "object" && p !== null && typeof (p as Record<string, unknown>).name === "string"
            )
            .map((p) => ({
                id: typeof p.id === "string" ? p.id : undefined,
                name: p.name as string,
                type: typeof p.type === "string" ? p.type : "Input",
                options: typeof p.options === "object" && p.options !== null
                    ? (p.options as Record<string, unknown>)
                    : {},
            }));
    }

    /**
     * Resolve the types path, checking Metadata Menu plugin settings first
     */
    getTypesPath(): string {
        if (this.settings.typesPath) {
            return this.settings.typesPath;
        }
        const mm = this.getMmPlugin();
        const mmSettings = mm?.["settings"] as Record<string, unknown> | undefined;
        if (mmSettings?.["classFilesPath"]) {
            return (mmSettings["classFilesPath"] as string).replace(/\/$/, "");
        }
        return this.settings.typesPathFallback;
    }

    /**
     * Get list of type names from the types definition folder
     */
    getTypeNames(): string[] | null {
        const typesPath = this.getTypesPath();
        const folder = this.app.vault.getAbstractFileByPath(typesPath);

        if (!folder) {
            new Notice(`Types folder not found: ${typesPath}`);
            return null;
        }

        const children = this.app.vault.getMarkdownFiles().filter((f) =>
            f.path.startsWith(typesPath + "/") &&
            !f.path.slice(typesPath.length + 1).includes("/")
        );

        const files = children.map((f) => f.basename);
        files.sort((a, b) => a.localeCompare(b));

        if (!files.length) {
            new Notice(`No workflow types found in ${typesPath}`);
            return null;
        }

        return files;
    }

    /**
     * Get the type definition file
     */
    getTypeFile(typeName: string): TFile | null {
        const typesPath = this.getTypesPath();
        const filePath = `${typesPath}/${typeName}.md`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return file instanceof TFile ? file : null;
    }

    /**
     * Get the frontmatter from a type definition file
     */
    getTypeFrontmatter(typeName: string): TypeDefinitionFrontmatter | null {
        const file = this.getTypeFile(typeName);
        if (!file) return null;

        const cache = this.app.metadataCache.getFileCache(file);
        return (cache?.frontmatter as TypeDefinitionFrontmatter) || null;
    }

    /**
     * Get field definitions array from a type
     */
    getTypeFieldDefinitions(typeName: string): FieldDefinition[] | null {
        const fm = this.getTypeFrontmatter(typeName);
        return fm?.fields || null;
    }

    /**
     * Get the set of field names, defaults, and order for a type.
     * Type-specific fields take precedence; MM preset fields are merged in for
     * any name not already defined by the type.
     */
    getTypeFieldInfo(typeName: string): TypeFieldInfo | null {
        const fields = this.getTypeFieldDefinitions(typeName);
        if (!fields || !Array.isArray(fields)) return null;

        const definedFields = new Set<string>();
        const fieldDefaults = new Map<string, unknown>();
        const fieldOrder: string[] = [];

        // 1. Type-specific fields
        for (const field of fields) {
            if (field.name) {
                definedFields.add(field.name);
                fieldDefaults.set(
                    field.name,
                    getDefaultValueForType(field.type, field.options || {}, this.settings.dateFormat)
                );
                fieldOrder.push(field.name);
            }
        }

        // 2. MM preset fields not already covered by the type
        for (const preset of this.getPresetFields()) {
            if (preset.name && !definedFields.has(preset.name)) {
                definedFields.add(preset.name);
                fieldDefaults.set(
                    preset.name,
                    getDefaultValueForType(preset.type, preset.options || {}, this.settings.dateFormat)
                );
                fieldOrder.push(preset.name);
            }
        }

        return { definedFields, fieldDefaults, fieldOrder };
    }

    /**
     * Get the sort order for frontmatter fields based on type definition.
     * Prefers fieldsOrder if available, falls back to fields array order.
     * MM preset fields are appended for any name not already in the order.
     */
    getFieldSortOrder(typeName: string): string[] | null {
        const fm = this.getTypeFrontmatter(typeName);
        if (!fm?.fields) return null;

        let orderedNames: string[] = [];

        // If fieldsOrder exists, use it to map IDs to names
        if (fm.fieldsOrder && Array.isArray(fm.fieldsOrder)) {
            const idToName = new Map<string, string>();
            for (const field of fm.fields) {
                if (field.id && field.name) idToName.set(field.id, field.name);
            }
            for (const id of fm.fieldsOrder) {
                const name = idToName.get(id);
                if (name) orderedNames.push(name);
            }
        }

        // Fallback: use the order from the fields array itself
        if (!orderedNames.length) {
            orderedNames = fm.fields
                .map((f) => f.name)
                .filter((name): name is string => !!name);
        }

        // Append MM preset fields not already present
        const inOrder = new Set(orderedNames);
        for (const preset of this.getPresetFields()) {
            if (preset.name && !inOrder.has(preset.name)) {
                orderedNames.push(preset.name);
            }
        }

        return orderedNames.length > 0 ? orderedNames : null;
    }


    /**
     * Build a TypeFieldInfo from MM preset fields only.
     * Returns null if there are no preset fields.
     */
    getPresetFieldInfo(): TypeFieldInfo | null {
        const presets = this.getPresetFields();
        if (!presets.length) return null;

        const definedFields = new Set<string>();
        const fieldDefaults = new Map<string, unknown>();
        const fieldOrder: string[] = [];

        for (const preset of presets) {
            if (preset.name) {
                definedFields.add(preset.name);
                fieldDefaults.set(
                    preset.name,
                    getDefaultValueForType(preset.type, preset.options || {}, this.settings.dateFormat)
                );
                fieldOrder.push(preset.name);
            }
        }

        return { definedFields, fieldDefaults, fieldOrder };
    }

    /**
     * Resolve the effective TypeFieldInfo for a note, and whether the schema is
     * considered complete (i.e. safe to remove fields not in the schema).
     *
     * - typeValue present + fileclass found  → full info (type fields + presets), complete
     * - typeValue present + fileclass missing → preset-only info, NOT complete
     *   (we know the type exists but can't see its fields — don't remove unknowns)
     * - no typeValue                          → preset-only info, complete
     *   (presets are the entire known schema for untyped notes)
     */
    resolveTypeInfo(typeValue: string | undefined): {
        typeInfo: TypeFieldInfo | null;
        schemaComplete: boolean;
    } {
        if (typeValue) {
            const typeInfo = this.getTypeFieldInfo(typeValue);
            if (typeInfo) {
                return { typeInfo, schemaComplete: true };
            }
            // Fileclass not found — fall back to presets, mark incomplete
            return { typeInfo: this.getPresetFieldInfo(), schemaComplete: false };
        }
        // No type value — presets are the full known schema
        return { typeInfo: this.getPresetFieldInfo(), schemaComplete: true };
    }

    /**
     * Check if a type exists
     */
    typeExists(typeName: string): boolean {
        return this.getTypeFile(typeName) !== null;
    }
}
