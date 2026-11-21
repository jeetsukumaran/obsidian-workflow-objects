import assert from "node:assert/strict";
import test from "node:test";
import { assignmentHost } from "./helpers/assignment-host.mjs";

const body = "# Keep body\nold is ordinary text, with [[links]] and code.\n";
const content = fm => `---\n${JSON.stringify(fm, null, 2)}\n---\n${body}`;
const metadata = text => JSON.parse(text.slice(4, text.indexOf("\n---", 4)));
const definition = { fields: [{ id: "a", name: "old", type: "Input", options: { value: "old" } }], fieldsOrder: ["a"], icon: "book" };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function host({ source = "none", settings = {}, providerSettings = {}, files = {}, active = "notes/one.md", hooks = {} } = {}) {
    const env = await assignmentHost({ source, settings, providerSettings });
    const TFile = env.file.constructor;
    const TFolder = env.app.vault.getAbstractFileByPath("types").constructor;
    const all = new Map();
    const texts = new Map();
    const add = (path, value) => {
        const file = new TFile(path);
        all.set(path, file);
        texts.set(file, typeof value === "string" ? value : content(value));
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
            const folder = parts.slice(0, i).join("/");
            if (!all.has(folder)) all.set(folder, new TFolder(folder));
        }
        return file;
    };
    for (const [path, fm] of Object.entries({ "types/old.md": definition, "notes/one.md": { fileClass: "old", title: "Keep title" }, ...files })) add(path, fm);
    const original = new Map([...texts].map(([file, text]) => [file.path, text]));
    const fileAt = path => all.get(path);
    const read = path => metadata(texts.get(fileAt(path)));
    const put = (path, fm) => texts.set(fileAt(path), content(fm));
    const writes = [], renames = [], saves = [];
    env.app.workspace.getActiveFile = () => fileAt(active) ?? null;
    env.app.vault.getAbstractFileByPath = path => all.get(path) ?? null;
    env.app.vault.getFiles = () => [...all.values()].filter(item => item instanceof TFile);
    env.app.vault.getMarkdownFiles = () => env.app.vault.getFiles().filter(file => file.extension === "md");
    env.app.vault.read = async file => {
        await hooks.read?.(file);
        if (!texts.has(file)) throw new Error("File missing");
        return texts.get(file);
    };
    env.app.vault.createFolder = async path => {
        await hooks.folder?.(path);
        all.set(path, new TFolder(path));
    };
    env.app.metadataCache.getFileCache = file => ({ frontmatter: read(file.path) });
    env.app.fileManager.processFrontMatter = async (file, callback) => {
        await hooks.beforeWrite?.(file);
        const fm = read(file.path);
        assert.equal(callback(fm), undefined);
        const text = texts.get(file);
        texts.set(file, `---\n${JSON.stringify(fm, null, 2)}${text.slice(text.indexOf("\n---", 4))}`);
        writes.push(file.path);
        await hooks.afterWrite?.(file);
    };
    env.app.fileManager.renameFile = async (file, destination) => {
        await hooks.beforeRename?.(file, destination);
        assert.equal(all.has(destination), false, "never overwrite a destination");
        const oldPath = file.path;
        all.delete(oldPath); file.path = destination; all.set(destination, file);
        renames.push([oldPath, destination]);
        await hooks.afterRename?.(file, destination);
    };
    const provider = env.app.plugins.plugins[source];
    if (provider) {
        if (source === "metadata-menu") provider.initialFileClassQueries = structuredClone(provider.settings.fileClassQueries ?? []);
        provider.saveSettings = async () => {
            if (source === "metadata-menu") provider.settings.fileClassQueries = provider.initialFileClassQueries;
            await hooks.saveProvider?.(provider);
            saves.push(structuredClone(provider.settings));
        };
    }
    return {
        ...env, all, texts, original, add, fileAt, read, put, writes, renames, provider, providerSaves: saves,
        get saved() { return env.saved; },
        async open() {
            const command = env.plugin.commands.get("rename-note-type");
            assert.equal(command.name, "Rename note type");
            const done = command.callback();
            await tick();
            const modal = env.modals.at(-1);
            const controls = () => modal.contentEl.rows.flatMap(row => row.controls);
            const control = name => modal.contentEl.rows.find(row => row.name === name).controls[0];
            const rename = controls().find(control => control.text === "Rename note type");
            return { modal, done, control, rename, async submit(name = "new", old = "old") {
                control("Note type").change(old);
                control("New name").change(name);
                assert.equal(rename.disabled, false);
                await rename.click();
            } };
        },
        assertOriginal() {
            for (const [path, text] of original) {
                assert.ok(fileAt(path), path);
                assert.deepEqual(read(path), metadata(text));
                assert.ok(texts.get(fileAt(path)).endsWith(body));
            }
        },
    };
}

for (const source of ["none", "fileclass", "metadata-menu"]) {
    test(`${source}: registered rename command migrates schema, every declaration, and settings`, async () => {
        const env = await host({ source, providerSettings: { globalFileClass: "old", fileClassQueries: [{ id: "q", fileClassName: "old", query: "dv.pages()" }] },
            settings: { typeAssignment: { targetType: "old" }, pathMappings: [["^old$", "same/folder"], ["^(.+)$", "content/$1"]], filenameMappings: [["^old$", "{{ title }}"]] },
            files: {
                "types/child.md": { extends: "old", fields: [] },
                "types/parent.md": { fields: [], savedViews: [{ name: "old", children: ["old", "other"], filters: "old" }] },
                "types/old.md": { ...definition, mapWithTag: true, tagNames: "existing", baseFile: "Library.base" },
                "archive/multi.md": { fileClass: ["other", "old", "older"], nested: { fileClass: "old" }, author: "old", flag: false, count: 0 },
                "templates/legacy.md": { fileClass: "other, old ,older" },
                "other/unchanged.md": { fileClass: "older", extends: "old", title: "old" },
                "no-type.md": { title: "old" },
            } });
        const dialog = await env.open();
        await dialog.submit(); await dialog.done;
        assert.equal(env.fileAt("types/old.md"), undefined);
        assert.deepEqual(env.renames, [["types/old.md", "types/new.md"]]);
        assert.deepEqual(env.read("notes/one.md"), { fileClass: "new", title: "Keep title" });
        assert.deepEqual(env.read("archive/multi.md"), { fileClass: ["other", "new", "older"], nested: { fileClass: "old" }, author: "old", flag: false, count: 0 });
        assert.equal(env.read("templates/legacy.md").fileClass, "other, new ,older");
        assert.equal(env.read("types/child.md").extends, "new");
        assert.deepEqual(env.read("types/parent.md").savedViews, [{ name: "old", children: ["new", "other"], filters: "old" }]);
        assert.deepEqual(env.read("types/new.md").fields, definition.fields);
        assert.deepEqual(env.read("types/new.md").tagNames, ["existing", "old"]);
        if (source === "fileclass") assert.equal(env.read("types/new.md").baseView, "old");
        assert.ok(!env.writes.includes("other/unchanged.md"));
        assert.ok(!env.writes.includes("no-type.md"));
        for (const text of env.texts.values()) assert.ok(text.endsWith(body));
        assert.equal(env.saved.typeAssignment.targetType, "new");
        assert.deepEqual(env.saved.pathMappings, [["^new$", "same/folder"], ["^(.+)$", "content/$1"]]);
        assert.deepEqual(env.saved.filenameMappings, [["^new$", "{{ title }}"]]);
        if (env.provider) {
            assert.equal(env.provider.settings.globalFileClass, "new");
            assert.equal(env.providerSaves.at(-1).globalFileClass, "new");
            if (source === "metadata-menu") {
                assert.equal(env.provider.initialFileClassQueries[0].fileClassName, "new");
                assert.equal(env.providerSaves.at(-1).fileClassQueries[0].fileClassName, "new");
                assert.equal(env.providerSaves.at(-1).fileClassQueries[0].query, "dv.pages()");
            }
        }
    });
}

test("configured alias and local override both migrate, using fresh content", async () => {
    const env = await host({ source: "fileclass", providerSettings: { fileClassAlias: "kind" }, settings: { fields: { type: "foo" } },
        files: { "notes/one.md": { foo: "old", kind: ["old", "second"], fileClass: "old" } } });
    env.app.metadataCache.getFileCache = () => ({ frontmatter: {} });
    const dialog = await env.open(); await dialog.submit(); await dialog.done;
    assert.deepEqual(env.read("notes/one.md"), { foo: "new", kind: ["new", "second"], fileClass: "old" });
});

test("schema folder override leaves a different backend's names and configuration alone", async () => {
    const env = await host({ source: "fileclass", providerSettings: { classFilesPath: "other-types/", fileClassAlias: "kind", globalFileClass: "old" },
        settings: { fields: { type: "foo" } }, files: { "notes/one.md": { foo: "old", kind: "old" } } });
    const dialog = await env.open(); await dialog.submit(); await dialog.done;
    assert.deepEqual(env.read("notes/one.md"), { foo: "new", kind: "old" });
    assert.equal(env.provider.settings.globalFileClass, "old");
    assert.equal(env.providerSaves.length, 0);
});

test("nested type names, special replacement characters, and exact matching", async () => {
    const env = await host({ files: { "types/work/old.md": definition, "notes/one.md": { fileClass: ["work/old", "old", "work/older"] } } });
    const dialog = await env.open(); await dialog.submit("work/new$&", "work/old"); await dialog.done;
    assert.ok(env.fileAt("types/work/new$&.md"));
    assert.deepEqual(env.read("notes/one.md").fileClass, ["work/new$&", "old", "work/older"]);
});

test("invalid or existing names disable submission and cancellation writes nothing", async () => {
    const env = await host({ files: { "types/taken.md": definition, "types/parent.md": definition } });
    env.all.set("types/folder.md", new (env.all.get("types").constructor)("types/folder.md"));
    const dialog = await env.open();
    for (const name of ["", "   ", "old", "OLD", "taken", "Taken", "folder", "../escape", "/root", "a//b", "a/../b", "a\\b", "a\nb", "a,b", "new.md", "a#b", "CON", "parent.md/new"]) {
        dialog.control("New name").change(name);
        assert.equal(dialog.rename.disabled, true, name);
    }
    dialog.control("New name").change("valid");
    assert.equal(dialog.rename.disabled, false);
    dialog.modal.close(); await dialog.done;
    env.assertOriginal(); assert.deepEqual(env.renames, []); assert.deepEqual(env.writes, []);
});

test("a destination created while scanning is rejected without writes", async () => {
    const hooks = {};
    const env = await host({ hooks });
    const dialog = await env.open();
    hooks.read = file => { if (file.path === "types/old.md") { env.add("types/new.md", definition); delete hooks.read; } };
    await dialog.submit();
    assert.match(dialog.modal.status.text, /already exists/);
    assert.deepEqual(env.renames, []); assert.deepEqual(env.writes, []);
    dialog.modal.close(); await dialog.done;
});

test("malformed metadata aborts the scan before renaming anything", async () => {
    const env = await host({ files: { "broken.md": "---\n{invalid\n---\nbody" } });
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /Cannot read metadata in broken.md/);
    assert.deepEqual(env.renames, []); assert.deepEqual(env.writes, []);
    dialog.modal.close(); await dialog.done;
});

test("failure in a later note restores earlier metadata and schema filename", async () => {
    const hooks = { beforeWrite(file) { if (file.path === "later.md") { delete hooks.beforeWrite; throw new Error("Disk full"); } } };
    const env = await host({ hooks, files: { "later.md": { fileClass: ["old"] } } });
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /Disk full.*rolled back/);
    env.assertOriginal();
    assert.equal(env.fileAt("types/new.md"), undefined);
    dialog.modal.close(); await dialog.done;
});

test("backend save failure restores both backends' live settings and persisted settings", async () => {
    for (const source of ["fileclass", "metadata-menu"]) {
        const hooks = { saveProvider() { delete hooks.saveProvider; throw new Error("Settings write failed"); } };
        const env = await host({ source, hooks, settings: { typeAssignment: { targetType: "old" } }, providerSettings: { globalFileClass: "old", fileClassQueries: [{ fileClassName: "old" }] } });
        const dialog = await env.open(); await dialog.submit();
        assert.match(dialog.modal.status.text, /Settings write failed.*rolled back/);
        env.assertOriginal();
        assert.equal(env.saved.typeAssignment.targetType, "old");
        assert.equal(env.provider.settings.globalFileClass, "old");
        assert.equal(env.providerSaves.at(-1).globalFileClass, "old");
        if (source === "metadata-menu") assert.equal(env.provider.settings.fileClassQueries[0].fileClassName, "old");
        dialog.modal.close(); await dialog.done;
    }
});

test("schema rename failure leaves all declarations untouched", async () => {
    const env = await host({ hooks: { beforeRename() { throw new Error("Move failed"); } } });
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /Move failed/);
    env.assertOriginal(); assert.deepEqual(env.writes, []);
    dialog.modal.close(); await dialog.done;
});

test("unrelated concurrent metadata and link updates survive migration", async () => {
    const hooks = {};
    const env = await host({ hooks });
    hooks.afterRename = () => env.put("notes/one.md", { ...env.read("notes/one.md"), newProperty: "concurrent", link: "[[types/new]]" });
    const dialog = await env.open(); await dialog.submit(); await dialog.done;
    assert.deepEqual(env.read("notes/one.md"), { fileClass: "new", title: "Keep title", newProperty: "concurrent", link: "[[types/new]]" });
});

test("concurrent reassignment is preserved and stops the rename", async () => {
    const hooks = {};
    const env = await host({ hooks });
    hooks.beforeWrite = () => { delete hooks.beforeWrite; env.put("notes/one.md", { fileClass: "different" }); };
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /Metadata changed during rename/);
    assert.ok(env.fileAt("types/old.md"));
    assert.equal(env.read("notes/one.md").fileClass, "different");
    dialog.modal.close(); await dialog.done;
});

test("a newly created old-type note is detected by final verification", async () => {
    const hooks = {};
    const env = await host({ hooks });
    hooks.afterWrite = () => { delete hooks.afterWrite; env.add("newly-created.md", { fileClass: "old" }); };
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /old note type declaration appeared/);
    env.assertOriginal();
    assert.equal(env.read("newly-created.md").fileClass, "old");
    dialog.modal.close(); await dialog.done;
});

test("rollback failures name the remaining affected files", async () => {
    const hooks = { beforeWrite(file) { if (file.path === "later.md") throw new Error("Write failed"); },
        beforeRename(_file, destination) { if (destination === "types/old.md") throw new Error("Restore failed"); } };
    const env = await host({ hooks, files: { "later.md": { fileClass: "old" } } });
    const dialog = await env.open(); await dialog.submit();
    assert.match(dialog.modal.status.text, /Rollback incomplete: types\/new.md: Restore failed/);
    assert.ok(env.fileAt("types/new.md"));
    dialog.modal.close(); await dialog.done;
});

test("selected unavailable integration is rejected before opening the dialog", async () => {
    const env = await host({ settings: { schemaSource: "fileclass" } });
    await env.plugin.commands.get("rename-note-type").callback();
    assert.equal(env.modals.length, 0);
    assert.match(env.notices.at(-1), /not enabled: fileclass/);
});

test("concurrent rename attempts cannot interleave writes", async () => {
    const hooks = {};
    const env = await host({ hooks });
    const first = await env.open();
    const second = await env.open();
    let resume;
    hooks.beforeRename = () => new Promise(resolve => { resume = resolve; });
    const pending = first.submit();
    await tick();
    await second.submit("other");
    assert.match(second.modal.status.text, /already running/);
    second.modal.close(); await second.done;
    delete hooks.beforeRename; resume();
    await pending; await first.done;
    assert.deepEqual(env.renames, [["types/old.md", "types/new.md"]]);
});

test("the note type definition context menu preselects its type", async () => {
    const env = await host({ files: { "types/another.md": definition } });
    let handler;
    env.app.workspace.on = (event, callback) => { if (event === "file-menu") handler = callback; return {}; };
    env.plugin.registerCommands();
    const items = [];
    handler({ addSeparator() {}, addItem(fn) {
        const item = { setTitle(value) { this.title = value; return this; }, setIcon() { return this; }, setSection() { return this; }, onClick(callback) { this.callback = callback; return this; } };
        fn(item); items.push(item);
    } }, env.fileAt("types/another.md"));
    const done = items.find(item => item.title === "Rename note type").callback();
    await tick();
    const modal = env.modals.at(-1);
    assert.equal(modal.contentEl.rows.find(row => row.name === "Note type").controls[0].value, "another");
    modal.close(); await done;
    assert.deepEqual(env.renames, []);
});
