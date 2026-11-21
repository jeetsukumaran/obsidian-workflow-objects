import { App, TFile, Notice } from "obsidian";
import { TypedNoteWorkflowsSettings, NoteTypeFieldInfo, NoteTypeDefinitionFrontmatter, FieldDefinition, SchemaResolution } from "../types";
import { getDefaultValueForFieldType } from "../utils/helpers";
import { resolveDefinition, stringList } from "../schema/definitions";

type Source = Exclude<TypedNoteWorkflowsSettings["schemaSource"], "auto">;
export interface SchemaPlugin {
    settings?: Record<string, unknown>;
    api?: { version?: string; getSchema?: (name: string) => Promise<{ fields: FieldDefinition[] } | null> };
    saveSettings?: () => Promise<void>;
    /** Metadata Menu's saveSettings serializes this live list into fileClassQueries. */
    initialFileClassQueries?: Record<string, unknown>[];
}
interface Bookmark { type: string; title?: string; path?: string; items?: Bookmark[] }

/** Owns provider selection and complete root schemas for every metadata operation. */
export class NoteTypeService {
    constructor(private app: App, private settings: TypedNoteWorkflowsSettings) {}

    private plugin(source: Source): SchemaPlugin | undefined {
        const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, SchemaPlugin> } }).plugins?.plugins;
        return plugins?.[source];
    }

    getSource(): Source {
        if (this.settings.schemaSource !== "auto") return this.settings.schemaSource;
        return this.plugin("fileclass") ? "fileclass" : this.plugin("metadata-menu") ? "metadata-menu" : "standalone";
    }

    private providerSettings(): Record<string, unknown> {
        return this.plugin(this.getSource())?.settings ?? {};
    }

    /** Only edit provider configuration when it describes the same schema folder. */
    getSchemaProviderForEdits(): SchemaPlugin | undefined {
        const source = this.getSource();
        if (source === "standalone") return undefined;
        const provider = this.plugin(source);
        if (!provider) throw new Error(`Schema integration is not enabled: ${source}`);
        const folder = provider.settings?.classFilesPath;
        return typeof folder === "string" && folder.replace(/^\/+|\/+$/g, "") === this.getNoteTypesPath()
            ? provider : undefined;
    }

    /** FileClass has separate write formats; a blank default means native ISO. */
    getDateFormat(field: FieldDefinition): string | undefined {
        const own = !Array.isArray(field.options) ? field.options?.dateFormat : undefined;
        if (typeof own === "string" && own.trim()) return own;
        const key = { date: "defaultDateFormat", datetime: "defaultDateTimeFormat", time: "defaultTimeFormat" }[field.type.toLowerCase()];
        const fallback = key ? this.providerSettings()[key] : undefined;
        return typeof fallback === "string" && fallback.trim() ? fallback : undefined;
    }

    /** Captured by edit plans so schema or binding changes cannot authorize stale removal. */
    schemaSignature(file: TFile): string {
        return JSON.stringify([
            this.getSource(), this.getNoteTypeFieldName(), this.getNoteTypesPath(), this.settings.dateFormat,
            this.providerSettings().globalFileClass, this.providerSettings().fileClassQueries,
            this.noteTypeFiles().map(definition => [definition.path, this.getNoteTypeFrontmatter(this.nameOf(definition))]),
            this.app.metadataCache.getFileCache(file)?.tags, this.bookmarkGroups(file.path),
        ]);
    }

    getNoteTypeFieldName(): string {
        const alias = this.providerSettings().fileClassAlias;
        return this.settings.fields.type || (typeof alias === "string" && alias ? alias : "fileClass");
    }

    getNoteTypesPath(): string {
        const configured = this.providerSettings().classFilesPath;
        const path = this.settings.typesPath || (typeof configured === "string" ? configured : "") || this.settings.typesPathFallback;
        return path.replace(/^\/+|\/+$/g, "");
    }

    private noteTypeFiles(): TFile[] {
        const prefix = this.getNoteTypesPath() + "/";
        return this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(prefix));
    }

    getAvailableNoteTypeNames(): string[] | null {
        const names = this.noteTypeFiles().map(file => this.nameOf(file)).sort((a, b) => a.localeCompare(b));
        if (!names.length) { new Notice(`No note types found in ${this.getNoteTypesPath()}`); return null; }
        return names;
    }

    private nameOf(file: TFile): string {
        return file.path.slice(this.getNoteTypesPath().length + 1, -3);
    }

    getNoteTypeFile(noteTypeName: string): TFile | null {
        if (!noteTypeName || noteTypeName.split(/[\\/]/).some(part => part === ".." || part === "." || !part)) return null;
        const file = this.app.vault.getAbstractFileByPath(`${this.getNoteTypesPath()}/${noteTypeName}.md`);
        return file instanceof TFile ? file : null;
    }

    getNoteTypeFrontmatter(noteTypeName: string): NoteTypeDefinitionFrontmatter | null {
        const file = this.getNoteTypeFile(noteTypeName);
        const cache = file ? this.app.metadataCache.getFileCache(file) : null;
        return cache ? cache.frontmatter ?? {} : null;
    }

    /** Own declarations for schema editing; note operations use resolved schemas. */
    getNoteTypeFieldDefinitions(noteTypeName: string): FieldDefinition[] | null {
        const fields = this.getNoteTypeFrontmatter(noteTypeName)?.fields;
        return Array.isArray(fields) ? fields : null;
    }

    async getNoteTypeFieldInfo(noteTypeName: string): Promise<NoteTypeFieldInfo | null> {
        const result = await this.resolveNoteTypeInfo(noteTypeName);
        if (!result.schemaComplete) throw new Error(result.issues.join("; "));
        return result.noteTypeInfo;
    }

    async getFieldSortOrder(noteTypeName: string): Promise<string[] | null> {
        return (await this.getNoteTypeFieldInfo(noteTypeName))?.fieldOrder ?? null;
    }

    async resolveNoteTypeInfo(noteTypeValue: unknown): Promise<SchemaResolution> {
        return this.resolveNames(stringList(noteTypeValue), false);
    }

    /** Evaluate explicit and contextual classes against the proposed metadata and path. */
    async resolveNoteSchema(file: TFile, fm: Record<string, unknown>, path = file.path): Promise<SchemaResolution> {
        const binding = this.noteBinding(file, fm, path);
        const result = await this.resolveNames(binding.names, this.isNoteTypeDefinitionFile(file));
        if (binding.tagBound && Object.prototype.hasOwnProperty.call(fm, "tags")) result.protectedFields.add("tags");
        result.issues.push(...binding.issues);
        result.schemaComplete = result.issues.length === 0;
        return result;
    }

    getNoteTypeNames(file: TFile, fm: Record<string, unknown>): string[] {
        return this.withGlobal(this.noteBinding(file, fm, file.path).names, this.isNoteTypeDefinitionFile(file));
    }

    getPrimaryNoteType(file: TFile, fm: Record<string, unknown>): string | undefined {
        const explicit = stringList(fm[this.getNoteTypeFieldName()]);
        const names = this.getNoteTypeNames(file, fm);
        const global = this.providerSettings().globalFileClass;
        return explicit[0] ?? names.find(name => name !== global) ?? names[0];
    }

    getTypedNotesOfType(noteTypeName: string): TFile[] {
        return this.app.vault.getMarkdownFiles().filter(file => !this.isNoteTypeDefinitionFile(file) &&
            this.getNoteTypeNames(file, this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}).includes(noteTypeName));
    }

    private noteBinding(file: TFile, fm: Record<string, unknown>, path: string): { names: string[]; tagBound: boolean; issues: string[] } {
        const source = this.getSource();
        const names = stringList(fm[this.getNoteTypeFieldName()]);
        const tags = [...stringList(fm.tags), ...(this.app.metadataCache.getFileCache(file)?.tags ?? []).map(tag => tag.tag)]
            .map(tag => tag.replace(/^#/, ""));
        const folder = path.slice(0, Math.max(0, path.lastIndexOf("/"))) || "/";
        const bookmarks = this.bookmarkGroups(file.path);
        const tagMap = new Map<string, string>();
        const paths = new Map<string, string>();
        const groups = new Map<string, string>();
        const issues: string[] = [];
        const noteTypeValue = fm[this.getNoteTypeFieldName()];
        if (noteTypeValue != null && typeof noteTypeValue !== "string" &&
            !(Array.isArray(noteTypeValue) && noteTypeValue.every(value => typeof value === "string"))) {
            issues.push("The note type field must contain a class name or a list of class names");
        }
        // A missing declaration may have bound this note. Never infer a complete schema from it.
        for (const definition of this.noteTypeFiles()) {
            const name = this.nameOf(definition);
            const schema = this.getNoteTypeFrontmatter(name);
            if (!schema) { issues.push(`Schema not yet available: ${name}`); continue; }
            const mapped = typeof schema.mapWithTag === "string" ? schema.mapWithTag.toLowerCase() === "true" : !!schema.mapWithTag;
            for (const tag of [...(mapped ? [name] : []), ...stringList(schema.tagNames)]) {
                if (!tag.includes(" ")) tagMap.set(source === "metadata-menu" ? tag : tag.toLowerCase(), name);
            }
            for (const prefix of stringList(schema.filesPaths)) paths.set(prefix, name);
            for (const group of stringList(schema.bookmarksGroups)) groups.set(group, name);
        }
        let tagBound = false;
        for (const rawTag of tags) {
            const parts = (source === "metadata-menu" ? rawTag : rawTag.toLowerCase()).split("/");
            do {
                const name = tagMap.get(parts.join("/"));
                if (name) { names.push(name); tagBound = true; }
                parts.pop();
            } while (parts.length && source !== "metadata-menu");
        }
        for (const [prefix, name] of paths) {
            // Both integrations use literal prefix matching, including overlapping folder names.
            if (folder === prefix || folder.startsWith(prefix)) names.push(name);
        }
        for (const group of bookmarks) {
            const name = groups.get(group);
            if (name) names.push(name);
        }
        if (source === "metadata-menu" && Array.isArray(this.providerSettings().fileClassQueries) &&
            (this.providerSettings().fileClassQueries as unknown[]).length) {
            issues.push("Metadata Menu query bindings cannot be evaluated for a proposed note; metadata removal is disabled");
        }
        return { names, tagBound, issues };
    }

    private withGlobal(input: string[], isDefinition: boolean): string[] {
        const names = [...new Set(input)];
        const global = this.providerSettings().globalFileClass;
        if (!isDefinition && typeof global === "string" && global && !names.includes(global) &&
            (this.getSource() !== "metadata-menu" || !names.length)) names.unshift(global);
        return names;
    }

    private async resolveNames(input: string[], isDefinition: boolean): Promise<SchemaResolution> {
        const source = this.getSource();
        const names = this.withGlobal(input, isDefinition);
        const issues: string[] = [];
        if (source !== "standalone" && !this.plugin(source)) issues.push(`Schema integration is not enabled: ${source}`);
        const fields = new Map<string, FieldDefinition>();
        for (const name of names) {
            const resolved = resolveDefinition(name, value => this.getNoteTypeFrontmatter(value), source === "metadata-menu");
            issues.push(...resolved.issues);
            let own = [...resolved.fields, ...resolved.nestedFields];
            const plugin = this.plugin(source);
            const folder = plugin?.settings?.classFilesPath;
            // The public API supplies resolved order and inheritance. Explicit folder overrides
            // can point elsewhere, in which case the standalone file reader is authoritative.
            if (source === "fileclass" && plugin?.api?.getSchema && typeof folder === "string" &&
                folder.replace(/^\/+|\/+$/g, "") === this.getNoteTypesPath() && !resolved.issues.length) {
                try {
                    const schema = await plugin.api.getSchema(name);
                    if (!schema || !Array.isArray(schema.fields)) throw new Error("Schema index is not ready");
                    own = schema.fields;
                    const roots = own.filter(field => !field.path);
                    const expected = new Set(resolved.fields.map(field => field.name));
                    if (roots.length !== expected.size || roots.some(field => !expected.has(field.name))) {
                        throw new Error("Schema index is out of date");
                    }
                } catch (error) {
                    issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            for (const field of own) {
                const key = JSON.stringify([field.path ?? "", field.name]);
                if (source === "metadata-menu" && fields.has(key)) continue;
                if (source !== "metadata-menu") fields.delete(key);
                fields.set(key, field);
            }
        }
        const global = this.providerSettings().globalFileClass;
        const rootFields = [...fields.values()].filter(field => !field.path);
        if (source === "metadata-menu" && !isDefinition && !rootFields.length && typeof global === "string" && global && !names.includes(global)) {
            return this.resolveNames([...names, global], true);
        }
        const nestedFields = [...fields.values()].filter(field => !!field.path);
        const defaults = new Map(rootFields.map(field => [field.name, this.defaultValue(field)]));
        return {
            noteTypeNames: names,
            noteTypeInfo: names.length ? { definedFields: new Set(defaults.keys()), fieldDefaults: defaults, fieldOrder: [...defaults.keys()], fields: rootFields, nestedFields } : null,
            schemaComplete: issues.length === 0,
            issues,
            protectedFields: new Set([this.getNoteTypeFieldName()]),
        };
    }

    private defaultValue(field: FieldDefinition): unknown {
        const type = field.type ? field.type[0].toUpperCase() + field.type.slice(1) : "Input";
        if (this.getSource() !== "fileclass") return getDefaultValueForFieldType(type, !Array.isArray(field.options) ? field.options ?? {} : {}, this.settings.dateFormat);
        if (["Object", "JSON", "YAML"].includes(type)) return {};
        if (["Multi", "MultiInput", "CycleDuration", "MultiFile", "MultiMedia", "ObjectList"].includes(type)) return [];
        return "";
    }

    private bookmarkGroups(path: string): string[] {
        const internal = this.app as unknown as { internalPlugins?: { plugins?: { bookmarks?: {
            instance?: { getBookmarks?: () => Bookmark[]; items?: Bookmark[] };
        } } } };
        const instance = internal.internalPlugins?.plugins?.bookmarks?.instance;
        const groups = new Set<string>();
        const walk = (items: Bookmark[], parents: string[]) => {
            for (const item of items) {
                if (item.type === "group") {
                    const title = this.getSource() === "metadata-menu" ? item.title ?? "" : (item.title ?? "").trim();
                    if (title) walk(item.items ?? [], [...parents, title]);
                }
                else if (item.path === path) {
                    if (this.getSource() === "metadata-menu") groups.add(parents.join("/") || "/");
                    else parents.forEach((_, index) => groups.add(parents.slice(0, index + 1).join("/")));
                }
            }
        };
        walk(instance?.getBookmarks?.() ?? instance?.items ?? [], []);
        return [...groups];
    }

    noteTypeExists(noteTypeName: string): boolean { return this.getNoteTypeFile(noteTypeName) !== null; }

    isNoteTypeDefinitionFile(file: TFile): boolean {
        return file.extension === "md" && file.path.startsWith(this.getNoteTypesPath() + "/");
    }
}
