"""Path helpers for the test-strength fixture: top-level functions."""

CACHE = {}


def canonical(path):
    """The path with repeated slashes collapsed and no trailing slash, remembered in CACHE."""
    out = "/" + "/".join(part for part in path.split("/") if part)
    CACHE[path] = out
    return out


def warm(paths):
    """Remember the canonical form of every path; return how many are remembered."""
    for path in paths:
        canonical(path)
    return len(CACHE)


def record(log, path):
    """Append the canonical form of path to log."""
    log.append(canonical(path))
