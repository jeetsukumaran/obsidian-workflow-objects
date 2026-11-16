import assert from "node:assert/strict";
import test from "node:test";
import { assignmentHost } from "./helpers/assignment-host.mjs";

const field = (name, type = "Input", extra = {}) => ({ id: `${name}Id`, name, type, ...extra });
const schema = (...names) => ({ fields: names.map(name => field(name)) });
const noMove = { updateFileLocation: false };
const strict = { preserveDefinedFields: true, removeUndefinedFields: true, addMissingFields: true, sortMode: "schema" };

for (const source of ["none", "fileclass", "metadata-menu"]) {
    test(`${source}: inheritance, exclusions, name order, and reassignment preserve required values`, async () => {
        const env = await assignmentHost({ source, options: { ...noMove, removeFields: "all" },
            frontmatter: { fileClass: "old", title: "Keep", inherited: "Keep parent", excluded: "Remove", extra: "Remove" },
            schemas: {
                old: schema("extra"), parent: schema("title", "inherited", "excluded"),
                project: { extends: "parent", excludes: ["excluded"], fields: [field("own")], fieldsOrder: ["own", "inherited", "title"] },
            },
        });
        await env.assign();
        assert.equal(env.errors.length, 0);
        assert.deepEqual(env.frontmatter, { own: "", inherited: "Keep parent", title: "Keep", fileClass: "project" });
        assert.deepEqual(Object.keys(env.frontmatter), ["own", "inherited", "title", "fileClass"]);
    });

    test(`${source}: cleanup uses fresh metadata and keeps inherited empty fields`, async () => {
        const env = await assignmentHost({ source, frontmatter: { fileClass: "project", inherited: "", extra: "delete" },
            cachedFrontmatter: { fileClass: "old" },
            schemas: { old: schema("extra"), parent: schema("inherited"), project: { extends: "parent", fields: [] } },
        });
        await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
        assert.deepEqual(env.frontmatter, { inherited: "", fileClass: "project" });
    });

    test(`${source}: nested children stay nested and missing containers get appropriate defaults`, async () => {
        const env = await assignmentHost({ source, frontmatter: { fileClass: "project", details: { city: "Paris" } },
            schemas: { project: { fields: [field("details", "Object"), field("city", "Input", { path: "detailsId" }), field("items", "ObjectList")] } },
        });
        await env.plugin.commands.get("insert-missing-frontmatter-schema").callback();
        assert.deepEqual(env.frontmatter, { details: { city: "Paris" }, items: [], fileClass: "project" });
        assert.equal(Object.hasOwn(env.frontmatter, "city"), false);
        assert.equal(Object.hasOwn(env.frontmatter, "global"), false, "preset settings are never inserted");
    });
}

test("automatic source prefers FileClass; explicit selection and standalone remain independent", async () => {
    const env = await assignmentHost({ source: "fileclass", providerSettings: { fileClassAlias: "kind" }, settings: { typesPath: null } });
    env.app.plugins.plugins["metadata-menu"] = { settings: { classFilesPath: "old-types/", fileClassAlias: "legacy" } };
    assert.equal(env.plugin.typeService.getSource(), "fileclass");
    assert.equal(env.plugin.typeService.getTypeFieldName(), "kind");
    assert.equal(env.plugin.typeService.getTypesPath(), "types");
    env.plugin.settings.schemaSource = "metadata-menu";
    assert.equal(env.plugin.typeService.getTypesPath(), "old-types");
    assert.equal(env.plugin.typeService.getTypeFieldName(), "legacy");
    env.plugin.settings.schemaSource = "standalone";
    assert.equal(env.plugin.typeService.getTypesPath(), "system/schema/content-types");
    assert.equal(env.plugin.typeService.getTypeFieldName(), "fileClass");
    env.plugin.settings.fields.type = "manual";
    env.plugin.settings.typesPath = "custom/";
    assert.equal(env.plugin.typeService.getTypeFieldName(), "manual");
    assert.equal(env.plugin.typeService.getTypesPath(), "custom");
    await env.plugin.saveSettings();
    await env.reload();
    assert.equal(env.plugin.settings.schemaSource, "standalone");
});

test("FileClass's public API supplies resolved field order", async () => {
    const calls = [];
    const env = await assignmentHost({ source: "fileclass", schemas: { project: schema("one", "two") },
        frontmatter: { fileClass: "project" }, providerApi: { version: "1.1", async getSchema(name) {
            calls.push(name); return { fields: [field("two"), field("one")] };
        } },
    });
    await env.plugin.commands.get("insert-missing-frontmatter-schema").callback();
    assert.deepEqual(Object.keys(env.frontmatter), ["two", "one", "fileClass"]);
    assert.deepEqual(calls, ["project"]);
});

test("stale FileClass schemas cannot authorize metadata removal", async () => {
    const env = await assignmentHost({ source: "fileclass", options: { ...noMove, removeFields: "all" },
        schemas: { project: schema("required") }, providerApi: { async getSchema() { return { fields: [] }; } },
        frontmatter: { required: "Keep", unrelated: "Keep until schema is known" },
    });
    await env.assign();
    assert.equal(env.writes.length, 0);
    assert.match(env.notices.at(-1), /index is out of date/);
});

test("all insertion modes recognize name and legacy ID orders", async () => {
    for (const fieldsOrder of [["c", "a", "b"], ["cId", "aId", "bId"]]) {
        for (const command of ["insert-missing-frontmatter-schema", "append-missing-frontmatter", "prepend-missing-frontmatter"]) {
            const env = await assignmentHost({ source: "fileclass", schemas: { project: { ...schema("a", "b", "c"), fieldsOrder } }, frontmatter: { fileClass: "project" } });
            await env.plugin.commands.get(command).callback();
            assert.deepEqual(Object.keys(env.frontmatter).filter(key => key !== "fileClass"), ["c", "a", "b"]);
        }
    }
});

test("nested class folders are listed and assigned using their relative class names", async () => {
    const env = await assignmentHost({ source: "fileclass", schemas: { "work/project": schema("title") }, options: { ...noMove, targetType: "work/project" } });
    assert.deepEqual(env.plugin.typeService.getTypeNames(), ["work/project"]);
    await env.assign();
    assert.equal(env.frontmatter.fileClass, "work/project");
});

test("reassignment retains tag, bookmark, and global fields, with tags that keep those classes bound", async () => {
    const env = await assignmentHost({ source: "fileclass", providerSettings: { globalFileClass: "baseline" },
        cachedTags: ["#inline"], bookmarks: [{ type: "group", title: "Work", items: [{ type: "file", path: "inbox/20240102T0304--old-name.md" }] }],
        frontmatter: { fileClass: ["old", "second"], tags: ["Topic/subtopic"], tagValue: "T", globalValue: "G", bookmarkValue: "B", inlineValue: "I", oldValue: "delete" },
        options: { ...noMove, removeFields: "all" },
        schemas: {
            old: schema("oldValue"), second: schema("secondValue"), project: schema("newValue"), baseline: schema("globalValue"),
            tagged: { ...schema("tagValue"), tagNames: ["topic"] }, inline: { ...schema("inlineValue"), mapWithTag: true },
            bookmarked: { ...schema("bookmarkValue"), bookmarksGroups: ["Work"] },
        },
    });
    await env.assign();
    assert.equal(env.errors.length, 0);
    assert.deepEqual(env.frontmatter, { globalValue: "G", newValue: "", tagValue: "T", inlineValue: "I", bookmarkValue: "B", fileClass: "project", tags: ["Topic/subtopic"] });
});

test("metadata removal and insertion use the destination folder's classes", async () => {
    const env = await assignmentHost({ source: "fileclass", options: { removeFields: "all", autoRename: false },
        frontmatter: { fileClass: "old", sourceOnly: "remove", destinationOnly: "preserve" },
        settings: { pathMappings: [[".*", "destination"]] },
        schemas: {
            old: schema(), project: schema("own"),
            source: { ...schema("sourceOnly"), filesPaths: ["inbox"] },
            destination: { ...schema("destinationOnly", "destinationMissing"), filesPaths: ["destination"] },
        },
    });
    await env.assign();
    assert.equal(env.errors.length, 0);
    assert.equal(env.file.path, "destination/20240102T0304--old-name.md");
    assert.deepEqual(env.frontmatter, { own: "", destinationOnly: "preserve", destinationMissing: "", fileClass: "project" });
});

test("file location disabled preserves source folder fields", async () => {
    const env = await assignmentHost({ source: "fileclass", options: { ...noMove, removeFields: "all" },
        frontmatter: { fileClass: "old", sourceOnly: "preserve" },
        schemas: { project: schema(), source: { ...schema("sourceOnly"), filesPaths: ["inbox"] } },
    });
    await env.assign();
    assert.deepEqual(env.frontmatter, { sourceOnly: "preserve", fileClass: "project" });
});

for (const broken of [{ extends: "missing", fields: [] }, { fields: "invalid" }, { extends: "project", fields: [] }]) {
    test(`incomplete schemas retain even empty unknown fields: ${JSON.stringify(broken)}`, async () => {
        const values = { fileClass: "project", required: "", value: "keep" };
        const env = await assignmentHost({ schemas: { project: broken }, frontmatter: values });
        await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
        assert.deepEqual(env.frontmatter, values);
        assert.match(env.notices.at(-1), /Unknown fields preserved/);
        await env.assign();
        assert.deepEqual(env.frontmatter, values);
    });
}

test("multiple explicit classes protect their combined schema during cleanup", async () => {
    const env = await assignmentHost({ source: "fileclass", frontmatter: { fileClass: ["first", "second"], first: "", second: "Keep", extra: "remove" },
        schemas: { first: schema("first"), second: schema("second") },
    });
    await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
    assert.deepEqual(env.frontmatter, { first: "", second: "Keep", fileClass: ["first", "second"] });
});

test("sort-only cleanup preserves empty fields outside the schema", async () => {
    const env = await assignmentHost({ frontmatter: { fileClass: "project", blank: "", title: "Keep" } });
    await env.plugin.frontmatterService.sortFrontmatter(env.file, "schema");
    assert.deepEqual(env.frontmatter, { title: "Keep", blank: "", fileClass: "project" });
});

test("schema edits while a note moves invalidate removal and restore its original path", async () => {
    const env = await assignmentHost({ options: { removeFields: "all" }, afterRename: (_file, schemas) => {
        schemas.project = schema("changed");
    } });
    await env.assign();
    assert.equal(env.writes.length, 0);
    assert.equal(env.frontmatter.fileClass, "old");
    assert.equal(env.file.path, "inbox/20240102T0304--old-name.md");
    assert.match(env.notices.at(-1), /schema or class bindings changed/);
});

test("bulk reassignment shares destination schema handling and never cleans against the stale old type", async () => {
    const env = await assignmentHost({ source: "fileclass", frontmatter: { fileClass: "old", title: "Keep", oldValue: "remove", inherited: "keep", destinationValue: "keep" },
        schemas: { old: schema("oldValue"), parent: schema("inherited"), project: { extends: "parent", fields: [] },
            destination: { ...schema("destinationValue"), filesPaths: ["content/project"] } },
    });
    env.classes.BulkAssignTypeModal.prototype.openAndGetValue = async () => ({ targetType: "project", directory: "inbox", recursive: true,
        includePattern: "", excludePattern: "", runClean: true, cleanMode: "strict", runSort: true, sortMode: "schema", runReshelve: true });
    env.classes.BulkAssignPreviewModal.prototype.openAndGetValue = async () => ({ selectedFiles: [env.file] });
    await env.plugin.commands.get("bulk-assign-type").callback();
    assert.deepEqual(env.frontmatter, { inherited: "keep", destinationValue: "keep", fileClass: "project" });
    assert.equal(env.writes.length, 1);
    assert.match(env.notices.at(-1), /Assigned type to 1 file/);
});

test("Metadata Menu query bindings prevent unsafe removal instead of assuming an incomplete schema is complete", async () => {
    const env = await assignmentHost({ providerSettings: { fileClassQueries: [{ fileClassName: "queryClass", query: "custom" }] } });
    await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
    assert.equal(env.frontmatter.oldValue, "keep unless removed");
    assert.equal(env.frontmatter.blank, "");
    assert.match(env.notices.at(-1), /query bindings/);
});

for (const id of ["clean-frontmatter-standard", "clean-frontmatter-strict"]) {
    test(`${id}: registered commands preserve inherited empty fields`, async () => {
        const env = await assignmentHost({ source: "fileclass", frontmatter: { fileClass: "project", inherited: "", unknown: "value", blank: "" },
            schemas: { parent: schema("inherited"), project: { extends: "parent", fields: [] } },
        });
        await env.plugin.commands.get(id).callback();
        assert.equal(env.frontmatter.inherited, "");
        assert.equal(Object.hasOwn(env.frontmatter, "blank"), false);
        assert.equal(Object.hasOwn(env.frontmatter, "unknown"), id === "clean-frontmatter-standard");
    });
}

test("interactive cleanup applies only the metadata values that were previewed", async () => {
    const env = await assignmentHost({ frontmatter: { fileClass: "project", title: "Keep", extra: "Previewed" },
        beforeUpdate: fm => ({ ...fm, extra: "Concurrent change" }),
    });
    env.classes.StringSuggesterModal.prototype.openAndGetValue = async () => "Enforce schema (default sort)";
    env.classes.ConfirmModal.prototype.openAndGetValue = async () => true;
    await assert.rejects(env.plugin.commands.get("clean-frontmatter").callback(), /note changed/);
    assert.equal(env.frontmatter.extra, "Concurrent change");
    assert.equal(env.writes.length, 0);
});

test("a rollback collision is reported without overwriting either note", async () => {
    const env = await assignmentHost({ failure: "write" });
    const originalPath = env.file.path;
    const getPath = env.app.vault.getAbstractFileByPath;
    env.app.vault.getAbstractFileByPath = path => path === originalPath && env.file.path !== originalPath ? {} : getPath(path);
    await env.assign();
    assert.equal(env.frontmatter.fileClass, "old");
    assert.equal(env.renames.length, 1);
    assert.match(env.notices.at(-1), /Metadata update failed; the file remains at content\/project/);
});

test("Metadata Menu's global class supplies fields for otherwise empty schemas", async () => {
    const env = await assignmentHost({ source: "metadata-menu", providerSettings: { globalFileClass: "baseline" },
        schemas: { project: schema(), baseline: schema("shared") }, frontmatter: { fileClass: "project", shared: "" },
    });
    await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
    assert.equal(env.frontmatter.shared, "");
});

test("unavailable explicitly selected integrations preserve metadata", async () => {
    const env = await assignmentHost({ source: "none", settings: { schemaSource: "fileclass" }, options: { ...noMove, removeFields: "all" } });
    await env.assign();
    assert.equal(env.writes.length, 0);
    assert.match(env.notices.at(-1), /integration is not enabled/);
});

test("legacy presets do not protect fields from explicit schema enforcement", async () => {
    const env = await assignmentHost({ frontmatter: { fileClass: "project", global: ["Legacy preset"], title: "Keep" } });
    await env.plugin.frontmatterService.cleanFrontmatter(env.file, strict);
    assert.equal(Object.hasOwn(env.frontmatter, "global"), false);
    assert.equal(env.frontmatter.title, "Keep");
});

test("reshelving accepts multiple explicit types and uses the first for naming", async () => {
    const env = await assignmentHost({ source: "fileclass", frontmatter: { fileClass: ["first", "second"], title: "Keep" },
        schemas: { first: schema(), second: schema() },
    });
    await env.plugin.commands.get("reshelve-workflow-object").callback();
    assert.equal(env.file.path, "content/first/20240102T0304--Keep.md");
    assert.deepEqual(env.frontmatter.fileClass, ["first", "second"]);
});

test("navigation membership and reshelving recognize contextual types", async () => {
    const env = await assignmentHost({ source: "fileclass", frontmatter: { title: "Keep", tags: ["project"] },
        schemas: { project: { ...schema(), mapWithTag: true } },
    });
    assert.deepEqual(env.plugin.typeService.getFilesOfType("project"), [env.file]);
    await env.plugin.commands.get("reshelve-workflow-object").callback();
    assert.equal(env.file.path, "content/project/20240102T0304--Keep.md");
});

test("new note creation uses inherited root fields and does not flatten nested children", async () => {
    const env = await assignmentHost({ source: "fileclass", schemas: { parent: schema("inherited"), project: { extends: "parent",
        fields: [field("group", "Object"), field("child", "Input", { path: "groupId" })], fieldsOrder: ["group", "inherited"],
    } } });
    env.classes.StringSuggesterModal.prototype.openAndGetValue = async () => "project";
    env.classes.CreateWorkflowObjectModal.prototype.openAndCreate = async function () {
        this.draft.fields.find(field => field.definition.name === "title").text = "Created title";
        return this.draft.create();
    };
    await env.plugin.commands.get("create-new-workflow-object").callback();
    assert.equal(env.created.length, 1);
    const fm = JSON.parse(env.created[0].content.split("---\n")[1]);
    assert.deepEqual(fm.group, { child: "" });
    assert.equal(fm.inherited, "");
    assert.equal(Object.hasOwn(fm, "child"), false);
    assert.equal(Object.hasOwn(fm, "global"), false);
});

test("binding resolution follows FileClass's literal prefixes and legacy scalar encodings", async () => {
    const env = await assignmentHost({ source: "fileclass", path: "Library2/note.md", options: { ...noMove, removeFields: "all" },
        frontmatter: { fileClass: "old", tags: ["tagged", "123"], pathValue: "P", tagValue: "T", numericTag: "N" },
        schemas: { project: schema(), folder: { ...schema("pathValue"), filesPaths: ["Library"] },
            tagged: { ...schema("tagValue"), mapWithTag: "TRUE" }, numeric: { ...schema("numericTag"), tagNames: [123] } },
    });
    await env.assign();
    assert.equal(env.frontmatter.pathValue, "P");
    assert.equal(env.frontmatter.tagValue, "T");
    assert.equal(env.frontmatter.numericTag, "N");
    assert.equal(env.errors.length, 0);
});
