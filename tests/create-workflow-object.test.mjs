import assert from "node:assert/strict";
import test from "node:test";
import moment from "moment";
import yaml from "js-yaml";
import { assignmentHost } from "./helpers/assignment-host.mjs";

const field = (name, type = "Input", extra = {}) => ({ name, id: name, type, ...extra });
const runtime = { moment, parseYaml: yaml.load, stringifyYaml: yaml.dump };
const allRows = element => [...element.rows, ...element.children.flatMap(allRows)];
const rows = modal => allRows(modal.contentEl);
const control = (modal, name, index = 0) => rows(modal).find(row => row.name === name)?.controls[index];
const click = (modal, label) => rows(modal).flatMap(row => row.controls).find(control => control.text === label).click();
const frontmatter = env => yaml.load(env.created[0].content.split("---\n")[1]);

async function until(check) {
    for (let attempt = 0; attempt < 1000; attempt++) {
        if (check()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail("Expected command state was not reached");
}

async function open(options = {}) {
    const env = await assignmentHost({ source: "fileclass", schemas: { project: { fields: [] } }, runtime, ...options });
    env.classes.StringSuggesterModal.prototype.openAndGetValue = async () => "project";
    const completion = env.plugin.commands.get("create-new-workflow-object").callback();
    await until(() => env.modals.length || env.errors.length);
    assert.deepEqual(env.errors, []);
    const modal = env.modals.at(-1);
    await until(() => modal.previewEl.text);
    return { env, modal, completion };
}

async function submit(modal) {
    click(modal, "Create object");
    await until(() => !modal.saving);
}

test("creation command renders and saves typed, inherited and nested fields with the selected body", async () => {
    const before = moment();
    const { env, modal, completion } = await open({
        selection: "Selected **body**\n",
        providerSettings: { defaultDateTimeFormat: "YYYY/MM/DD HH:mm" },
        schemas: {
            parent: { fields: [field("inherited"), field("excluded")] },
            project: { extends: "parent", excludes: ["excluded"], fields: [
                field("title"), field("summary"), field("labels", "MultiInput"), field("day", "Date"),
                field("when", "DateTime"), field("clock", "Time"), field("count", "Number"), field("ready", "Boolean"),
                field("status", "Select", { options: ["Planned", "Done"] }),
                field("choices", "Multi", { options: { valuesList: { 0: "One, two", 1: "Three" } } }),
                field("details", "Object"), field("nested", "Input", { path: "details" }),
                field("milestones", "ObjectList"), field("label", "Input", { path: "milestones" }),
                field("done", "Checkbox", { path: "milestones" }), field("raw", "JSON"),
            ], fieldsOrder: ["title", "summary", "labels", "day", "when", "clock"] },
        },
    });
    for (const name of ["title", "summary", "inherited", "labels", "nested"]) {
        assert.equal(control(modal, name).inputEl.tag, "textarea");
        assert.equal(control(modal, name).inputEl.rows, 3);
    }
    assert.equal(control(modal, "excluded"), undefined);
    assert.equal(control(modal, "day").inputEl.type, "date");
    assert.equal(control(modal, "when").inputEl.type, "datetime-local");
    assert.equal(control(modal, "clock").inputEl.type, "time");
    assert.ok([before.format("YYYY-MM-DD"), moment().format("YYYY-MM-DD")].includes(control(modal, "day").value));
    assert.match(control(modal, "when").value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.match(control(modal, "clock").value, /^\d{2}:\d{2}$/);
    control(modal, "title").change("A title\ncontinued");
    control(modal, "summary").change("Line one\nLine two");
    control(modal, "labels").change("alpha, beta\ngamma\r\n , delta, ");
    control(modal, "day").change("2025-01-02");
    control(modal, "when").change("2025-01-02T03:04");
    control(modal, "clock").change("03:04");
    control(modal, "count").change("0");
    control(modal, "status").change("Done");
    control(modal, "Three").change(true);
    control(modal, "One, two").change(true);
    control(modal, "nested").change("Nested text");
    control(modal, "raw").change('{"quoted:key":[1,true,"text"]}');
    await click(modal, "Add item");
    control(modal, "label").change("First milestone");
    control(modal, "done").change(true);
    await submit(modal);
    await completion;
    const fm = frontmatter(env);
    assert.equal(fm.fileClass, "project");
    assert.equal(fm.title, "A title\ncontinued");
    assert.equal(fm.summary, "Line one\nLine two");
    assert.deepEqual(fm.labels, ["alpha", "beta", "gamma", "delta"]);
    assert.equal(fm.day, "2025-01-02");
    assert.equal(fm.when, "2025/01/02 03:04");
    assert.equal(fm.clock, "03:04");
    assert.equal(fm.count, 0);
    assert.equal(fm.ready, false);
    assert.equal(fm.status, "Done");
    assert.deepEqual(fm.choices, ["One, two", "Three"]);
    assert.deepEqual(fm.details, { nested: "Nested text" });
    assert.deepEqual(fm.milestones, [{ label: "First milestone", done: true }]);
    assert.deepEqual(fm.raw, { "quoted:key": [1, true, "text"] });
    assert.equal(fm.nested, undefined);
    assert.equal(fm.inherited, "");
    assert.deepEqual(Object.keys(fm).slice(0, 4), ["inherited", "title", "summary", "labels"]);
    assert.match(env.created[0].path, /^content\/project\/\d{8}T\d{4}--A title continued.md$/);
    assert.ok(env.created[0].content.endsWith("---\nSelected **body**\n"));
    assert.deepEqual(env.opened, [env.created[0].path]);
});

test("FileClass date-link formats and provider defaults preserve picker values", async () => {
    const { env, modal, completion } = await open({
        providerSettings: { defaultDateFormat: "YYYY/MM/DD", defaultTimeFormat: "HH:mm:ss" },
        schemas: { project: { fields: [field("daily", "Date", { options: {
            dateFormat: "YYYY-MM-DD ddd", defaultInsertAsLink: "true", dateLinkPath: "Daily/{{YYYY}}/{{MM}}", dateLinkAlias: true,
        } }), field("time", "Time")] } },
    });
    control(modal, "title").change("Date object");
    control(modal, "daily").change("2025-01-02");
    control(modal, "time").change("15:45");
    await submit(modal); await completion;
    assert.equal(frontmatter(env).daily, "[[Daily/2025/01/2025-01-02 Thu|2025-01-02 Thu]]");
    assert.equal(frontmatter(env).time, "15:45:00");
});

test("directory and filename overrides are independent, reversible, and used by the final write", async () => {
    const { env, modal, completion } = await open({
        settings: { filenameMappings: [[".*", "{{ title }}"]], pathMappings: [[".*", "{{ section }}/$1"]] },
        schemas: { project: { fields: [field("section")] } },
    });
    control(modal, "title").change("First");
    control(modal, "section").change("drafts");
    await until(() => modal.previewEl.text === "Destination: drafts/First.md");
    control(modal, "Override directory").change(true);
    control(modal, "Directory").change("custom/deep/");
    control(modal, "title").change("Second");
    await until(() => modal.previewEl.text === "Destination: custom/deep/Second.md");
    control(modal, "Override filename").change(true);
    control(modal, "Filename").change("Manual.md");
    control(modal, "title").change("Third");
    await until(() => modal.previewEl.text === "Destination: custom/deep/Manual.md");
    control(modal, "Override directory").change(false);
    await until(() => modal.previewEl.text === "Destination: drafts/Manual.md");
    control(modal, "Override directory").change(true);
    control(modal, "Directory").change("");
    await submit(modal); await completion;
    assert.equal(env.created[0].path, "Manual.md");
    assert.equal(frontmatter(env).title, "Third");
    assert.deepEqual(env.folders, []);
});

test("file pickers preserve Base group order, display aliases, and links relative to the overridden destination", async () => {
    const calls = [], generated = [];
    const { env, modal, completion } = await open({
        extraFiles: { "refs/a.md": "", "refs/z.md": "", "images/cover.png": "" },
        schemas: { project: { fields: [field("related", "MultiFile", { options: { baseFile: "links.base", viewName: "Ordered", displayColumn: "note.title" } }), field("cover", "Media")] } },
        basesAdapter: { isBasesAvailable: () => true, getBaseRows: async (app, ...args) => {
            calls.push(args);
            const row = (path, display) => ({ file: app.vault.getAbstractFileByPath(path), values: { "note.title": display } });
            return { rows: [], groups: [{ key: "Z first", rows: [row("refs/z.md", "Last name")] }, { key: "A second", rows: [row("refs/a.md", "First name")] }] };
        } },
        generateLink: (file, source, _subpath, alias) => {
            generated.push({ file: file.path, source, alias });
            return `[${alias ?? file.basename}](../${file.path})`;
        },
    });
    control(modal, "title").change("Links");
    control(modal, "Override directory").change(true);
    control(modal, "Directory").change("custom");
    control(modal, "related").click();
    await until(() => env.modals.at(-1).items?.length === 2);
    const picker = env.modals.at(-1);
    assert.deepEqual(picker.items.map(item => item.file.path), ["refs/z.md", "refs/a.md"]);
    assert.match(picker.statusEl.text, /unsaved object/);
    control(picker, "First name").change(true);
    control(picker, "Last name").change(true);
    click(picker, "Use selected files");
    await until(() => modal.draft.fields.find(field => field.definition.name === "related").links.length === 2);
    control(modal, "cover").click();
    await until(() => env.modals.at(-1).items?.length === 1);
    const mediaPicker = env.modals.at(-1);
    assert.equal(mediaPicker.items[0].file.path, "images/cover.png");
    click(mediaPicker, "Select");
    await until(() => modal.draft.fields.find(field => field.definition.name === "cover").links.length === 1);
    await submit(modal); await completion;
    assert.deepEqual(frontmatter(env).related, ["[Last name](../refs/z.md)", "[First name](../refs/a.md)"]);
    assert.equal(frontmatter(env).cover, "[cover](../images/cover.png)");
    assert.ok(generated.slice(-3).every(call => call.source === env.created[0].path));
    assert.deepEqual(calls, [["links.base", "Ordered", undefined]]);
});

test("picker falls back visibly when Bases is unavailable, and cancelling preserves the draft", async () => {
    const { env, modal, completion } = await open({ schemas: { project: { fields: [field("related", "File", { options: { baseFile: "missing.base" } })] } } });
    control(modal, "title").change("Keep my entries");
    control(modal, "related").click();
    await until(() => env.modals.at(-1).items?.length);
    const picker = env.modals.at(-1);
    assert.match(picker.statusEl.text, /Bases is unavailable/);
    click(picker, "Cancel");
    assert.equal(control(modal, "title").value, "Keep my entries");
    click(modal, "Cancel"); await completion;
    assert.deepEqual(env.created, []);
    assert.deepEqual(env.folders, []);
    assert.deepEqual(env.writes, []);
});

for (const [name, input, error] of [
    ["missing title", null, /Enter a title/],
    ["traversal", "../escape", /vault-relative/],
    ["absolute directory", "/outside", /vault-relative/],
    ["invalid directory", "bad:directory", /vault-relative/],
    ["folder occupied by file", "occupied.md/sub", /file blocks/],
]) test(`${name} leaves the form and its values intact`, async () => {
    const { env, modal, completion } = await open({ extraFiles: { "occupied.md": "" } });
    if (input !== null) {
        control(modal, "title").change("Entered title");
        control(modal, "Override directory").change(true);
        control(modal, "Directory").change(input);
    }
    await submit(modal);
    assert.match(modal.errorEl.text, error);
    assert.deepEqual(env.created, []);
    assert.deepEqual(env.folders, []);
    click(modal, "Cancel"); await completion;
});

test("collision can be corrected in the same form without losing metadata", async () => {
    const { env, modal, completion } = await open({
        collision: "content/project/Existing.md", settings: { filenameMappings: [[".*", "{{ title }}"]] },
        schemas: { project: { fields: [field("notes")] } },
    });
    control(modal, "title").change("Existing");
    control(modal, "notes").change("Keep this text");
    await submit(modal);
    assert.match(modal.errorEl.text, /File already exists/);
    control(modal, "Override filename").change(true);
    control(modal, "Filename").change("Different");
    await submit(modal); await completion;
    assert.equal(env.created.length, 1);
    assert.equal(env.created[0].path, "content/project/Different.md");
    assert.equal(frontmatter(env).notes, "Keep this text");
});

for (const source of ["none", "metadata-menu"]) test(`creation works with ${source === "none" ? "standalone schemas" : "Metadata Menu"}`, async () => {
    const { env, modal, completion } = await open({ source,
        settings: { fields: { title: "heading", type: "kind" }, defaultFieldSort: "alphabetical" },
        schemas: { project: { fields: [field("zeta"), field("alpha", "Multi"), field("kind")] } },
    });
    control(modal, "heading").change("Custom title");
    control(modal, "alpha").change("one,two\nthree");
    assert.equal(control(modal, "kind"), undefined);
    await submit(modal); await completion;
    assert.deepEqual(Object.keys(frontmatter(env)), ["alpha", "heading", "kind", "zeta"]);
    assert.deepEqual(frontmatter(env).alpha, ["one", "two", "three"]);
    assert.equal(frontmatter(env).kind, "project");
});

test("schema changes and write failures cannot silently discard the form", async () => {
    const schemas = { project: { fields: [field("count", "Number", { options: { min: 0, max: 5 } }), field("raw", "JSON")] } };
    const { env, modal, completion } = await open({ schemas, failure: "create" });
    control(modal, "title").change("Retain draft");
    control(modal, "count").change("6");
    await submit(modal);
    assert.match(modal.errorEl.text, /maximum is 5/);
    control(modal, "count").change("3.5");
    control(modal, "raw").change("broken");
    await submit(modal);
    assert.match(modal.errorEl.text, /valid JSON/);
    control(modal, "raw").change("{}");
    await submit(modal);
    assert.match(modal.errorEl.text, /Create failed/);
    schemas.project.fields.push(field("newField"));
    await submit(modal);
    assert.match(modal.errorEl.text, /schema changed/);
    assert.equal(control(modal, "title").value, "Retain draft");
    assert.deepEqual(env.created, []);
    click(modal, "Cancel"); await completion;
});

test("note and Base choice sources supply typed controls, while unavailable queries explain manual entry", async () => {
    const { env, modal, completion } = await open({
        extraFiles: { "lists/status.md": "Todo\nDoing\nDone\n" },
        schemas: { project: { fields: [
            field("status", "Cycle", { options: { sourceType: "ValuesListNotePath", valuesListNotePath: "lists/status.md" } }),
            field("category", "Select", { options: { sourceType: "ValuesFromBase", baseFile: "choices.base", valuesColumn: "note.category" } }),
            field("legacy", "Multi", { options: { sourceType: "ValuesFromDVQuery" } }),
            field("yaml", "YAML"), field("lookup", "Lookup"),
        ] } },
        basesAdapter: { isBasesAvailable: () => true, getBaseRows: async () => ({
            rows: [{ values: { "note.category": "B" } }, { values: { "note.category": "A" } }, { values: { "note.category": "B" } }], groups: null,
        }) },
    });
    assert.deepEqual([...control(modal, "status").options.keys()], ["", "Todo", "Doing", "Done"]);
    assert.deepEqual([...control(modal, "category").options.keys()], ["", "B", "A"]);
    assert.match(rows(modal).find(row => row.name === "legacy").description, /Dataview choices require a saved note/);
    assert.equal(control(modal, "lookup").disabled, true);
    control(modal, "title").change("Choice sources");
    control(modal, "status").change("Doing");
    control(modal, "category").change("B");
    control(modal, "legacy").change("First\nSecond");
    control(modal, "yaml").change("nested:\n  enabled: true\n  count: 0");
    await submit(modal); await completion;
    assert.equal(frontmatter(env).status, "Doing");
    assert.equal(frontmatter(env).category, "B");
    assert.deepEqual(frontmatter(env).legacy, ["First", "Second"]);
    assert.deepEqual(frontmatter(env).yaml, { nested: { enabled: true, count: 0 } });
});

test("deleted file selections must be corrected before creation", async () => {
    const { env, modal, completion } = await open({ schemas: { project: { fields: [field("reference", "File")] } } });
    control(modal, "title").change("Keep draft");
    control(modal, "reference").click();
    await until(() => env.modals.at(-1).items?.length);
    const picker = env.modals.at(-1);
    control(picker, env.file.basename).click();
    await until(() => modal.draft.fields.find(field => field.definition.name === "reference").links.length);
    const originalGet = env.app.vault.getAbstractFileByPath;
    const selected = modal.draft.fields.find(field => field.definition.name === "reference").links[0].file;
    // Replace the chosen file with a new object at the same path: the old selection is stale.
    env.app.vault.getAbstractFileByPath = path => path === selected.path ? { path } : originalGet(path);
    await submit(modal);
    assert.match(modal.errorEl.text, /Linked file no longer exists/);
    assert.deepEqual(env.created, []);
    click(modal, "Cancel"); await completion;
});
