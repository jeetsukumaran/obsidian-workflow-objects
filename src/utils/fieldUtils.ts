/**
 * Generate a random alphanumeric field ID.
 *
 * Length 6 matches Metadata Menu's own convention (gives ~56 billion combos;
 * collision risk in any real vault is negligible).
 */
export function generateFieldId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
