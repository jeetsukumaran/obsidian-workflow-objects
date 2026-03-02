import { App, Notice, WorkspaceLeaf } from "obsidian";

/**
 * Clean workspace: close all tabs except one, collapse file explorer
 */
export async function cleanWorkspace(app: App): Promise<void> {
    const { workspace } = app;

    const leavesToClose: WorkspaceLeaf[] = [];
    workspace.iterateRootLeaves((leaf) => {
        leavesToClose.push(leaf);
    });

    // Create a new leaf to keep
    const newLeaf = workspace.getLeaf(true);

    // Close all other leaves
    let closedCount = 0;
    for (const leaf of leavesToClose) {
        if (leaf !== newLeaf) {
            leaf.detach();
            closedCount++;
        }
    }

    // Collapse file explorer
    const fileExplorerLeaf = workspace.getLeavesOfType("file-explorer")[0];
    if (fileExplorerLeaf) {
        const view = fileExplorerLeaf.view as any;
        if (view?.tree?.setCollapseAll) {
            view.tree.setCollapseAll(true);
        }
    }

    if (closedCount > 0) {
        new Notice(`Closed ${closedCount} tab(s), collapsed explorer`);
    } else {
        new Notice("Workspace cleaned");
    }
}
