import assert from "node:assert/strict";
import test from "node:test";
import { assignmentHost, original } from "./helpers/assignment-host.mjs";

test("dialog exposes the requested defaults and dependent controls", async () => {
    const env = await assignmentHost({ settings: { defaultFieldSort: "alphabetical" } });
    const dialog = env.open();
    assert.equal(dialog.modal.contentEl.children[0].text, "Assign object to different type");
    for (const name of ["Update file location", "Auto-rename", "Auto-reshelve", "Add missing fields"]) {
        assert.equal(dialog.control(name).value, true);
    }
    assert.equal(dialog.control("Remove fields outside the new schema").value, "empty");
    assert.equal(dialog.control("Sort fields").value, "schema");
    assert.equal(dialog.row("New fields").settingEl.visible, false);
    dialog.control("Sort fields").change("none");
    assert.equal(dialog.row("New fields").settingEl.visible, true);
    assert.equal(dialog.control("New fields").value, "append");
    dialog.control("Update file location").change(false);
    assert.equal(dialog.row("Auto-rename").disabled, true);
    assert.equal(dialog.row("Auto-reshelve").disabled, true);
    dialog.control("Update file location").change(true);
    assert.equal(dialog.row("Auto-rename").disabled, false);
    dialog.click("Cancel");
    await dialog.completion;
    assert.equal(env.writes.length, 0);
    assert.equal(env.saves.length, 0);
});

test("default assignment updates metadata, filename, and folder in one action", async () => {
    const env = await assignmentHost({ cachedFrontmatter: { fileClass: "stale", title: "Wrong title" } });
    await env.assign();
    assert.equal(env.file.path, "content/project/20240102T0304--Current title.md");
    assert.equal(env.frontmatter.fileClass, "project");
    assert.equal(env.writes.length, 1);
    assert.equal(env.renames.length, 1);
    assert.deepEqual(Object.keys(env.frontmatter), [
        "title", "zeta", "shared", "alpha", "falseValue", "fileClass", "nested", "oldValue", "zero",
    ]);
    assert.match(env.notices.at(-1), /Assigned to "project": added 2, removed 2/);
    assert.ok((await env.app.vault.read(env.file)).endsWith(env.body));
});

for (const removeFields of ["empty", "all", "never"]) {
    for (const addMissingFields of [true, false]) {
        for (const order of ["schema", "alphabetical", "append", "prepend"]) {
            test(`${removeFields} removal, add=${addMissingFields}, order=${order}`, async () => {
                const env = await assignmentHost({ options: {
                    updateFileLocation: false, removeFields, addMissingFields,
                    sortMode: ["append", "prepend"].includes(order) ? "none" : order,
                    newFieldsPosition: order === "prepend" ? "prepend" : "append",
                } });
                await env.assign();
                assert.equal(env.errors.length, 0);
                assert.equal(env.frontmatter.fileClass, "project");
                assert.equal(env.frontmatter.title, original.title);
                assert.equal(env.frontmatter.shared, null, "present empty schema fields are preserved");
                const removed = removeFields === "all"
                    ? ["oldValue", "blank", "zero", "falseValue", "emptyList", "nested"]
                    : removeFields === "empty" ? ["blank", "emptyList"] : [];
                const existingKeys = Object.keys(original).filter(key => !removed.includes(key));
                for (const key of removed) assert.equal(Object.hasOwn(env.frontmatter, key), false);
                for (const key of existingKeys.filter(key => key !== "fileClass")) {
                    assert.deepEqual(env.frontmatter[key], original[key]);
                }
                const addedKeys = addMissingFields ? ["zeta", "alpha"] : [];
                if (addMissingFields) {
                    assert.equal(env.frontmatter.zeta, false);
                    assert.equal(env.frontmatter.alpha, "");
                    assert.equal(Object.hasOwn(env.frontmatter, "global"), false);
                } else {
                    for (const key of ["zeta", "alpha"]) assert.equal(Object.hasOwn(env.frontmatter, key), false);
                }
                const keys = Object.keys(env.frontmatter);
                if (order === "append") assert.deepEqual(keys, [...existingKeys, ...addedKeys]);
                if (order === "prepend") assert.deepEqual(keys, [...addedKeys, ...existingKeys]);
                if (order === "alphabetical") assert.deepEqual(keys, [...existingKeys, ...addedKeys].sort());
                if (order === "schema") {
                    const schemaKeys = addMissingFields ? ["title", "zeta", "shared", "alpha"] : ["title", "shared"];
                    assert.deepEqual(keys, [...schemaKeys, ...existingKeys.filter(key => !schemaKeys.includes(key)).sort()]);
                }
                assert.equal(env.file.path, "inbox/20240102T0304--old-name.md");
                assert.equal(env.renames.length, 0);
            });
        }
    }
}

for (const updateFileLocation of [false, true]) {
    for (const autoRename of [false, true]) {
        for (const autoReshelve of [false, true]) {
            test(`location=${updateFileLocation}, rename=${autoRename}, reshelve=${autoReshelve}`, async () => {
                const env = await assignmentHost({ options: { updateFileLocation, autoRename, autoReshelve } });
                await env.assign();
                const folder = updateFileLocation && autoReshelve ? "content/project" : "inbox";
                const name = updateFileLocation && autoRename ? "20240102T0304--Current title.md" : "20240102T0304--old-name.md";
                assert.equal(env.file.path, `${folder}/${name}`);
            });
        }
    }
}

test("all submitted choices survive saving and plugin reload", async () => {
    const env = await assignmentHost();
    const dialog = env.open();
    dialog.control("New object type").change("old");
    dialog.control("Auto-rename").change(false);
    dialog.control("Auto-reshelve").change(false);
    dialog.control("Update file location").change(false);
    dialog.control("Add missing fields").change(false);
    dialog.control("Remove fields outside the new schema").change("never");
    dialog.control("Sort fields").change("none");
    dialog.control("New fields").change("prepend");
    dialog.click("Assign type");
    await dialog.completion;
    const expected = {
        targetType: "old", updateFileLocation: false, autoRename: false, autoReshelve: false,
        addMissingFields: false, removeFields: "never", sortMode: "none", newFieldsPosition: "prepend",
    };
    assert.deepEqual(env.saved.typeAssignment, expected);
    await env.reload();
    assert.deepEqual(env.plugin.settings.typeAssignment, expected);
    const reopened = env.open();
    assert.equal(reopened.control("New object type").value, "old");
    assert.equal(reopened.control("New fields").value, "prepend");
    assert.equal(reopened.row("New fields").settingEl.visible, true);
    assert.equal(reopened.row("Auto-rename").disabled, true);
    reopened.click("Cancel");
    await reopened.completion;
});

test("older settings receive independent assignment defaults without sharing mutable objects", async () => {
    const env = await assignmentHost({ settings: { typeAssignment: undefined, fields: { type: "kind" } } });
    const other = await assignmentHost();
    assert.equal(env.plugin.settings.typeAssignment.removeFields, "empty");
    env.plugin.settings.typeAssignment.removeFields = "all";
    assert.equal(other.plugin.settings.typeAssignment.removeFields, "empty");
    assert.equal(env.plugin.settings.fields.type, "kind");
});

test("cancel discards dialog edits and leaves remembered settings unchanged", async () => {
    const env = await assignmentHost();
    const before = globalThis.structuredClone(env.plugin.settings);
    const dialog = env.open();
    dialog.control("Remove fields outside the new schema").change("all");
    dialog.modal.close();
    await dialog.completion;
    assert.deepEqual(env.plugin.settings, before);
    assert.deepEqual(env.frontmatter, original);
});

test("a removed remembered type falls back to the current available type", async () => {
    const env = await assignmentHost({ options: { targetType: "deleted" } });
    const dialog = env.open();
    assert.equal(dialog.control("New object type").value, "old");
    dialog.click("Cancel");
    await dialog.completion;
});

test("custom type aliases are assigned and protected from removal", async () => {
    const env = await assignmentHost({
        frontmatter: { kind: "old", title: "Keep title" },
        settings: { fields: { type: "kind", title: "title" } },
        options: { removeFields: "all", updateFileLocation: false },
    });
    await env.assign();
    assert.equal(env.frontmatter.kind, "project");
    assert.equal(Object.hasOwn(env.frontmatter, "fileClass"), false);
});

test("strict removal still renames using the current custom title and date properties", async () => {
    const env = await assignmentHost({
        frontmatter: { fileClass: "old", heading: "Current custom title", created: "2020-02-03T04:05:00", section: "work" },
        schemas: { old: { fields: [] }, project: { fields: [] } },
        settings: { fields: { title: "heading" }, pathMappings: [["^(.*)$", "{{ section }}/$1"]] },
        options: { removeFields: "all" },
    });
    await env.assign();
    assert.equal(env.file.path, "work/project/20200203T0405--Current custom title.md");
    assert.deepEqual(env.frontmatter, { fileClass: "project" });
});

test("location rules that are disabled are not evaluated", async () => {
    for (const mode of ["rename", "reshelve", "neither"]) {
        const env = await assignmentHost({
            settings: {
                pathMappings: [[mode === "rename" ? "[" : ".*", "target"]],
                filenameMappings: [[mode === "reshelve" ? "[" : ".*", "renamed"]],
            },
            options: { updateFileLocation: mode !== "neither", autoRename: mode === "rename", autoReshelve: mode === "reshelve" },
        });
        await env.assign();
        assert.equal(env.errors.length, 0);
    }
});

test("reshelving preserves Quarto extensions and rename-only keeps root notes at root", async () => {
    const quarto = await assignmentHost({ path: "inbox/20240102T0304--note.qmd" });
    await quarto.assign();
    assert.equal(quarto.file.path, "content/project/20240102T0304--Current title.qmd");
    const root = await assignmentHost({ path: "20240102T0304--note.md", options: { autoReshelve: false } });
    await root.assign();
    assert.equal(root.file.path, "20240102T0304--Current title.md");
});

test("a new discriminator obeys prepend/append even with optional fields disabled", async () => {
    for (const newFieldsPosition of ["prepend", "append"]) {
        const env = await assignmentHost({ frontmatter: { title: "Untyped" }, options: {
            updateFileLocation: false, addMissingFields: false, sortMode: "none", newFieldsPosition,
        } });
        await env.assign();
        assert.deepEqual(Object.keys(env.frontmatter), newFieldsPosition === "prepend" ? ["fileClass", "title"] : ["title", "fileClass"]);
    }
});

test("reads empty, absent, CRLF, BOM, and alternative-delimiter frontmatter", async () => {
    for (const rawContent of ["Body only", "---\n---\nBody", "\uFEFF---\r\n{}\r\n---\r\nBody", "---\n{}\n...\nBody"]) {
        const env = await assignmentHost({ frontmatter: {}, rawContent, options: { updateFileLocation: false, addMissingFields: false } });
        await env.assign();
        assert.deepEqual(env.frontmatter, { fileClass: "project" });
    }
});

test("rejects malformed or non-mapping frontmatter without writing", async () => {
    for (const rawContent of ["---\n{}", "---\ninvalid: [\n---", "---\n[]\n---", "---\n42\n---"]) {
        const env = await assignmentHost({ rawContent });
        await env.assign();
        assert.equal(env.writes.length, 0);
        assert.equal(env.errors.length, 1);
    }
});

test("unreadable target schemas prevent assignment and deletion", async () => {
    const env = await assignmentHost({ schemas: { project: null }, options: { removeFields: "all" } });
    await env.assign();
    assert.deepEqual(env.frontmatter, original);
    assert.match(env.notices.at(-1), /No field schema available/);
});

test("collisions leave both the note path and metadata unchanged", async () => {
    const env = await assignmentHost({ collision: "content/project/20240102T0304--Current title.md" });
    await env.assign();
    assert.deepEqual(env.frontmatter, original);
    assert.equal(env.writes.length, 0);
    assert.equal(env.renames.length, 0);
    assert.match(env.notices.at(-1), /Destination already exists/);
});

for (const failure of ["read", "save", "folder", "write"]) {
    test(`${failure} failure does not change metadata or move the note`, async () => {
        const env = await assignmentHost({ failure });
        await env.assign();
        assert.deepEqual(env.frontmatter, original);
        assert.equal(env.writes.length, 0);
        assert.equal(env.renames.length, failure === "write" ? 2 : 0);
        assert.equal(env.file.path, "inbox/20240102T0304--old-name.md");
        assert.match(env.notices.at(-1), /Could not assign object type/);
    });
}

test("rename failure leaves all metadata untouched", async () => {
    const env = await assignmentHost({ failure: "rename" });
    await env.assign();
    assert.deepEqual(env.frontmatter, original);
    assert.equal(env.file.path, "inbox/20240102T0304--old-name.md");
    assert.match(env.notices.at(-1), /Could not assign object type: Rename failed/);
});

test("concurrent metadata edits are preserved and invalidate the prepared assignment", async () => {
    const env = await assignmentHost({ beforeUpdate: fm => ({ ...fm, title: "Concurrent edit" }) });
    await env.assign();
    assert.equal(env.frontmatter.title, "Concurrent edit");
    assert.equal(env.frontmatter.fileClass, "old");
    assert.equal(env.writes.length, 0);
    assert.equal(env.renames.length, 2);
    assert.equal(env.file.path, "inbox/20240102T0304--old-name.md");
    assert.match(env.notices.at(-1), /note changed/);
});

test("no active note, unsupported files, and empty type folders do not open the dialog", async () => {
    for (const options of [{ active: false }, { path: "picture.png" }, { schemas: {} }]) {
        const env = await assignmentHost(options);
        await env.plugin.commands.get("assign-object-to-different-type").callback();
        assert.equal(env.modals.length, 0);
        assert.equal(env.writes.length, 0);
    }
});

test("the existing reshelve command still uses the same title and date rules", async () => {
    const env = await assignmentHost();
    await env.plugin.commands.get("reshelve-workflow-object").callback();
    assert.equal(env.file.path, "content/old/20240102T0304--Current title.md");
    assert.deepEqual(env.frontmatter, original);
});
