"""Word counts for the test-strength fixture: a function whose only
statement-level call site is in another module (src/report.py)."""

SEEN = {}


def remember_word(word):
    """Count one more sighting of word in SEEN."""
    SEEN[word] = SEEN.get(word, 0) + 1
