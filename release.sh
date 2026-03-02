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
# - matching release numbers in manifest/package (and versions.json if present)
# - release/tag follows Obsidian guidelines: tag == version, semver, no leading "v"
# - tag of same name does not already exist (local or origin)

usage() {
  cat <<'EOF'
Usage:
  ./release.sh [--version X.Y.Z] [--push]

Options:
  --version X.Y.Z   Target version to release (e.g., 1.0.3). If omitted, uses current versions.
  --push            Push commit (if any) and tag to origin.

Requires:
  node, npm, git
  package.json, manifest.json, version-bump.mjs
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

semver_ok() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([\-][0-9A-Za-z\.-]+)?([+][0-9A-Za-z\.-]+)?$ ]]
}

json_get() {
  local file="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('$file','utf8')); const v=(${expr}); if (v===undefined) process.exit(2); process.stdout.write(String(v));"
}

tag_exists_local() {
  git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1
}

tag_exists_remote() {
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

[[ -f package.json ]]     || die "package.json not found"
[[ -f manifest.json ]]    || die "manifest.json not found"
[[ -f version-bump.mjs ]] || die "version-bump.mjs not found"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not in a git repo"
git remote get-url origin >/dev/null 2>&1 || die "git remote 'origin' not configured"

PKG_VERSION="$(json_get package.json 'j.version')"
MANIFEST_VERSION="$(json_get manifest.json 'j.version')"

if [[ -n "$TARGET_VERSION" ]]; then
  REL_VERSION="$TARGET_VERSION"
else
  REL_VERSION="$PKG_VERSION"
fi

# Obsidian guideline: tag == version; do not use v-prefix; use semver
[[ "$REL_VERSION" != v* ]] || die "version/tag must not start with 'v' (got: $REL_VERSION)"
semver_ok "$REL_VERSION" || die "version must be semver (X.Y.Z[-prerelease][+build]); got: $REL_VERSION"

# Tag must not exist (local or remote)
if tag_exists_local "$REL_VERSION"; then
  die "tag already exists locally: $REL_VERSION"
fi
if tag_exists_remote "$REL_VERSION"; then
  die "tag already exists on origin: $REL_VERSION"
fi

if [[ -z "$TARGET_VERSION" ]]; then
  # No bump: versions must already match and repo must be clean.
  [[ "$PKG_VERSION" == "$MANIFEST_VERSION" ]] || die "package.json version ($PKG_VERSION) != manifest.json version ($MANIFEST_VERSION)"
  if [[ -f versions.json ]]; then
    node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('versions.json','utf8')); if(!Object.prototype.hasOwnProperty.call(j,'$REL_VERSION')){process.stderr.write('versions.json missing key $REL_VERSION\\n'); process.exit(1)}"
  fi
  ensure_clean_tree
  git tag -a "$REL_VERSION" -m "$REL_VERSION"
else
  # Bump: require clean tree before modifying anything.
  ensure_clean_tree

  # Bump package.json (+ lockfile) WITHOUT commit/tag
  npm version "$REL_VERSION" --no-git-tag-version >/dev/null

  # Update manifest/versions via your script
  node version-bump.mjs

  # Post-bump validation: versions must match everywhere
  PKG_VERSION2="$(json_get package.json 'j.version')"
  MANIFEST_VERSION2="$(json_get manifest.json 'j.version')"
  [[ "$PKG_VERSION2" == "$REL_VERSION" ]] || die "after bump, package.json version is $PKG_VERSION2 (expected $REL_VERSION)"
  [[ "$MANIFEST_VERSION2" == "$REL_VERSION" ]] || die "after bump, manifest.json version is $MANIFEST_VERSION2 (expected $REL_VERSION)"

  if [[ -f versions.json ]]; then
    node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('versions.json','utf8')); if(!Object.prototype.hasOwnProperty.call(j,'$REL_VERSION')){process.stderr.write('versions.json missing key $REL_VERSION\\n'); process.exit(1)}"
  fi

  # Stage final state of everything (avoids staged+unstaged split if version-bump also runs git add internally)
  git add -A

  if git diff --cached --quiet; then
    die "nothing staged after bump; refusing to create a release commit"
  fi

  git commit -m "$REL_VERSION" >/dev/null
  git tag -a "$REL_VERSION" -m "$REL_VERSION"
fi

if [[ "$DO_PUSH" == "1" ]]; then
  if [[ -n "$TARGET_VERSION" ]]; then
    git push origin HEAD
  fi
  git push origin "$REL_VERSION"
fi

echo "OK: created annotated tag $REL_VERSION"
if [[ "$DO_PUSH" == "1" ]]; then
  echo "OK: pushed tag $REL_VERSION to origin"
fi
