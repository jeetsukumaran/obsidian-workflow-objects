import assert from "node:assert/strict";
import console from "node:console";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const pluginSource = (await build({
    entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    write: false,
})).outputFiles[0].text;

const commands = [
    ["insert-missing-frontmatter-alphabetical", "Insert missing front matter (alphabetical)"],
    ["insert-missing-frontmatter-schema", "Insert missing front matter (schema order)"],
    ["append-missing-frontmatter", "Append missing front matter"],
    ["prepend-missing-frontmatter", "Prepend missing front matter"],
];

const schema = {
    fields: [
        { id: "a", name: "author", type: "Input" },
        { id: "t", name: "title", type: "Input" },
        { id: "r", name: "rating", type: "Number" },
        { id: "s", name: "status", type: "Select" },
        { id: "f", name: "flags", type: "Multi" },
        { id: "b", name: "reviewed", type: "Boolean" },
        { id: "c", name: "created", type: "Date", options: { dateFormat: "YYYY" } },
    ],
    fieldsOrder: ["s", "t", "r", "a", "b", "f", "c"],
};
const presets = [
    { name: "priority", type: "Number" },
    { name: "status", type: "Input" },
    { name: "tags", type: "Multi" },
];
const original = {
    zeta: "untouched",
    status: "published",
    fileClass: "article",
    extra: "",
    title: "Existing title",
};
const additions = {
    rating: null,
    author: "",
    reviewed: false,
    flags: [],
    created: "formatted:YYYY",
    priority: null,
    tags: [],
};

// Run the actual plugin registrations, commands, and services. Only the host
// API is replaced; processFrontMatter supplies a fresh, mutable document record.
async function fixture({
    frontmatter = original,
    cachedFrontmatter = frontmatter,
    schemas = { article: schema },
    presetFields = presets,
    settings = {},
    extension = "md",
    active = true,
    failure,
    metadataMenu = true,
} = {}) {
    const notices = [];
    const errors = [];
    const writes = [];
    let current = globalThis.structuredClone(frontmatter);
    class TFile {
        constructor(path) { this.path = path; this.extension = extension; }
    }
    const file = new TFile(`note.${extension}`);
    const typeFiles = new Map(Object.keys(schemas).map(name => [`types/${name}.md`, new TFile(`types/${name}.md`)]));
    const app = {
        workspace: { getActiveFile: () => active ? file : null, on: () => ({}) },
        vault: { getAbstractFileByPath: path => typeFiles.get(path) ?? null },
        metadataCache: {
            getFileCache: target => ({
                frontmatter: target === file
                    ? cachedFrontmatter
                    : schemas[target.path.slice("types/".length, -3)],
            }),
        },
        fileManager: {
            async processFrontMatter(target, callback) {
                assert.equal(target, file);
                if (failure) throw failure;
                const next = globalThis.structuredClone(current);
                assert.equal(callback(next), undefined, "frontmatter callback must be synchronous");
                current = next;
                writes.push(next);
            },
        },
        plugins: { plugins: metadataMenu ? {
            "metadata-menu": { settings: { classFilesPath: "types", fileClassAlias: "fileClass", presetFields } },
        } : {} },
    };
    class Plugin {
        constructor() { this.app = app; this.commands = new Map(); }
        async loadData() { return { typesPath: "types", ...settings }; }
        async saveData() {}
        addCommand(command) {
            assert.equal(this.commands.has(command.id), false, "command IDs must be unique");
            this.commands.set(command.id, command);
        }
        addSettingTab() {}
        registerEvent() {}
    }
    const obsidian = {
        Plugin,
        TFile,
        Modal: class {},
        SuggestModal: class {},
        PluginSettingTab: class {},
        Notice: class { constructor(message) { notices.push(message); } },
        moment: () => ({ format: value => `formatted:${value}` }),
    };
    const module = { exports: {} };
    new Function("require", "module", "exports", "console", pluginSource)(
        name => name === "obsidian" ? obsidian : require(name),
        module,
        module.exports,
        { ...console, error: (...args) => errors.push(args) },
    );
    const plugin = new module.exports.default();
    await plugin.onload();
    return {
        plugin, app, notices, errors, writes,
        get frontmatter() { return current; },
        async run(id) {
            const command = plugin.commands.get(id);
            assert.ok(command, `Missing command: ${id}`);
            await command.callback();
        },
    };
}

test("registers all four commands with the requested names", async () => {
    const env = await fixture();
    for (const [id, name] of commands) assert.equal(env.plugin.commands.get(id)?.name, name);
});

const expectedOrders = [
    ["author", "created", "extra", "fileClass", "flags", "priority", "rating", "reviewed", "status", "tags", "title", "zeta"],
    ["status", "title", "rating", "author", "reviewed", "flags", "created", "priority", "tags", "extra", "fileClass", "zeta"],
    [...Object.keys(original), ...Object.keys(additions)],
    [...Object.keys(additions), ...Object.keys(original)],
];

for (const [index, [id, name]] of commands.entries()) {
    test(`${name}: adds defaults and produces the requested complete field order`, async () => {
        const env = await fixture({ settings: { defaultFieldSort: index === 0 ? "schema" : "alphabetical" } });
        await env.run(id);
        assert.deepEqual(Object.keys(env.frontmatter), expectedOrders[index]);
        assert.deepEqual(env.frontmatter, { ...original, ...additions });
        assert.equal(env.writes.length, 1, "addition and ordering share one atomic update");
        assert.match(env.notices.at(-1), /Added 7 missing front matter field\(s\)/);

        const firstResult = Object.entries(env.frontmatter);
        await env.run(id);
        assert.deepEqual(Object.entries(env.frontmatter), firstResult, "repeated execution is idempotent");
    });

    test(`${name}: preserves present values, including empty schema and extra fields`, async () => {
        const values = {
            fileClass: "article", status: null, title: "", author: false,
            rating: 0, flags: [], reviewed: false, created: "2001-01-01",
            priority: null, tags: [], extra: null, blank: "", object: {},
            nested: { z: ["[[A link]]", null], a: { value: true } },
        };
        const env = await fixture({ frontmatter: values });
        await env.run(id);
        assert.deepEqual(env.frontmatter, values);
        if (index >= 2) assert.deepEqual(Object.keys(env.frontmatter), Object.keys(values));
    });

    test(`${name}: supports notes without frontmatter using presets`, async () => {
        const env = await fixture({ frontmatter: {}, presetFields: [
            { name: "zebra", type: "Input" }, { name: "alpha", type: "Checkbox" },
        ] });
        await env.run(id);
        assert.deepEqual(env.frontmatter, { zebra: "", alpha: false });
        assert.deepEqual(Object.keys(env.frontmatter), index === 0 ? ["alpha", "zebra"] : ["zebra", "alpha"]);
    });

    test(`${name}: sorts even without additions, while append/prepend keep order`, async () => {
        const values = { z: 1, b: 2, a: 3, fileClass: "minimal" };
        const env = await fixture({ frontmatter: values, presetFields: [], schemas: {
            minimal: { fields: [{ name: "b", type: "Number" }, { name: "a", type: "Number" }] },
        } });
        await env.run(id);
        const expected = index === 0 ? ["a", "b", "fileClass", "z"]
            : index === 1 ? ["b", "a", "fileClass", "z"] : Object.keys(values);
        assert.deepEqual(Object.keys(env.frontmatter), expected);
        assert.deepEqual(env.frontmatter, values);
    });

    test(`${name}: falls back to alphabetical order when no schema is available`, async () => {
        const env = await fixture({ frontmatter: { zebra: 1, alpha: 2 }, metadataMenu: false });
        await env.run(id);
        assert.deepEqual(Object.keys(env.frontmatter), index < 2 ? ["alpha", "zebra"] : ["zebra", "alpha"]);
    });
}

test("resolves the current type inside the update when the note cache is stale", async () => {
    const env = await fixture({ cachedFrontmatter: { fileClass: "old-type" } });
    await env.run(commands[1][0]);
    assert.deepEqual(Object.keys(env.frontmatter), expectedOrders[1]);
});

test("adds only presets when the type definition is unavailable", async () => {
    const env = await fixture({ schemas: {} });
    await env.run(commands[1][0]);
    assert.deepEqual(Object.keys(env.frontmatter), ["priority", "status", "tags", "extra", "fileClass", "title", "zeta"]);
    assert.deepEqual(env.frontmatter, { ...original, priority: null, tags: [] });
});

test("type fields take precedence over presets with the same name", async () => {
    const env = await fixture({ frontmatter: { fileClass: "article" } });
    await env.run(commands[2][0]);
    assert.equal(env.frontmatter.status, null, "Select from the schema overrides the Input preset");
});

test("uses configured type aliases and updated settings", async () => {
    const env = await fixture({ frontmatter: { kind: "article" } });
    env.plugin.settings.fields.type = "kind";
    await env.plugin.saveSettings();
    await env.run(commands[2][0]);
    assert.equal(env.frontmatter.author, "");
    assert.equal(env.frontmatter.kind, "article");
    assert.equal(Object.hasOwn(env.frontmatter, "fileClass"), false);
});

test("reads schemas from the configured folder without Metadata Menu", async () => {
    const env = await fixture({ metadataMenu: false });
    await env.run(commands[2][0]);
    assert.equal(env.frontmatter.author, "");
    assert.equal(Object.hasOwn(env.frontmatter, "priority"), false);
});

test("uses Metadata Menu's configured type alias", async () => {
    const env = await fixture({ frontmatter: { classification: "article" } });
    env.app.plugins.plugins["metadata-menu"].settings.fileClassAlias = "classification";
    await env.run(commands[2][0]);
    assert.equal(env.frontmatter.author, "");
});

test("treats prototype property names as ordinary frontmatter keys", async () => {
    const env = await fixture({ frontmatter: JSON.parse('{"__proto__":{"keep":true}}'), presetFields: [
        { name: "__proto__", type: "Input" },
        { name: "constructor", type: "Input" },
        { name: "toString", type: "Input" },
    ] });
    await env.run(commands[3][0]);
    assert.deepEqual(Object.keys(env.frontmatter), ["constructor", "toString", "__proto__"]);
    assert.deepEqual(env.frontmatter.__proto__, { keep: true });
    assert.equal(env.frontmatter.constructor, "");
    assert.equal(env.frontmatter.toString, "");
    assert.equal(Object.getPrototypeOf(env.frontmatter), Object.prototype);
});

test("rejects missing active files and unsupported file types without writing", async () => {
    for (const [id] of commands) {
        for (const options of [{ active: false }, { extension: "pdf" }]) {
            const env = await fixture(options);
            await env.run(id);
            assert.equal(env.writes.length, 0);
            assert.match(env.notices.at(-1), /No active file|Unsupported file type/);
        }
    }
});

test("accepts Quarto notes like the existing frontmatter commands", async () => {
    const env = await fixture({ extension: "qmd" });
    await env.run(commands[2][0]);
    assert.equal(env.frontmatter.author, "");
});

test("reports failed updates without a success notice or partial changes", async () => {
    const env = await fixture({ failure: new Error("Invalid YAML") });
    await env.run(commands[0][0]);
    assert.deepEqual(env.frontmatter, original);
    assert.equal(env.writes.length, 0);
    assert.equal(env.errors.length, 1);
    assert.deepEqual(env.notices, ["Error inserting missing front matter: Invalid YAML"]);
});
