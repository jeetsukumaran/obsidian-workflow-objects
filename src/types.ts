import { TFile } from "obsidian";

/**
 * Plugin settings interface
 */
export interface WorkflowObjectsSettings {
    /** Path to type definitions (null = read from Metadata Menu) */
    typesPath: string | null;
    /** Fallback path if Metadata Menu not available */
    typesPathFallback: string;
    /** Frontmatter field names */
    fields: FieldNames;
    /** Wrap around when navigating */
    wrapAround: boolean;
    /** Maximum title length for filenames */
    maxTitleLength: number;
    /** Path mappings: [pattern, template][]
     * Templates support: $1, $2 for regex groups, {{title::first}} for first letter of title */
    pathMappings: [string, string][];
    /** Filename mappings: [pattern, template][]
     * Templates support: {{date::FORMAT}}, {{title}}
     * Examples: "{{date::YYYYMMDDTHHmm}}--{{title}}", "@{{title}}" */
    filenameMappings: [string, string][];
    /** Frontmatter properties to look up for date prefix (tried in order, falls back to file ctime) */
    titlePrefixDateProperties: string[];
    /** Default date format */
    dateFormat: string;
    /** Default field sort mode for frontmatter */
    defaultFieldSort: "schema" | "alphabetical";
    /** Sort direction for object lists (files matching a type) */
    objectSortDirection: "asc" | "desc";
    /** Default directory template for new object catalogs.
     *  Use {{content-type}} as a placeholder for the selected type name. */
    catalogDir: string;
    /** Default filename template for new object catalogs.
     *  Use {{content-type}} as a placeholder for the selected type name. */
    catalogFilename: string;
    /** Whether to register sentence-case displayNames for all schema fields by default */
    catalogRemapDisplayNames: boolean;
    /** Configuration for the auto-appended file.ctime column */
    catalogCtimeField: CatalogTimestampField;
    /** Configuration for the auto-appended file.mtime column */
    catalogMtimeField: CatalogTimestampField;
}

/**
 * Configuration for an auto-appended file timestamp column in a catalog.
 */
export interface CatalogTimestampField {
    /** Whether the column is included in generated catalogs */
    enabled: boolean;
    /** Display name shown as the column header */
    displayName: string;
}

/**
 * Field name configuration
 */
export interface FieldNames {
    type: string;
    title: string;
}

/**
 * Cleanup options for frontmatter cleaning
 */
export interface CleanupOptions {
    /** Keep fields defined in schema even if empty */
    preserveDefinedFields: boolean;
    /** Delete fields not in schema (even if they have values) */
    removeUndefinedFields: boolean;
    /** Add missing fields from schema with defaults */
    addMissingFields: boolean;
    /** Sort fields: "schema" for type definition order, "alphabetical" for A-Z, "none" to skip sorting */
    sortMode: "schema" | "alphabetical" | "none";
}

/**
 * Type field information extracted from Metadata Menu definitions
 */
export interface TypeFieldInfo {
    /** Set of field names defined in the type */
    definedFields: Set<string>;
    /** Map of field names to their default values */
    fieldDefaults: Map<string, unknown>;
    /** Ordered list of field names */
    fieldOrder: string[];
}

/**
 * Metadata Menu field definition structure
 */
export interface FieldDefinition {
    id?: string;
    name: string;
    type: string;
    options?: Record<string, unknown>;
}

/**
 * Type definition frontmatter structure
 */
export interface TypeDefinitionFrontmatter {
    fields?: FieldDefinition[];
    fieldsOrder?: string[];
    [key: string]: unknown;
}

/**
 * Active file with metadata
 */
export interface ActiveFileWithMeta {
    file: TFile;
    frontmatter: Record<string, unknown>;
}

/**
 * Cleanup analysis result
 */
export interface CleanupAnalysis {
    toRemove: Array<{
        key: string;
        value: unknown;
        isEmpty: boolean;
    }>;
    toAdd: string[];
}

/**
 * Cleanup statistics
 */
export interface CleanupStats {
    removed: string[];
    added: string[];
    preserved: string[];
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: WorkflowObjectsSettings = {
    typesPath: null,
    typesPathFallback: "system/schema/content-types",
    fields: {
        type: "",
        title: "title",
    },
    wrapAround: true,
    maxTitleLength: 120,
    pathMappings: [["^(.+)$", "content/$1"]],
    filenameMappings: [["^.*$", "{{date::YYYYMMDDTHHmm}}--{{title}}"]],
    titlePrefixDateProperties: [
        "date-indexed",
        "date-created",
        "created-date",
        "created",
        "date",
    ],
    dateFormat: "YYYY-MM-DDTHH:mm",
    defaultFieldSort: "schema",
    objectSortDirection: "desc",
    catalogDir: "",
    catalogFilename: "{{content-type}}.base",
    catalogRemapDisplayNames: true,
    catalogCtimeField: { enabled: true, displayName: "Date file created" },
    catalogMtimeField: { enabled: true, displayName: "Date file modified" },
};

/**
 * Default cleanup options
 */
export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = {
    preserveDefinedFields: true,
    removeUndefinedFields: false,
    addMissingFields: true,
    sortMode: "schema",
};
