import assert from "node:assert/strict";
import console from "node:console";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const bundleSource = (await build({
    stdin: {
        contents: 'export { default } from "./src/main"; export { BulkAssignTypeModal } from "./src/modals/BulkAssignTypeModal"; export { BulkAssignPreviewModal } from "./src/modals/BulkAssignPreviewModal"; export { StringSuggesterModal } from "./src/modals/SuggesterModal"; export { ConfirmModal } from "./src/modals/ConfirmModal"; export { InputModal } from "./src/modals/InputModal";',
        resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
})).outputFiles[0].text;
const clone = value => globalThis.structuredClone(value);

// JSON mappings are valid YAML. The host mock accepts this subset; Obsidian
// remains responsible for YAML parsing/serialization in the installed plugin.
const parseYaml = text => text.trim() ? JSON.parse(text) : null;

export const targetSchema = {
    fields: [
        { id: "a", name: "alpha", type: "Input" },
        { id: "t", name: "title", type: "Input" },
        { id: "z", name: "zeta", type: "Checkbox" },
        { id: "s", name: "shared", type: "Number" },
    ],
    fieldsOrder: ["t", "z", "s", "a"],
};
export const original = {
    oldValue: "keep unless removed",
    fileClass: "old",
    blank: "",
    title: "Current title",
    shared: null,
    zero: 0,
    falseValue: false,
    emptyList: [],
    nested: { keep: ["[[Link]]"] },
};

export async function assignmentHost({
    frontmatter = original,
    cachedFrontmatter = frontmatter,
    options = {},
    settings = {},
    schemas = { old: { fields: [] }, project: targetSchema },
    path = "inbox/20240102T0304--old-name.md",
    active = true,
    rawContent,
    collision,
    failure,
    beforeUpdate,
    source = "metadata-menu",
    providerSettings = {},
    providerApi,
    cachedTags = [],
    bookmarks = [],
    afterRename,
} = {}) {
    const notices = [], errors = [], writes = [], renames = [], folders = [], saves = [], modals = [], created = [], opened = [];
    let saved = { typesPath: "types", typeAssignment: { targetType: "project", ...options }, ...settings };
    let current = clone(frontmatter);
    const body = "# Body\n\nKeep this text and [[link]].\n";
    class TFile {
        constructor(filePath) { this.path = filePath; this.stat = { ctime: 1700000000000 }; }
        get name() { return this.path.split("/").at(-1); }
        get extension() { return this.name.split(".").at(-1); }
        get basename() { return this.name.slice(0, -this.extension.length - 1); }
    }
    class TFolder { constructor(folderPath) { this.path = folderPath; this.children = []; } }
    const file = new TFile(path);
    const typeFiles = Object.keys(schemas).map(name => new TFile(`types/${name}.md`));
    const existing = new Map([["types", new TFolder("types")], ["inbox", new TFolder("inbox")]]);
    for (const type of typeFiles) existing.set(type.path, type);
    if (collision) existing.set(collision, new TFile(collision));
    const rootFolder = new TFolder("");
    rootFolder.children.push(file);
    existing.get("inbox").children.push(file);
    const app = {
        workspace: { getActiveFile: () => active ? file : null, on: () => ({}), getLeaf: () => ({ openFile: async target => opened.push(target.path) }) },
        vault: {
            getAbstractFileByPath: name => name === file.path ? file : existing.get(name) ?? null,
            getMarkdownFiles: () => [...typeFiles, file],
            getRoot: () => rootFolder,
            async read(target) {
                assert.equal(target, file);
                if (failure === "read") throw new Error("Read failed");
                return rawContent ?? `---\n${JSON.stringify(current, null, 2)}\n---\n${body}`;
            },
            async create(path, content) { const target = new TFile(path); created.push({ path, content }); existing.set(path, target); return target; },
            async createFolder(name) {
                if (failure === "folder") throw new Error("Folder creation failed");
                folders.push(name);
                existing.set(name, new TFolder(name));
            },
        },
        metadataCache: { getFileCache: target => target !== file && schemas[target.path.slice("types/".length, -3)] === null ? null : ({ frontmatter: target === file ? cachedFrontmatter : schemas[target.path.slice("types/".length, -3)], tags: target === file ? cachedTags.map(tag => ({ tag })) : [] }) },
        fileManager: {
            async processFrontMatter(target, callback) {
                assert.equal(target, file);
                if (failure === "write") throw new Error("Write failed");
                if (beforeUpdate) current = beforeUpdate(current, file);
                const next = clone(current);
                assert.equal(callback(next), undefined);
                current = next;
                writes.push(clone(current));
            },
            async renameFile(target, destination) {
                assert.equal(target, file);
                if (failure === "rename") throw new Error("Rename failed");
                assert.equal(existing.has(destination), false);
                renames.push(destination);
                file.path = destination;
                afterRename?.(file, schemas);
            },
        },
        internalPlugins: { plugins: { bookmarks: { instance: { getBookmarks: () => bookmarks } } } },
        plugins: { plugins: source === "none" ? {} : {
            [source]: { settings: { classFilesPath: "types/", fileClassAlias: "fileClass", presetFields: [{ name: "global", type: "Multi" }], ...providerSettings }, api: providerApi },
        } },
    };

    class Element {
        constructor() { this.rows = []; this.children = []; this.visible = true; }
        empty() { this.rows = []; this.children = []; }
        createEl(tag, props) { const child = { tag, ...props }; this.children.push(child); return child; }
        toggle(value) { this.visible = value; }
    }
    class Control {
        constructor(row) { this.row = row; this.options = new Map(); }
        setValue(value) { this.value = value; return this; }
        addOption(key, label) { this.options.set(key, label); return this; }
        setButtonText(value) { this.text = value; return this; }
        setCta() { return this; }
        onChange(callback) { this.callback = callback; return this; }
        onClick(callback) { this.callback = callback; return this; }
        change(value) { assert.ok(!this.row.disabled); this.value = value; this.callback(value); }
        click() { this.callback(); }
    }
    class Setting {
        constructor(parent) { this.settingEl = new Element(); this.controls = []; parent.rows.push(this); }
        setName(name) { this.name = name; return this; }
        setDesc(description) { this.description = description; return this; }
        setHeading() { this.heading = true; return this; }
        setDisabled(disabled) { this.disabled = disabled; return this; }
        addControl(callback) { const control = new Control(this); this.controls.push(control); callback(control); return this; }
        addDropdown(callback) { return this.addControl(callback); }
        addToggle(callback) { return this.addControl(callback); }
        addButton(callback) { return this.addControl(callback); }
    }
    class Modal {
        constructor() { this.contentEl = new Element(); }
        open() { modals.push(this); this.onOpen(); }
        close() { this.onClose(); }
    }
    class Plugin {
        constructor() { this.app = app; this.commands = new Map(); }
        async loadData() { return clone(saved); }
        async saveData(value) {
            if (failure === "save") throw new Error("Save failed");
            saved = clone(value); saves.push(saved);
        }
        addCommand(command) { this.commands.set(command.id, command); }
        addSettingTab() {}
        registerEvent() {}
    }
    const module = { exports: {} };
    new Function("require", "module", "exports", "console", bundleSource)(
        name => name === "obsidian" ? {
            Plugin, Modal, Setting, TFile, TFolder,
            SuggestModal: class { setPlaceholder() {} setInstructions() {} }, PluginSettingTab: class {},
            Notice: class { constructor(message) { notices.push(message); } },
            parseYaml, normalizePath: value => value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, ""),
            moment: () => ({ format: format => `formatted:${format}` }),
        } : require(name),
        module, module.exports, { ...console, error: (...args) => errors.push(args) },
    );
    let plugin = new module.exports.default();
    await plugin.onload();
    return {
        file, app, notices, errors, writes, renames, folders, saves, modals, body, created, opened, classes: module.exports,
        get plugin() { return plugin; },
        get frontmatter() { return current; },
        get saved() { return saved; },
        async reload() { plugin = new module.exports.default(); await plugin.onload(); },
        open() {
            const command = plugin.commands.get("assign-object-to-different-type");
            assert.equal(command?.name, "Assign object to different type");
            const completion = command.callback();
            const modal = modals.at(-1);
            const row = name => modal.contentEl.rows.find(item => item.name === name);
            const control = name => row(name).controls[0];
            const click = text => modal.contentEl.rows.flatMap(item => item.controls).find(item => item.text === text).click();
            return { completion, modal, row, control, click };
        },
        async assign() { const dialog = this.open(); dialog.click("Assign type"); await dialog.completion; },
    };
}
