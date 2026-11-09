"""A report over src/words.py: it holds the only statement-level call to
remember_word in the fixture."""

from words import SEEN, remember_word


def summarise(words):
    """Count every word, then return the counts."""
    for word in words:
        remember_word(word)
    return dict(SEEN)
