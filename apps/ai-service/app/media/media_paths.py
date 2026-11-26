from pathlib import Path


ARTIFACTS_ROOT = "analysis"


class PathEscapeError(ValueError):
    """A path from another service points outside MEDIA_ROOT."""


class MediaPaths:
    """Resolves the MEDIA_ROOT-relative paths that services exchange (architecture §8.3).

    Every path coming over gRPC goes through `resolve`; anything absolute, empty, or escaping
    MEDIA_ROOT (including through `..` or a symlink) is refused.
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()

    def resolve(self, relative: str) -> Path:
        if not relative or Path(relative).is_absolute():
            raise PathEscapeError(f"expected a path relative to MEDIA_ROOT, got {relative!r}")
        full = (self.root / relative).resolve()
        if full != self.root and self.root not in full.parents:
            raise PathEscapeError(f"path escapes MEDIA_ROOT: {relative!r}")
        return full

    def resolve_artifacts(self, relative: str) -> Path:
        """A directory the pipeline may create and delete: strictly inside MEDIA_ROOT/analysis/.

        Guards every rmtree: "." or "analysis" would otherwise let a cleanup wipe the media library.
        """
        full = self.resolve(relative)
        analysis = self.root / ARTIFACTS_ROOT
        if analysis not in full.parents:
            raise PathEscapeError(f"artifacts must live under {ARTIFACTS_ROOT}/: {relative!r}")
        return full

    def relative(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.root))
