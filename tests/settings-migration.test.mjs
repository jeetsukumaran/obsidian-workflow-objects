import assert from "node:assert/strict";
import test from "node:test";
import { assignmentHost } from "./helpers/assignment-host.mjs";

for (const [label, settings, expected] of [
    ["legacy ascending", { objectSortDirection: "asc" }, "asc"],
    ["legacy descending", { objectSortDirection: "desc" }, "desc"],
    ["new ascending", { typedNoteSortDirection: "asc" }, "asc"],
    ["new descending overrides legacy ascending", { typedNoteSortDirection: "desc", objectSortDirection: "asc" }, "desc"],
    ["new ascending overrides legacy descending", { typedNoteSortDirection: "asc", objectSortDirection: "desc" }, "asc"],
    ["invalid new value falls back to legacy", { typedNoteSortDirection: "invalid", objectSortDirection: "asc" }, "asc"],
    ["invalid legacy value uses default", { objectSortDirection: "invalid" }, "desc"],
    ["invalid values use default", { typedNoteSortDirection: null, objectSortDirection: 1 }, "desc"],
    ["absent values use default", {}, "desc"],
]) {
    test(`typed note sorting settings migrate: ${label}`, async () => {
        const input = {
            ...settings,
            fields: { type: "kind", title: "heading" },
            pathMappings: [["^book$", "library"]],
            typeAssignment: { targetType: "book", autoRename: false },
            customPreference: { keep: [false, 0, "value"] },
        };
        const env = await assignmentHost({ settings: input });
        assert.equal(env.plugin.settings.typedNoteSortDirection, expected);
        assert.equal(Object.hasOwn(env.plugin.settings, "objectSortDirection"), false);
        assert.deepEqual(env.saves, [], "loading must not overwrite stored settings");
        assert.deepEqual(env.saved, { typesPath: "types", ...input });

        await env.plugin.saveSettings();
        assert.equal(env.saved.typedNoteSortDirection, expected);
        assert.equal(Object.hasOwn(env.saved, "objectSortDirection"), false);
        for (const key of ["fields", "pathMappings", "customPreference"]) {
            assert.deepEqual(env.saved[key], input[key]);
        }
        assert.equal(env.saved.typeAssignment.targetType, "book");
        assert.equal(env.saved.typeAssignment.autoRename, false);
        assert.equal(env.saved.typeAssignment.removeFields, "empty");

        const saved = structuredClone(env.saved);
        await env.reload();
        assert.equal(env.plugin.settings.typedNoteSortDirection, expected);
        await env.plugin.saveSettings();
        assert.deepEqual(env.saved, saved, "migration must be idempotent");
        assert.deepEqual(input.fields, { type: "kind", title: "heading" });
    });
}

test("navigation uses the migrated ascending preference", async () => {
    const env = await assignmentHost({ path: "b.md", settings: { objectSortDirection: "asc" } });
    const first = new env.file.constructor("a.md");
    const last = new env.file.constructor("c.md");
    env.plugin.noteTypeService.getTypedNotesOfType = () => [last, env.file, first];
    await env.plugin.commands.get("navigate-next").callback();
    assert.deepEqual(env.opened, ["c.md"]);
});
