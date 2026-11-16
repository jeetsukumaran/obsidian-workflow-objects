import { FieldDefinition, TypeDefinitionFrontmatter } from "../types";

/** Strings used by fileClass names, exclusions, tags, and legacy list encodings. */
export function stringList(value: unknown): string[] {
    const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return [...new Set(values.filter((v): v is string | number | boolean =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        .map(v => String(v).trim()).filter(Boolean))];
}

export interface ResolvedDefinition {
    fields: FieldDefinition[];
    nestedFields: FieldDefinition[];
    issues: string[];
}

/** Resolve root fields without promoting nested children into note properties. */
export function resolveDefinition(
    name: string,
    read: (name: string) => TypeDefinitionFrontmatter | null,
    metadataMenu: boolean
): ResolvedDefinition {
    const issues: string[] = [];
    const chain: { name: string; fields: FieldDefinition[]; excluded: Set<string> }[] = [];
    const seen = new Set<string>();
    const excluded = new Set<string>();
    let current = name;
    let order: string[] = [];
    while (current) {
        if (seen.has(current)) { issues.push(`Inheritance cycle at "${current}"`); break; }
        seen.add(current);
        const fm = read(current);
        if (!fm) { issues.push(`No field schema available for type "${current}"`); break; }
        if (!chain.length) {
            order = stringList(fm.fieldsOrder);
            stringList(fm.excludes).forEach(key => excluded.add(key));
        }
        const fields: FieldDefinition[] = [];
        if (fm.fields !== undefined && !Array.isArray(fm.fields)) {
            issues.push(`Invalid fields in type "${current}"`);
        } else {
            for (const field of fm.fields ?? []) {
                if (!field || typeof field.name !== "string" || !field.name ||
                    (field.path !== undefined && typeof field.path !== "string")) {
                    issues.push(`Invalid field in type "${current}"`);
                } else {
                    fields.push({ ...field, type: typeof field.type === "string" ? field.type : "Input" });
                }
            }
        }
        chain.push({ name: current, fields, excluded: new Set(excluded) });
        stringList(fm.excludes).forEach(key => excluded.add(key));
        if (fm.extends != null && typeof fm.extends !== "string") {
            issues.push(`Invalid parent of type "${current}"`);
            break;
        }
        current = typeof fm.extends === "string" ? fm.extends.trim() : "";
    }
    const merged = new Map<string, FieldDefinition>();
    for (const entry of metadataMenu ? chain : [...chain].reverse()) {
        for (const field of entry.fields) {
            const key = JSON.stringify([field.path ?? "", field.name]);
            if (!entry.excluded.has(field.name) && (!metadataMenu || !merged.has(key))) {
                merged.set(key, field);
            }
        }
    }
    const all = [...merged.values()];
    return {
        fields: orderFields(all.filter(field => !field.path), order),
        nestedFields: all.filter(field => !!field.path),
        issues,
    };
}

/** Accept FileClass names and legacy Metadata Menu IDs; retain unnamed neighbours. */
function orderFields(fields: FieldDefinition[], order: string[]): FieldDefinition[] {
    const names = new Set(fields.map(field => field.name));
    const ranks = new Map<string, number>();
    for (const entry of order) {
        const name = names.has(entry) ? entry : fields.find(field => field.id === entry)?.name;
        if (name && !ranks.has(name)) ranks.set(name, ranks.size);
    }
    let rank = -1;
    let tie = 0;
    return fields.map(field => {
        const known = ranks.get(field.name);
        if (known !== undefined) { rank = known; tie = 0; } else { tie++; }
        return { field, rank, tie };
    }).sort((a, b) => a.rank - b.rank || a.tie - b.tie).map(entry => entry.field);
}
