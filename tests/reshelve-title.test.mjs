import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { assignmentHost as host } from "./helpers/assignment-host.mjs";
const assignmentHost = options => host({ interactiveAssignment: true, ...options });

const frontmatter = { fileClass: "project", created: "2024-01-02T03:04:00", keep: ["Existing value"] };
const reshelve = env => env.plugin.commands.get("reshelve-typed-note").callback();

async function openPrompt(env, completion = reshelve(env)) {
    await new Promise(resolve => setImmediate(resolve));
    const modal = env.modals.at(-1);
    if (modal instanceof env.classes.TypedNoteFieldsModal) {
        const allRows = el => [...el.rows, ...el.children.flatMap(allRows)];
        const controls = allRows(modal.contentEl);
        const input = controls.find(row => row.name === env.plugin.settings.fields.title).controls[0];
        return { completion, modal, input, get error() { return modal.errorEl.text; },
            click(text) {
                if (text === "Cancel") return modal.close();
                input.change(input.inputEl.value);
                void modal.submit().then(() => { if (modal.errorEl.text) modal.close(); });
            },
        };
    }
    assert.ok(modal instanceof env.classes.InputModal, "Reshelving must ask for the missing title");
    const controls = modal.contentEl.rows.flatMap(row => row.controls);
    return {
        completion, modal,
        input: controls.find(control => control.inputEl),
        click: text => controls.find(control => control.text === text).click(),
    };
}

for (const [label, title] of [["missing", undefined], ["null", null], ["empty", ""], ["whitespace", " \t "]]) {
    test(`reshelve prompts when the title is ${label} and defaults to the current basename`, async () => {
        const original = { ...frontmatter, ...(title === undefined ? {} : { title }) };
        const env = await assignmentHost({ frontmatter: original, path: "inbox/foo-bar.md" });
        const prompt = await openPrompt(env);
        assert.equal(prompt.input.inputEl.value, "foo-bar");
        assert.deepEqual(env.frontmatter, original);
        assert.equal(env.renames.length, 0, "The note must not move while the prompt is open");
        prompt.click("OK");
        await prompt.completion;
        assert.deepEqual(env.frontmatter, { ...original, title: "foo-bar" });
        assert.equal(env.file.path, "content/project/20240102T0304--foo-bar.md");
        assert.equal(env.writes.length, 1);
        assert.equal(env.errors.length, 0);
    });
}

test("reshelve uses the entered title for metadata, filename, and folder templates", async () => {
    const env = await assignmentHost({ frontmatter, path: "inbox/foo-bar.md", settings: {
        pathMappings: [["^project$", "content/{{ title }}"]],
    } });
    const prompt = await openPrompt(env);
    prompt.input.inputEl.value = "  Edited title  ";
    prompt.input.listeners.get("keydown")({ key: "Enter", preventDefault() {} });
    await prompt.completion;
    assert.equal(env.frontmatter.title, "Edited title");
    assert.equal(env.file.path, "content/Edited title/20240102T0304--Edited title.md");
});

for (const action of ["Cancel", "close", "empty submission"]) {
    test(`${action} skips reshelving without changing the note`, async () => {
        const env = await assignmentHost({ frontmatter, path: "inbox/foo-bar.md" });
        const prompt = await openPrompt(env);
        if (action === "close") prompt.modal.close();
        else if (action === "empty submission") { prompt.input.inputEl.value = "  "; prompt.click("OK"); }
        else prompt.click(action);
        await prompt.completion;
        assert.deepEqual(env.frontmatter, frontmatter);
        assert.equal(env.file.path, "inbox/foo-bar.md");
        assert.equal(env.writes.length, 0);
        assert.equal(env.renames.length, 0);
        assert.equal(env.folders.length, 0);
        assert.equal(env.notices.includes("Already in correct location"), false);
    });
}

test("reshelve uses the configured title field and preserves a real title", async () => {
    const env = await assignmentHost({ frontmatter: { ...frontmatter, title: "Unrelated title", heading: "" },
        path: "inbox/foo-bar.md", settings: { fields: { title: "heading", type: "" } },
    });
    const prompt = await openPrompt(env);
    prompt.click("OK");
    await prompt.completion;
    assert.equal(env.frontmatter.heading, "foo-bar");
    assert.equal(env.frontmatter.title, "Unrelated title");
    await reshelve(env);
    assert.equal(env.modals.length, 1, "A saved title must not prompt again despite stale cached metadata");
    assert.equal(env.writes.length, 1);
});

test("reshelve does not prompt or write metadata when the title is present", async () => {
    const env = await assignmentHost({ frontmatter: { ...frontmatter, title: "Existing title" }, path: "inbox/foo-bar.md" });
    await reshelve(env);
    assert.equal(env.modals.length, 0);
    assert.equal(env.writes.length, 0);
    assert.equal(env.file.path, "content/project/20240102T0304--Existing title.md");
});

test("reshelve does not overwrite metadata edited while the title prompt was open", async () => {
    const env = await assignmentHost({ frontmatter, path: "inbox/foo-bar.md" });
    const prompt = await openPrompt(env);
    await env.app.fileManager.processFrontMatter(env.file, current => { current.title = "Written elsewhere"; });
    prompt.click("OK");
    await prompt.completion;
    assert.equal(env.frontmatter.title, "Written elsewhere");
    assert.equal(env.writes.length, 1, "Only the concurrent edit is written");
    assert.equal(env.renames.length, 0);
    assert.match(env.notices.at(-1), /note changed/i);
});

test("vault curation also prompts before reshelving a note without a title", async () => {
    const env = await assignmentHost({ frontmatter, path: "inbox/foo-bar.md" });
    env.classes.VaultCurationModal.prototype.openAndGetValue = async () => ({
        directory: "inbox", recursive: true, includePattern: "", excludePattern: "",
        runClean: false, runSort: false, runReshelve: true,
    });
    const prompt = await openPrompt(env, env.plugin.commands.get("curate-vault").callback());
    prompt.click("OK");
    await prompt.completion;
    assert.equal(env.frontmatter.title, "foo-bar");
    assert.equal(env.file.path, "content/project/20240102T0304--foo-bar.md");
    assert.match(env.notices.at(-1), /reshelved 1/);
});

function startAssignment(env, bulk) {
    if (!bulk) return env.assign();
    env.classes.BulkAssignNoteTypeModal.prototype.openAndGetValue = async () => ({
        targetType: "project", directory: "inbox", recursive: true, includePattern: "", excludePattern: "",
        runClean: true, cleanMode: "strict", runSort: true, sortMode: "schema", runReshelve: true,
    });
    env.classes.BulkAssignPreviewModal.prototype.openAndGetValue = async () => ({ selectedFiles: [env.file] });
    return env.plugin.commands.get("bulk-assign-note-type").callback();
}

for (const operation of ["reshelve", "reassign"]) {
    const start = env => operation === "reshelve" ? reshelve(env) : env.assign();
    for (const failure of ["folder", "rename", "write"]) {
        test(`${operation}: ${failure} failure preserves the original metadata and path`, async () => {
            const original = { ...frontmatter, fileClass: "old" };
            const env = await assignmentHost({ frontmatter: original, path: "inbox/foo-bar.md", failure });
            const prompt = await openPrompt(env, start(env));
            prompt.click("OK");
            await prompt.completion;
            assert.deepEqual(env.frontmatter, original);
            assert.equal(env.file.path, "inbox/foo-bar.md");
            assert.equal(env.writes.length, 0);
            assert.equal(env.renames.length, failure === "write" ? 2 : 0);
            assert.match(operation === "reassign" ? prompt.error : env.notices.at(-1), operation === "reassign" ? /failed/i : /Could not/);
        });
    }
    test(`${operation}: a destination collision leaves the entered title and other metadata unapplied`, async () => {
        const original = { ...frontmatter, fileClass: "old" };
        const type = operation === "reshelve" ? "old" : "project";
        const env = await assignmentHost({ frontmatter: original, path: "inbox/foo-bar.md",
            collision: `content/${type}/20240102T0304--foo-bar.md`,
        });
        const prompt = await openPrompt(env, start(env));
        prompt.click("OK");
        await prompt.completion;
        assert.deepEqual(env.frontmatter, original);
        assert.equal(env.writes.length, 0);
        assert.equal(env.renames.length, 0);
        assert.match(operation === "reassign" ? prompt.error : env.notices.at(-1), /Destination already exists/);
    });
}

for (const options of [{ updateFileLocation: false }, { autoRename: false }]) {
    test(`reassignment does not request a title when renaming is disabled: ${JSON.stringify(options)}`, async () => {
        const env = await assignmentHost({ frontmatter, path: "inbox/foo-bar.md", options, interactiveAssignment: false });
        await env.assign();
        assert.equal(env.modals.some(modal => modal instanceof env.classes.InputModal), false);
        assert.equal(env.file.basename, "foo-bar");
        assert.equal(env.frontmatter.fileClass, "project");
    });
}

test("reassignment saves an explicitly entered custom title even if strict removal excludes it from the schema", async () => {
    const env = await assignmentHost({ frontmatter: { fileClass: "old", heading: "", remove: "Old data" }, path: "inbox/foo-bar.md",
        settings: { fields: { title: "heading" } }, schemas: { old: { fields: [] }, project: { fields: [] } },
        options: { removeFields: "all", addMissingFields: false },
    });
    const prompt = await openPrompt(env, env.assign());
    prompt.click("OK");
    await prompt.completion;
    assert.deepEqual(env.frontmatter, { fileClass: "project", heading: "foo-bar" });
    assert.match(env.file.path, /--foo-bar\.md$/);
});

test("reassignment retains a new title in the requested field order after destination schema resolution", async () => {
    const env = await assignmentHost({ frontmatter: { ...frontmatter, fileClass: "old" }, path: "inbox/foo-bar.md",
        schemas: { old: { fields: [] }, project: { fields: [] }, destination: {
            filesPaths: ["content/project"], fields: [
                { name: "folderField", type: "Input" }, { name: "title", type: "Input" },
            ], fieldsOrder: ["folderField", "title"],
        } },
        options: { removeFields: "all" },
    });
    const prompt = await openPrompt(env, env.assign());
    prompt.click("OK");
    await prompt.completion;
    assert.deepEqual(env.frontmatter, { folderField: "", title: "foo-bar", fileClass: "project" });
    assert.deepEqual(Object.keys(env.frontmatter), ["folderField", "title", "fileClass"]);
});

for (const bulk of [false, true]) {
    const command = bulk ? "bulk reassignment" : "reassignment";
    for (const [label, title] of [["missing", undefined], ["null", null], ["empty", ""], ["whitespace", " \t "]]) {
        test(`${command} prompts when the title is ${label} before applying any changes`, async () => {
            const original = { ...frontmatter, fileClass: "old", ...(title === undefined ? {} : { title }) };
            const env = await assignmentHost({ frontmatter: original, path: "inbox/foo-bar.md" });
            const prompt = await openPrompt(env, startAssignment(env, bulk));
            assert.equal(prompt.input.inputEl.value, "foo-bar");
            assert.deepEqual(env.frontmatter, original);
            assert.equal(env.renames.length, 0);
            prompt.input.inputEl.value = "  New title  ";
            prompt.click("OK");
            await prompt.completion;
            assert.equal(env.frontmatter.fileClass, "project");
            assert.equal(env.frontmatter.title, "New title");
            assert.equal(env.file.path, "content/project/20240102T0304--New title.md");
            assert.equal(env.writes.length, 1);
            assert.equal(env.errors.length, 0);
        });
    }

    test(`cancelling the title prompt skips the entire ${command}`, async () => {
        const original = { ...frontmatter, fileClass: "old" };
        const env = await assignmentHost({ frontmatter: original, path: "inbox/foo-bar.md" });
        const prompt = await openPrompt(env, startAssignment(env, bulk));
        prompt.click("Cancel");
        await prompt.completion;
        assert.deepEqual(env.frontmatter, original);
        assert.equal(env.file.path, "inbox/foo-bar.md");
        assert.equal(env.writes.length, 0);
        assert.equal(env.renames.length, 0);
        assert.equal(env.folders.length, 0);
        assert.equal(env.errors.length, 0);
        if (bulk) assert.match(env.notices.at(-1), /Assigned note type to 0 file.*skipped 1/);
        else assert.equal(env.notices.some(notice => notice.startsWith("Assigned to")), false);
    });
}
