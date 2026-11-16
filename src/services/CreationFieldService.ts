import { App, moment, parseYaml, TFile } from "obsidian";
import { getBaseRows, isBasesAvailable } from "obsidian-bases-adapter";
import { FieldDefinition } from "../types";

export interface FileCandidate {
    file: TFile;
    display: string;
    group?: string | null;
}

export interface CreationField {
    definition: FieldDefinition;
    kind: string;
    text: string;
    checked: boolean;
    links: FileCandidate[];
    children: CreationField[];
    items: CreationField[][];
    choices: string[];
    selectedChoices: string[];
    hint: string;
}

export const DATE_INPUTS: Record<string, string> = { date: "date", datetime: "datetime-local", time: "time" };
const DATE_FORMATS: Record<string, string> = { date: "YYYY-MM-DD", datetime: "YYYY-MM-DD[T]HH:mm", time: "HH:mm" };
const LINK_TYPES = new Set(["file", "multifile", "media", "multimedia"]);
const LIST_TYPES = new Set(["multi", "multiinput", "list", "cycleduration"]);
const MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif", "mp3", "wav", "ogg", "m4a", "flac", "mp4", "webm", "mov", "mkv", "pdf"]);

export function fieldOptions(field: FieldDefinition): Record<string, unknown> {
    return !Array.isArray(field.options) ? field.options ?? {} : {};
}

function textOption(field: FieldDefinition, key: string): string | undefined {
    const value = fieldOptions(field)[key];
    return typeof value === "string" && value.trim() ? value : undefined;
}

export function isLinkField(field: CreationField): boolean { return LINK_TYPES.has(field.kind); }
export function isListField(field: CreationField): boolean { return LIST_TYPES.has(field.kind); }

/** Typed draft values and FileClass's choices/link conventions, without writing a note. */
export class CreationFieldService {
    constructor(
        private app: App,
        private definitions: FieldDefinition[],
        private dateFormat: (field: FieldDefinition) => string | undefined,
        private now: Date
    ) {}

    async makeFields(definitions: FieldDefinition[]): Promise<CreationField[]> {
        return Promise.all(definitions.map(async definition => {
            const kind = definition.type.toLowerCase();
            const field: CreationField = {
                definition, kind, text: "", checked: false, links: [], children: [], items: [], choices: [], selectedChoices: [], hint: "",
            };
            if (DATE_FORMATS[kind]) field.text = moment(this.now).format(DATE_FORMATS[kind]);
            if (kind === "object") field.children = await this.makeChildren(field);
            if (["json", "yaml", "object"].includes(kind) && !field.children.length) field.text = "{}";
            if (kind === "objectlist" && !this.childDefinitions(field).length) field.text = "[]";
            if (["select", "cycle", "multi"].includes(kind)) {
                try { field.choices = await this.choices(definition); }
                catch (error) { field.hint = `Choices unavailable: ${error instanceof Error ? error.message : String(error)}. Enter values below.`; }
                if (textOption(definition, "sourceType") === "ValuesFromBase") {
                    field.hint += " Base filters using 'this' cannot see this unsaved object.";
                }
            }
            return field;
        }));
    }

    childDefinitions(field: CreationField): FieldDefinition[] {
        const { id, path } = field.definition;
        if (!id) return [];
        const childPath = path ? `${path}____${id}` : id;
        return this.definitions.filter(child => child.path === childPath);
    }

    makeChildren(field: CreationField): Promise<CreationField[]> {
        return this.makeFields(this.childDefinitions(field));
    }

    private async choices(field: FieldDefinition): Promise<string[]> {
        const options = fieldOptions(field);
        const source = options.sourceType;
        if (source === "ValuesFromDVQuery") throw new Error("Dataview choices require a saved note");
        if (source === "ValuesListNotePath") {
            const path = textOption(field, "valuesListNotePath");
            if (!path) return [];
            const file = this.app.vault.getAbstractFileByPath(path) ?? this.app.metadataCache.getFirstLinkpathDest(path, "");
            if (!(file instanceof TFile)) throw new Error(`List note not found: ${path}`);
            return (await this.app.vault.read(file)).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        }
        if (source === "ValuesFromBase") {
            const base = textOption(field, "baseFile"), column = textOption(field, "valuesColumn");
            if (!base || !column) return [];
            if (!isBasesAvailable(this.app)) throw new Error("Bases is unavailable");
            const result = await getBaseRows(this.app, base, textOption(field, "viewName"));
            const rows = result.groups ? result.groups.flatMap(group => group.rows) : result.rows;
            return [...new Set(rows.map(row => row.values[column]).filter((value): value is string => !!value))];
        }
        const values = Array.isArray(field.options) ? field.options : options.valuesList ?? options;
        if (!values || typeof values !== "object") return [];
        return Object.values(values as Record<string, unknown>)
            .filter((value): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value))
            .map(value => String(value));
    }

    async candidates(field: CreationField, allFiles = false): Promise<{ items: FileCandidate[]; message: string }> {
        const definition = field.definition;
        const base = textOption(definition, "baseFile");
        let message = "";
        if (base && !allFiles) {
            if (isBasesAvailable(this.app)) {
                try {
                    // There is deliberately no context file: opening a form must not create a note.
                    const result = await getBaseRows(this.app, base, textOption(definition, "viewName"));
                    const column = textOption(definition, "displayColumn");
                    const candidate = (row: (typeof result.rows)[number], group?: string | null): FileCandidate => ({
                        file: row.file, display: (column ? row.values[column] : null) ?? row.file.basename, group,
                    });
                    return {
                        items: result.groups ? result.groups.flatMap(group => group.rows.map(row => candidate(row, group.key))) : result.rows.map(row => candidate(row)),
                        message: `Source: ${base}. Filters using 'this' cannot see this unsaved object. Use “Show all files” if needed.`,
                    };
                } catch (error) {
                    message = `Could not read ${base}: ${error instanceof Error ? error.message : String(error)}. Showing all files.`;
                }
            } else message = "Bases is unavailable. Showing all files.";
        }
        const media = field.kind.includes("media");
        return {
            items: this.app.vault.getFiles()
                .filter(file => media ? MEDIA_EXTENSIONS.has(file.extension.toLowerCase()) : file.extension === "md")
                .map(file => ({ file, display: file.basename })),
            message,
        };
    }

    values(fields: CreationField[], sourcePath: string, validate = true): Record<string, unknown> {
        return Object.fromEntries(fields.map(field => [field.definition.name, this.value(field, sourcePath, validate)]));
    }

    private value(field: CreationField, sourcePath: string, validate: boolean): unknown {
        const { kind, text, definition } = field;
        const options = fieldOptions(definition);
        if (isLinkField(field)) {
            const links = field.links.map(({ file, display }) => {
                if (validate && this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(`Linked file no longer exists: ${file.path}`);
                return this.app.fileManager.generateMarkdownLink(file, sourcePath, undefined, display === file.basename ? undefined : display);
            });
            return kind.startsWith("multi") ? links : links[0] ?? "";
        }
        if (kind === "boolean" || kind === "checkbox") return field.checked;
        if (kind === "number") {
            if (!text.trim()) return null;
            const value = Number(text);
            if (!Number.isFinite(value)) throw new Error(`${definition.name}: enter a number`);
            for (const bound of ["min", "max"] as const) {
                const limit = options[bound];
                if (validate && limit !== undefined && limit !== "" && Number.isFinite(Number(limit)) &&
                    (bound === "min" ? value < Number(limit) : value > Number(limit))) {
                    throw new Error(`${definition.name}: ${bound === "min" ? "minimum" : "maximum"} is ${Number(limit)}`);
                }
            }
            return value;
        }
        if (DATE_FORMATS[kind]) {
            if (!text) return "";
            const date = moment(text, DATE_FORMATS[kind], true);
            if (!date.isValid()) throw new Error(`${definition.name}: enter a valid date or time`);
            const formatted = date.format(this.dateFormat(definition) || DATE_FORMATS[kind]);
            if (options.defaultInsertAsLink !== true && options.defaultInsertAsLink !== "true") return formatted;
            let folder = (textOption(definition, "dateLinkPath") ?? "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token: string) => date.format(token)).trim().replace(/^\//, "");
            if (folder && !folder.endsWith("/")) folder += "/";
            const alias = folder && (options.dateLinkAlias === true || options.dateLinkAlias === "true") ? `|${formatted}` : "";
            return `[[${folder}${formatted}${alias}]]`;
        }
        if (kind === "object" && field.children.length) return this.values(field.children, sourcePath, validate);
        if (kind === "objectlist" && this.childDefinitions(field).length) return field.items.map(item => this.values(item, sourcePath, validate));
        if (["json", "yaml", "object", "objectlist"].includes(kind)) {
            let value: unknown;
            try { value = text.trim() ? (kind === "yaml" ? parseYaml(text) : JSON.parse(text) as unknown) : kind === "objectlist" ? [] : {}; }
            catch { throw new Error(`${definition.name}: enter valid ${kind === "yaml" ? "YAML" : "JSON"}`); }
            if (kind === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`${definition.name}: enter an object`);
            if (kind === "objectlist" && (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || Array.isArray(item)))) throw new Error(`${definition.name}: enter a list of objects`);
            return value;
        }
        if (kind === "multi" && field.choices.length) return field.choices.filter(value => field.selectedChoices.includes(value));
        if (isListField(field)) return text.split(/[,\r\n]+/).map(value => value.trim()).filter(Boolean);
        return text;
    }
}
