import assert from "node:assert/strict";
import test from "node:test";
import moment from "moment";
import yaml from "js-yaml";
import { assignmentHost } from "./helpers/assignment-host.mjs";

const field = (name, type = "Input", extra = {}) => ({ name, id: name, type, ...extra });
const runtime = { moment, parseYaml: yaml.load, stringifyYaml: yaml.dump };
const allRows = element => [...element.rows, ...element.children.flatMap(allRows)];
const control = (modal, name, index = 0) => allRows(modal.contentEl).find(row => row.name === name)?.controls[index];
const click = (modal, text) => allRows(modal.contentEl).flatMap(row => row.controls).find(control => control.text === text).click();
async function until(check) {
    for (let attempt = 0; attempt < 1000; attempt++) {
        if (check()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail("Editor did not reach the expected state");
}
async function open(options = {}) {
    const env = await assignmentHost({ interactiveAssignment: true, source: "fileclass", runtime,
        options: { updateFileLocation: false, removeFields: "never", ...options.options }, ...options });
    const first = env.open();
    first.click("Review fields");
    await until(() => env.modals.at(-1) instanceof env.classes.TypedNoteFieldsModal || env.errors.length);
    assert.deepEqual(env.errors, []);
    const modal = env.modals.at(-1);
    await until(() => modal.previewEl.text);
    assert.deepEqual(env.writes, []);
    assert.deepEqual(env.renames, []);
    return { env, modal, completion: first.completion };
}
async function save(modal) {
    click(modal, "Assign note type");
    await until(() => !modal.saving);
}

test("assignment editor prefills existing data and supplies typed defaults only for absent fields", async () => {
    const original = { fileClass: "old", title: "Old title", summary: "First\nSecond", labels: ["one, two", "three"],
        number: 0, enabled: false, emptyDate: "", day: "2024/05/06", nullable: null, status: "Legacy choice", choices: ["Option B"],
        details: { nested: "Existing nested", hidden: "Keep hidden" },
        tasks: [{ task: "Existing task", extra: 42 }], extraText: "Retained extra",
    };
    const { env, modal, completion } = await open({ frontmatter: original,
        cachedFrontmatter: { fileClass: "old", title: "Stale title" }, providerSettings: { defaultDateFormat: "YYYY/MM/DD" },
        schemas: { old: { fields: [] }, project: { fields: [field("title"), field("summary"), field("labels", "MultiInput"),
            field("number", "Number"), field("enabled", "Boolean"), field("emptyDate", "Date"), field("day", "Date"),
            field("nullable", "Input"), field("status", "Select", { options: ["New choice"] }), field("choices", "Multi", { options: ["Option A", "Option B"] }), field("newDay", "Date"),
            field("newClock", "Time"), field("newText"), field("newList", "MultiInput"),
            field("details", "Object"), field("nested", "Input", { path: "details" }),
            field("tasks", "ObjectList"), field("task", "Input", { path: "tasks" }),
        ] } },
    });
    assert.equal(control(modal, "title").value, "Old title");
    assert.equal(control(modal, "summary").value, "First\nSecond");
    assert.equal(control(modal, "labels").value, "one, two\nthree");
    assert.equal(control(modal, "number").value, "0");
    assert.equal(control(modal, "enabled").value, false);
    assert.equal(control(modal, "emptyDate").value, "");
    assert.equal(control(modal, "day").value, "2024-05-06");
    assert.equal(control(modal, "status").value, "Legacy choice");
    assert.equal(control(modal, "nullable").value, "");
    assert.equal(control(modal, "Option A").value, false);
    assert.equal(control(modal, "Option B").value, true);
    assert.equal(control(modal, "newDay").value, moment().format("YYYY-MM-DD"));
    assert.equal(control(modal, "newClock").inputEl.type, "time");
    assert.equal(control(modal, "nested").value, "Existing nested");
    assert.equal(control(modal, "task").value, "Existing task");
    assert.equal(control(modal, "extraText").value, "Retained extra");
    control(modal, "summary").change("Edited\nsummary");
    control(modal, "nested").change("Edited nested");
    control(modal, "task").change("Edited task");
    await save(modal); await completion;
    const fm = env.frontmatter;
    assert.equal(fm.fileClass, "project");
    assert.equal(fm.summary, "Edited\nsummary");
    for (const name of ["labels", "number", "enabled", "emptyDate", "day", "nullable", "status", "choices", "extraText"]) assert.deepEqual(fm[name], original[name]);
    assert.deepEqual(fm.details, { nested: "Edited nested", hidden: "Keep hidden" });
    assert.deepEqual(fm.tasks, [{ task: "Edited task", extra: 42 }]);
    assert.equal(fm.newDay, moment().format("YYYY/MM/DD"));
    assert.equal(fm.newText, "");
    assert.deepEqual(fm.newList, []);
    assert.equal(env.writes.length, 1);
    assert.equal(env.created.length, 0);
    assert.equal(env.renames.length, 0);
});

test("incompatible old values and unresolved links stay visible and survive an unchanged save", async () => {
    const original = { fileClass: "old", title: "Title", amount: "not numeric", related: "[[Missing#Heading|Alias]]", tags: [1, false], object: ["not an object"] };
    const { env, modal, completion } = await open({ frontmatter: original,
        schemas: { old: { fields: [] }, project: { fields: [field("amount", "Number"), field("related", "File"), field("tags", "MultiInput"),
            field("object", "Object"), field("child", "Input", { path: "object" })] } },
    });
    assert.equal(control(modal, "amount").inputEl.tag, "textarea");
    assert.equal(control(modal, "amount").value, '"not numeric"');
    assert.equal(control(modal, "related").value, '"[[Missing#Heading|Alias]]"');
    assert.deepEqual(JSON.parse(control(modal, "tags").value), [1, false]);
    await save(modal); await completion;
    assert.deepEqual(env.frontmatter, { ...original, fileClass: "project" });
});

test("an incompatible value can be replaced using the schema's typed editor", async () => {
    const { env, modal, completion } = await open({ frontmatter: { fileClass: "old", title: "Title", amount: "old text" },
        schemas: { old: { fields: [] }, project: { fields: [field("amount", "Number")] } },
    });
    await click(modal, "Use schema input");
    assert.equal(control(modal, "amount").inputEl.type, "number");
    control(modal, "amount").change("12.5");
    await save(modal); await completion;
    assert.equal(env.frontmatter.amount, 12.5);
});

test("disabling missing-field insertion adds only explicitly edited new fields", async () => {
    const { env, modal, completion } = await open({ options: { updateFileLocation: false, addMissingFields: false, removeFields: "never", sortMode: "none", newFieldsPosition: "prepend" },
        frontmatter: { fileClass: "old", title: "Title", count: null },
        schemas: { old: { fields: [] }, project: { fields: [field("newText"), field("newDate", "Date"), field("count", "Number"), field("newList", "MultiInput")] } },
    });
    assert.equal(control(modal, "newDate").inputEl.type, "date");
    control(modal, "newText").change("Explicit value");
    await save(modal); await completion;
    assert.deepEqual(env.frontmatter, { newText: "Explicit value", fileClass: "project", title: "Title", count: null });
    assert.equal(Object.keys(env.frontmatter)[0], "newText");
});

test("edited title and metadata drive relocation and expose destination-bound fields", async () => {
    const { env, modal, completion } = await open({ options: { updateFileLocation: true, removeFields: "all" },
        settings: { pathMappings: [[".*", "{{ section }}"]] },
        frontmatter: { fileClass: "old", title: "Before", section: "inbox", old: "Remove", details: { owner: "Old owner" } },
        schemas: { old: { fields: [] }, project: { fields: [field("title"), field("section"), field("details", "Object"), field("owner", "Input", { path: "details" })] },
            destination: { filesPaths: ["new-folder"], fields: [field("destinationField"), field("nestedDestination", "Input", { path: "details" })] } },
    });
    control(modal, "title").change("Edited title");
    control(modal, "owner").change("Edited owner");
    control(modal, "section").change("new-folder");
    await until(() => !!control(modal, "destinationField"));
    assert.equal(control(modal, "owner").value, "Edited owner");
    control(modal, "nestedDestination").change("Nested destination value");
    control(modal, "destinationField").change("Destination value");
    await until(() => modal.previewEl.text.includes("new-folder/20240102T0304--Edited title.md"));
    assert.match(modal.summaryEl.text, /old/);
    await save(modal); await completion;
    assert.equal(env.file.path, "new-folder/20240102T0304--Edited title.md");
    assert.deepEqual(env.frontmatter, { title: "Edited title", section: "new-folder", details: { owner: "Edited owner", nestedDestination: "Nested destination value" }, destinationField: "Destination value", fileClass: "project" });
});

test("saved file links preselect candidates and edited links use the final destination", async () => {
    const calls = [], generated = [];
    const { env, modal, completion } = await open({ options: { updateFileLocation: true, removeFields: "never" },
        frontmatter: { fileClass: "old", title: "Before", related: ["[[refs/one|One alias]]"] },
        extraFiles: { "refs/one.md": "", "refs/two.md": "" },
        schemas: { old: { fields: [] }, project: { fields: [field("title"), field("related", "MultiFile", { options: { baseFile: "refs.base" } })] } },
        basesAdapter: { isBasesAvailable: () => true, getBaseRows: async (app, ...args) => {
            calls.push(args);
            return { rows: ["refs/one.md", "refs/two.md"].map(path => ({ file: app.vault.getAbstractFileByPath(path), values: {} })), groups: null };
        } },
        generateLink: (file, source) => { generated.push(source); return `[[${file.basename}]]`; },
    });
    control(modal, "related").click();
    await until(() => env.modals.at(-1).items?.length === 2);
    const picker = env.modals.at(-1);
    assert.equal(control(picker, "one").value, true);
    control(picker, "two").change(true);
    click(picker, "Use selected files");
    await until(() => modal.draft.fields.find(field => field.definition.name === "related").dirty);
    control(modal, "title").change("After");
    await save(modal); await completion;
    assert.deepEqual(env.frontmatter.related, ["[[one]]", "[[two]]"]);
    assert.equal(generated.at(-1), env.file.path);
    assert.deepEqual(calls[0], ["refs.base", undefined, "inbox/20240102T0304--old-name.md"]);
});

for (const action of ["cancel", "close"]) test(`${action} in the field editor cancels the entire assignment`, async () => {
    const { env, modal, completion } = await open({ options: { removeFields: "all" } });
    const original = structuredClone(env.frontmatter);
    control(modal, "title").change("Should not save");
    if (action === "cancel") click(modal, "Cancel"); else modal.close();
    await completion;
    assert.deepEqual(env.frontmatter, original);
    assert.equal(env.writes.length, 0);
    assert.equal(env.renames.length, 0);
    assert.equal(env.folders.length, 0);
});

test("external metadata changes while the editor is open prevent both relocation and overwrite", async () => {
    const { env, modal, completion } = await open({ options: { updateFileLocation: true } });
    control(modal, "title").change("Draft title");
    env.changeFrontmatter({ ...env.frontmatter, title: "External edit" });
    await save(modal);
    assert.match(modal.errorEl.text, /note changed/);
    assert.equal(env.frontmatter.title, "External edit");
    assert.equal(control(modal, "title").value, "Draft title");
    assert.deepEqual(env.renames, []);
    assert.deepEqual(env.folders, []);
    click(modal, "Cancel"); await completion;
});

test("schema changes cannot silently replace a draft prepared against the old fields", async () => {
    const schemas = { old: { fields: [] }, project: { fields: [field("title"), field("notes")] } };
    const { env, modal, completion } = await open({ schemas });
    control(modal, "notes").change("Draft notes");
    schemas.project.fields.push(field("newSchemaField"));
    await save(modal);
    assert.match(modal.errorEl.text, /schema changed/);
    assert.equal(control(modal, "notes").value, "Draft notes");
    assert.deepEqual(env.writes, []);
    click(modal, "Cancel"); await completion;
});

test("clearing a retained extra field obeys empty-field removal across later previews and save", async () => {
    const { env, modal, completion } = await open({ options: { updateFileLocation: false, removeFields: "empty" },
        frontmatter: { fileClass: "old", title: "Title", extra: "Keep until cleared" },
    });
    control(modal, "extra").change("");
    await until(() => modal.summaryEl.text.includes("extra"));
    control(modal, "title").change("Another edit");
    await save(modal); await completion;
    assert.equal(Object.hasOwn(env.frontmatter, "extra"), false);
    assert.equal(env.frontmatter.title, "Another edit");
});
