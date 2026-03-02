#!/usr/bin/env bash
set -euo pipefail

# release.sh
#
# Behavior:
# - If --version X.Y.Z is provided: bump package.json (+ lockfile), run version-bump.mjs,
#   commit, create annotated tag X.Y.Z.
# - Otherwise: use the current version from package.json/manifest.json (must match),
#   and only tag (no bump, no commit).
#
# Pre-execute validation:
# - package.json and manifest.json versions match
# - versions.json contains an entry for that version (if versions.json exists)
# - version follows Obsidian guideline: tag name == version, semver, no leading "v"
# - tag with same name does not already exist (local or on origin)

usage() {
  cat <<'EOF'
Usage:
  ./release.sh [--version X.Y.Z] [--push]

Options:
  --version X.Y.Z   Target version to release (e.g., 1.0.2). If omitted, uses current versions.
  --push            Push commit (if any) and tag to origin.

Notes:
  - Requires: node, npm, git
  - Expects: package.json, manifest.json, version-bump.mjs
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

semver_ok() {
  # Strict-ish semver: X.Y.Z with optional -prerelease and optional +build
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([\-][0-9A-Za-z\.-]+)?([+][0-9A-Za-z\.-]+)?$ ]]
}

json_get() {
  # json_get <file> <js_expr_returning_value>
  # Example: json_get package.json 'j.version'
  local file="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('$file','utf8')); const v=(${expr}); if (v===undefined) process.exit(2); process.stdout.write(String(v));"
}

tag_exists_local() {
  git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1
}

tag_exists_remote() {
  # Returns 0 if tag exists on origin
  git ls-remote --tags origin "refs/tags/$1" | grep -q .
}

ensure_clean_tree() {
  git update-index -q --refresh
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree or index not clean (commit/stash changes first)"
  fi
}

TARGET_VERSION=""
DO_PUSH="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || die "--version requires an argument"
      TARGET_VERSION="$2"
      shift 2
      ;;
    --push)
      DO_PUSH="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
done

have node || die "node not found"
have npm  || die "npm not found"
have git  || die "git not found"

[[ -f package.json ]]  || die "package.json not found"
[[ -f manifest.json ]] || die "manifest.json not found"
[[ -f version-bump.mjs ]] || die "version-bump.mjs not found"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not in a git repo"
git remote get-url origin >/dev/null 2>&1 || die "git remote 'origin' not configured"

# Read current versions
PKG_VERSION="$(json_get package.json 'j.version')"
MANIFEST_VERSION="$(json_get manifest.json 'j.version')"

# Determine release version
if [[ -n "$TARGET_VERSION" ]]; then
  REL_VERSION="$TARGET_VERSION"
else
  REL_VERSION="$PKG_VERSION"
fi

# Obsidian guideline: tag name must equal version; also ensure no leading "v"
[[ "$REL_VERSION" != v* ]] || die "version/tag must not start with 'v' (got: $REL_VERSION)"
semver_ok "$REL_VERSION" || die "version must be semver (X.Y.Z[-prerelease][+build]); got: $REL_VERSION"

# Require package/manifest match *either* already (no --version) or after bump (with --version)
if [[ -z "$TARGET_VERSION" ]]; then
  [[ "$PKG_VERSION" == "$MANIFEST_VERSION" ]] || die "package.json version ($PKG_VERSION) != manifest.json version ($MANIFEST_VERSION)"
else
  # If user wants a bump, require the repo is clean before modifying files
  ensure_clean_tree
fi

# If versions.json exists, validate it contains the release key (preflight for no-bump case;
# post-update check will happen for bump case too).
if [[ -f versions.json ]] && [[ -z "$TARGET_VERSION" ]]; then
  VERSIONS_HAS_KEY="$(node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('versions.json','utf8')); process.exit(Object.prototype.hasOwnProperty.call(j,'$REL_VERSION')?0:1)")" \
    || die "versions.json does not contain an entry for version $REL_VERSION"
fi

# Tag must not already exist (local or remote)
if tag_exists_local "$REL_VERSION"; then
  die "tag already exists locally: $REL_VERSION"
fi
if tag_exists_remote "$REL_VERSION"; then
  die "tag already exists on origin: $REL_VERSION"
fi

if [[ -n "$TARGET_VERSION" ]]; then
  # Bump package.json (+ lockfile) WITHOUT tagging/committing
  npm version "$REL_VERSION" --no-git-tag-version >/dev/null

  # Run your bump script to update manifest.json/versions.json etc.
  node version-bump.mjs

  # Post-bump validation: versions must match everywhere
  PKG_VERSION2="$(json_get package.json 'j.version')"
  MANIFEST_VERSION2="$(json_get manifest.json 'j.version')"
  [[ "$PKG_VERSION2" == "$REL_VERSION" ]] || die "after bump, package.json version is $PKG_VERSION2 (expected $REL_VERSION)"
  [[ "$MANIFEST_VERSION2" == "$REL_VERSION" ]] || die "after bump, manifest.json version is $MANIFEST_VERSION2 (expected $REL_VERSION)"

  if [[ -f versions.json ]]; then
    node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('versions.json','utf8')); if(!Object.prototype.hasOwnProperty.call(j,'$REL_VERSION')){process.stderr.write('versions.json missing key $REL_VERSION\\n'); process.exit(1)}"
  fi

  # Stage and commit
  git add package.json manifest.json versions.json package-lock.json 2>/dev/null || true
  # If you have npm-shrinkwrap.json, include it if present and changed
  [[ -f npm-shrinkwrap.json ]] && git add npm-shrinkwrap.json || true

  if git diff --cached --quiet; then
    die "nothing staged after bump; refusing to create a release commit"
  fi

  git commit -m "$REL_VERSION" >/dev/null

  # Annotated tag (Obsidian expects tag == version)
  git tag -a "$REL_VERSION" -m "$REL_VERSION"
else
  # No bump: require clean tree, then just tag current version
  ensure_clean_tree
  git tag -a "$REL_VERSION" -m "$REL_VERSION"
fi

if [[ "$DO_PUSH" == "1" ]]; then
  # Push commit only if we created one (i.e., in bump mode)
  if [[ -n "$TARGET_VERSION" ]]; then
    git push origin HEAD
  fi
  git push origin "$REL_VERSION"
fi

echo "OK: created annotated tag $REL_VERSION"
if [[ "$DO_PUSH" == "1" ]]; then
  echo "OK: pushed tag $REL_VERSION to origin"
fi

